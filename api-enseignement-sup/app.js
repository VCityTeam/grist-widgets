/* global grist */
'use strict'

// Required - the research structure to look up: its RNSR number
// (numero_national_de_structure, e.g. 200610662T), its acronym (sigle, e.g.
// IRSTV), or its full name (libelle). Matching is exact but case-insensitive.
const Query = 'Query'
// Optional - boolean column. When mapped, any record with this checked (and
// not yet looked up for its current Query) is looked up automatically.
const Lookup = 'Lookup'
// Optional - cache of the last query that was looked up, so records aren't
// re-queried on every sync, and so edits to Query are detected.
const LookedUpQuery = 'LookedUpQuery'

// Separator used to store the API's list-valued fields in Text columns.
const LIST_SEPARATOR = '; '

// Output columns - all optional so a document can map only the fields it
// needs. `get(r)` pulls the value from the matched API record; `type` is the
// Grist column type offered in the Creator Panel.
const OUTPUT_FIELDS = [
  {
    name: 'NumeroStructure',
    title: 'RNSR Number',
    type: 'Text',
    get: (r) => r.numero_national_de_structure,
  },
  { name: 'Libelle', title: 'Name', type: 'Text', get: (r) => r.libelle },
  { name: 'Sigle', title: 'Acronym', type: 'Text', get: (r) => r.sigle },
  {
    name: 'AnneeCreation',
    title: 'Year Created',
    type: 'Integer,Numeric,Text,Date',
    get: (r) => toNumber(r.annee_de_creation),
  },
  {
    name: 'TypeStructure',
    title: 'Structure Type',
    type: 'Text',
    get: (r) => r.type_de_structure,
  },
  {
    name: 'CodeTypeStructure',
    title: 'Structure Type Code',
    type: 'Text,Numeric,Integer',
    get: (r) => r.code_de_type_de_structure,
  },
  {
    name: 'CodeNiveauStructure',
    title: 'Structure Level Code',
    type: 'Text,Numeric,Integer',
    get: (r) => r.code_de_niveau_de_structure,
  },
  {
    name: 'Labels',
    title: 'Labels (e.g. UMR 1234)',
    type: 'Text',
    get: (r) => joinList(unique(r.label_numero)),
  },
  { name: 'SiteWeb', title: 'Website', type: 'Text', get: (r) => r.site_web },
  { name: 'Adresse', title: 'Address', type: 'Text', get: (r) => r.adresse },
  {
    name: 'CodePostal',
    title: 'Postal Code',
    type: 'Text,Numeric,Integer',
    get: (r) => r.code_postal,
  },
  { name: 'Commune', title: 'Commune', type: 'Text', get: (r) => r.commune },
  {
    name: 'Responsables',
    title: 'Heads (Name, Title)',
    type: 'Text',
    get: (r) => joinList(responsables(r)),
  },
  {
    name: 'Tutelles',
    title: 'Supervising Bodies',
    type: 'Text',
    get: (r) => joinList(r.tutelles),
  },
  {
    name: 'SiglesTutelles',
    title: 'Supervising Body Acronyms',
    type: 'Text',
    get: (r) => joinList(r.sigles_des_tutelles),
  },
  {
    name: 'SiretTutelles',
    title: 'Supervising Body SIRETs',
    type: 'Text',
    get: (r) => joinList(r.siret_des_tutelles),
  },
  {
    name: 'UaiTutelles',
    title: 'Supervising Body UAIs',
    type: 'Text',
    get: (r) => joinList(r.uai_des_tutelles),
  },
  {
    name: 'TypesTutelles',
    title: 'Supervision Types',
    type: 'Text',
    get: (r) => joinList(r.type_de_tutelle),
  },
  {
    name: 'DomainesScientifiques',
    title: 'Scientific Domains',
    type: 'Text',
    get: (r) => joinList(r.domaine_scientifique),
  },
  {
    name: 'PanelErc',
    title: 'ERC Panel',
    type: 'Text',
    // The API splits a single panel description on its commas; rejoin it.
    get: (r) =>
      r.code_panel_erc
        ? `${r.code_panel_erc}${r.panel_erc ? ` - ${joinList(r.panel_erc, ', ')}` : ''}`
        : null,
  },
  {
    name: 'StructuresParentes',
    title: 'Parent Structures (RNSR)',
    type: 'Text',
    get: (r) => joinList(r.numero_de_structure_parent),
  },
  {
    name: 'StructuresEnfants',
    title: 'Child Structures (RNSR)',
    type: 'Text',
    get: (r) => joinList(r.numero_de_structure_enfant),
  },
  {
    name: 'FicheRnsr',
    title: 'RNSR Record URL',
    type: 'Text',
    get: (r) => r.fiche_rnsr,
  },
]

const RECORDS_URL =
  'https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets' +
  '/fr-esr-structures-recherche-publiques-actives/records'
// Same spacing as the original loader's requests, to stay clear of the API's
// rate limits during bulk scans.
const REQUEST_DELAY_MS = 500

let lastRecord = null
let lastMappings = null
let selectedRecords = null
let writeAccess = true
let scanning = null

const el = {
  queryValue: document.getElementById('query-value'),
  fieldsBody: document.querySelector('#fields tbody'),
  error: document.getElementById('error'),
  log: document.getElementById('log'),
  lookupBtn: document.getElementById('lookup-btn'),
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

// Joins a list-valued API field into a single string (null if empty).
function joinList(values, separator = LIST_SEPARATOR) {
  if (values === null || values === undefined) {
    return null
  }
  const list = (Array.isArray(values) ? values : [values]).filter(
    (v) => v !== null && v !== undefined && v !== '',
  )
  return list.length > 0 ? list.join(separator) : null
}

function unique(values) {
  return Array.isArray(values) ? [...new Set(values)] : values
}

// Zips the parallel first name / last name / title arrays into
// "Prénom NOM (TITRE)" entries.
function responsables(r) {
  const noms = r.nom_du_responsable || []
  const prenoms = r.prenom_du_responsable || []
  const titres = r.titre_du_responsable || []
  return noms.map((nom, i) => {
    const name = [prenoms[i], nom].filter(Boolean).join(' ')
    return titres[i] ? `${name} (${titres[i]})` : name
  })
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

function normalizeQuery(query) {
  return query == null ? '' : String(query).trim()
}

// Dataset fields a query is matched against, in order of preference when a
// query matches several structures (e.g. an acronym shared by two labs).
const SEARCH_FIELDS = ['numero_national_de_structure', 'sigle', 'libelle']
// Max number of candidate matches fetched to pick the preferred one from.
const SEARCH_LIMIT = 20

// ODSQL string literal: escape backslashes and double quotes.
function odsqlString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// Ranks a matched record by the first SEARCH_FIELDS entry it matched on.
function matchRank(record, lowerQuery) {
  const i = SEARCH_FIELDS.findIndex(
    (f) => String(record[f] ?? '').toLowerCase() === lowerQuery,
  )
  return i === -1 ? SEARCH_FIELDS.length : i
}

// Queries the active public research structures dataset for a structure
// whose RNSR number, acronym, or name equals the query (case-insensitive) and
// returns the best match (see SEARCH_FIELDS), or null if nothing matched.
// Throws on network/HTTP errors so callers can tell a definitive "no match"
// apart from a transient failure.
async function searchQuery(query) {
  const url = new URL(RECORDS_URL)
  const lowerQuery = query.toLowerCase()
  const literal = odsqlString(lowerQuery)
  url.searchParams.set(
    'where',
    SEARCH_FIELDS.map((f) => `lower(${f})=${literal}`).join(' OR '),
  )
  url.searchParams.set('limit', String(SEARCH_LIMIT))
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.json()).message || ''
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
  if (data.results.length === 0) {
    return null
  }
  const ranked = data.results
    .map((record) => ({ record, rank: matchRank(record, lowerQuery) }))
    .sort((a, b) => a.rank - b.rank)
  const best = ranked[0]
  const tied = ranked.filter((m) => m.rank === best.rank).length
  if (tied > 1) {
    log(
      `⚠ ${query}: ${tied}${data.total_count > SEARCH_LIMIT ? '+' : ''} structures match by ${SEARCH_FIELDS[best.rank] ?? 'query'}; using ${best.record.numero_national_de_structure}`,
    )
  }
  return best.record
}

// Maps an API record (or null, for "not found") to our logical field names.
function resultToFields(result) {
  const fields = {}
  for (const field of OUTPUT_FIELDS) {
    fields[field.name] = result ? (field.get(result) ?? null) : null
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
    td.textContent = value === null || value === undefined ? '—' : String(value)
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
  query = normalizeQuery(query)
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

  const fields = resultToFields(result)
  const errorMsg = result ? null : `No structure found for "${query}"`

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
    log(`✓ ${query} → ${fields.Sigle ?? ''} ${fields.Libelle ?? ''}`)
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
    const query = normalizeQuery(record[Query])
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

grist.ready({
  columns: [
    { name: Query, type: 'Text', title: 'Query (RNSR number, acronym or name)' },
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

grist.onOptions((_options, interaction) => {
  writeAccess = interaction.accessLevel === 'full'
  el.lookupBtn.disabled = !writeAccess
})
