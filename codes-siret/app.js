/* global grist */
'use strict'

// Required - free-text query sent to the API: a company name, SIREN (9
// digits), SIRET (14 digits), or anything else recherche-entreprises accepts.
const Query = 'Query'
// Optional - boolean column. When mapped, any record with this checked (and
// not yet looked up for its current Query) is looked up automatically.
const Lookup = 'Lookup'
// Optional - cache of the last query that was looked up, so records aren't
// re-queried on every sync, and so edits to Query are detected.
const LookedUpQuery = 'LookedUpQuery'

// Output columns - all optional so a document can map only the fields it
// needs. `source` is the API field path on the selected establishment (`e`)
// or on the company result (`r`); `type` is the Grist column type offered in
// the Creator Panel.
const OUTPUT_FIELDS = [
  { name: 'Siren', title: 'SIREN', type: 'Text,Numeric,Integer', get: (r) => r.siren },
  { name: 'Siret', title: 'SIRET', type: 'Text,Numeric', get: (r, e) => e.siret },
  {
    name: 'EstSiege',
    title: 'Is Head Office',
    type: 'Bool',
    get: (r, e) => e.est_siege,
  },
  {
    name: 'SiretSiege',
    title: 'Head Office SIRET',
    type: 'Text',
    get: (r) => r.siege?.siret,
  },
  {
    name: 'NomComplet',
    title: 'Full Name',
    type: 'Text',
    get: (r) => r.nom_complet,
  },
  {
    name: 'NatureJuridique',
    title: 'Legal Category Code',
    type: 'Text,Numeric,Integer',
    get: (r) => r.nature_juridique,
  },
  {
    name: 'ActivitePrincipale',
    title: 'Main Activity (NAF)',
    type: 'Text',
    get: (r, e) => e.activite_principale,
  },
  { name: 'Adresse', title: 'Address', type: 'Text', get: (r, e) => e.adresse },
  {
    name: 'CodePostal',
    title: 'Postal Code',
    type: 'Text',
    get: (r, e) => e.code_postal,
  },
  {
    name: 'Commune',
    title: 'Commune INSEE Code',
    type: 'Text',
    get: (r, e) => e.commune,
  },
  {
    name: 'LibelleCommune',
    title: 'Commune Name',
    type: 'Text',
    get: (r, e) => e.libelle_commune,
  },
  {
    name: 'Region',
    title: 'Region Code',
    type: 'Text',
    get: (r, e) => e.region,
  },
  {
    name: 'Latitude',
    title: 'Latitude',
    type: 'Numeric',
    get: (r, e) => toNumber(e.latitude),
  },
  {
    name: 'Longitude',
    title: 'Longitude',
    type: 'Numeric',
    get: (r, e) => toNumber(e.longitude),
  },
]

const SEARCH_URL = 'https://recherche-entreprises.api.gouv.fr/search'
// The API allows 7 requests/second per IP; stay a little under that.
const REQUEST_DELAY_MS = 200

let lastRecord = null
let lastMappings = null
let selectedRecords = null
let writeAccess = true
let useSiege = true
let scanning = null

const el = {
  queryValue: document.getElementById('query-value'),
  fieldsBody: document.querySelector('#fields tbody'),
  error: document.getElementById('error'),
  log: document.getElementById('log'),
  lookupBtn: document.getElementById('lookup-btn'),
  useSiege: document.getElementById('use-siege'),
}

// One table row per output field, built once.
const fieldCells = new Map()
for (const field of OUTPUT_FIELDS) {
  const tr = document.createElement('tr')
  const th = document.createElement('th')
  const td = document.createElement('td')
  th.textContent = field.title
  td.textContent = '—'
  tr.append(th, td)
  el.fieldsBody.append(tr)
  fieldCells.set(field.name, { tr, td })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function log(msg) {
  const line = document.createElement('div')
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  el.log.prepend(line)
  while (el.log.childElementCount > 50) {
    el.log.removeChild(el.log.lastChild)
  }
}

function showError(msg) {
  el.error.textContent = msg || ''
}

// Returns the 14-digit SIRET if the query is one (spaces/dots ignored), else null.
function asSiret(query) {
  const digits = String(query).replace(/[\s.]/g, '')
  return /^\d{14}$/.test(digits) ? digits : null
}

// Calls the /search endpoint and returns the top company result, or null if
// nothing matched. Throws on network/HTTP errors so callers can tell a
// definitive "no match" apart from a transient failure.
async function searchQuery(query) {
  const url = new URL(SEARCH_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('page', '1')
  url.searchParams.set('per_page', '1')
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.json()).erreur || ''
    } catch (e) {
      // non-JSON error body
    }
    throw new Error(
      `API request failed: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`,
    )
  }
  const data = await response.json()
  if (!Array.isArray(data?.results)) {
    throw new Error('Unexpected API response format')
  }
  return data.results[0] || null
}

// Picks which establishment's data to use for a company result: the one whose
// SIRET was queried, if any; otherwise the head office (siège), unless
// `preferSiege` is off and the API returned a matching establishment.
function selectEtablissement(result, query, preferSiege) {
  const matching = result.matching_etablissements || []
  const siret = asSiret(query)
  if (siret) {
    const exact =
      matching.find((e) => e.siret === siret) ||
      (result.siege?.siret === siret ? result.siege : null)
    if (exact) {
      return exact
    }
  }
  if (!preferSiege && matching.length > 0) {
    return matching[0]
  }
  return result.siege || {}
}

// Maps an API result (or null, for "not found") to our logical field names.
function resultToFields(result, query, preferSiege) {
  const fields = {}
  const etab = result ? selectEtablissement(result, query, preferSiege) : null
  for (const field of OUTPUT_FIELDS) {
    fields[field.name] = result ? (field.get(result, etab) ?? null) : null
  }
  return fields
}

// Pulls the current output-field values off an already-mapped record, for display.
function fieldsFromRecord(rec) {
  const fields = {}
  for (const field of OUTPUT_FIELDS) {
    fields[field.name] = rec[field.name] ?? null
  }
  return fields
}

function updatePanel(query, fields, mappings) {
  el.queryValue.textContent = query || '—'
  for (const field of OUTPUT_FIELDS) {
    const { tr, td } = fieldCells.get(field.name)
    const value = fields[field.name]
    td.textContent =
      value === null || value === undefined
        ? '—'
        : typeof value === 'boolean'
          ? value
            ? 'Yes'
            : 'No'
          : String(value)
    const mapped = !mappings || Boolean(mappings[field.name])
    tr.classList.toggle('unmapped', !mapped)
    tr.title = mapped ? '' : 'Column not mapped - not written to Grist'
  }
}

// Builds a {realColumnId: value} update payload, only for fields that are mapped.
function mappedUpdate(mappings, fields) {
  const update = {}
  for (const field of OUTPUT_FIELDS) {
    if (mappings[field.name]) {
      update[mappings[field.name]] = fields[field.name]
    }
  }
  return update
}

// Looks up one record and writes the results back through Grist, which then
// pushes the updated row back through onRecord/onRecords to refresh the panel.
// `force` bypasses the LookedUpQuery cache (used by the manual button).
// A transient failure (network/HTTP error) writes nothing, so the record is
// retried later; a definitive "no match" clears the outputs and is cached.
async function lookupRecord(
  rowId,
  query,
  mappings,
  { force = false, cachedQuery } = {},
) {
  query = query == null ? '' : String(query).trim()
  if (!query) {
    return
  }
  if (!force && cachedQuery && cachedQuery === query) {
    return
  }

  let result
  try {
    result = await searchQuery(query)
  } catch (e) {
    const errorMsg = e.message || String(e)
    log(`✗ ${query}: ${errorMsg}`)
    return { fields: null, errorMsg }
  }

  const fields = resultToFields(result, query, useSiege)
  const errorMsg = result ? null : `No match found for "${query}"`

  if (writeAccess && rowId) {
    const update = mappedUpdate(mappings, fields)
    if (mappings[LookedUpQuery]) {
      update[mappings[LookedUpQuery]] = query
    }
    if (Object.keys(update).length > 0) {
      await grist.selectedTable.update({ id: rowId, fields: update })
    }
  }

  if (errorMsg) {
    log(`✗ ${query}: ${errorMsg}`)
  } else {
    log(`✓ ${query} → ${fields.Siret ?? fields.Siren} ${fields.NomComplet ?? ''}`)
  }

  return { fields, errorMsg }
}

async function scan(records, mappings) {
  if (!writeAccess || !mappings?.[Lookup]) {
    return
  }
  for (const record of records) {
    if (!record[Lookup]) {
      continue
    }
    const query = record[Query] == null ? '' : String(record[Query]).trim()
    if (!query || query === record[LookedUpQuery]) {
      continue
    }
    await lookupRecord(record.id, query, mappings, {
      cachedQuery: record[LookedUpQuery],
    })
    await delay(REQUEST_DELAY_MS)
  }
}

function scanOnNeed(mappings) {
  if (!scanning && selectedRecords) {
    scanning = scan(selectedRecords, mappings)
      .catch((e) => console.error(e))
      .finally(() => (scanning = null))
  }
}

grist.onRecord((record, mappings) => {
  lastRecord = grist.mapColumnNames(record) || null
  lastMappings = mappings
  showError('')
  if (!lastRecord) {
    updatePanel(null, {}, mappings)
    return
  }
  updatePanel(lastRecord[Query], fieldsFromRecord(lastRecord), mappings)
})

grist.onRecords((data, mappings) => {
  selectedRecords = grist.mapColumnNames(data) || null
  scanOnNeed(mappings)
})

el.lookupBtn.addEventListener('click', async () => {
  if (!lastRecord || !lastMappings) {
    return
  }
  showError('')
  el.lookupBtn.disabled = true
  try {
    const outcome = await lookupRecord(
      lastRecord.id,
      lastRecord[Query],
      lastMappings,
      { force: true },
    )
    if (outcome) {
      showError(outcome.errorMsg)
      if (outcome.fields) {
        updatePanel(lastRecord[Query], outcome.fields, lastMappings)
      }
    }
  } finally {
    el.lookupBtn.disabled = !writeAccess
  }
})

el.useSiege.addEventListener('change', () => {
  useSiege = el.useSiege.checked
  grist.widgetApi.setOption('useSiege', useSiege)
})

grist.ready({
  columns: [
    { name: Query, type: 'Any', title: 'Query (name, SIREN or SIRET)' },
    { name: Lookup, type: 'Bool', title: 'Auto Lookup', optional: true },
    {
      name: LookedUpQuery,
      type: 'Text',
      title: 'Looked-up Query',
      optional: true,
    },
    ...OUTPUT_FIELDS.map(({ name, title, type }) => ({
      name,
      title,
      type,
      optional: true,
    })),
  ],
  requiredAccess: 'full',
})

grist.onOptions((options, interaction) => {
  writeAccess = interaction.accessLevel === 'full'
  el.lookupBtn.disabled = !writeAccess
  useSiege = options?.useSiege ?? true
  el.useSiege.checked = useSiege
})
