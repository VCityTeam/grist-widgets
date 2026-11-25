// Reads the Grist document's own metadata tables (_grist_Tables and
// _grist_Tables_column) and renders the selected table's columns and types as a
// Mermaid erDiagram. Reference columns are marked as foreign keys (FK); in the
// "All tables" view they are also drawn as relationships between tables.

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  // Render at natural size; the canvas handles zoom & pan instead of shrinking
  // the diagram to fit the widget's width.
  er: { useMaxWidth: false },
})

// Option values for the table selector besides a concrete tableId.
const LINKED_TABLE = '' // the table this widget is attached to
const ALL_TABLES = '*'

const tableSelect = document.getElementById('table-select')
const refreshButton = document.getElementById('refresh-btn')
const sourceButton = document.getElementById('source-btn')
const copyButton = document.getElementById('copy-btn')
const resetViewButton = document.getElementById('reset-view-btn')
const statusSpan = document.getElementById('status')
const canvas = document.getElementById('canvas')
const diagram = document.getElementById('diagram')
const errorDiv = document.getElementById('error')
const sourceContainer = document.getElementById('source-container')
const sourceArea = document.getElementById('source')

let tableChoice = LINKED_TABLE
let linkedTableId = null
let lastSource = null
let renderCount = 0

// --- Zoom & pan (same scheme as markdown-mermaid) ---
let scale = 1
let translateX = 0
let translateY = 0
let isDragging = false
let startX, startY

function updateTransform() {
  diagram.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`
}

function resetView() {
  scale = 1
  translateX = 0
  translateY = 0
  updateTransform()
}

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    scale += e.deltaY < 0 ? 0.1 : -0.1
    scale = Math.max(0.1, Math.min(scale, 5))
    updateTransform()
  },
  { passive: false },
)
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  isDragging = true
  startX = e.clientX - translateX
  startY = e.clientY - translateY
})
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return
  translateX = e.clientX - startX
  translateY = e.clientY - startY
  updateTransform()
})
window.addEventListener('mouseup', () => (isDragging = false))
resetViewButton.addEventListener('click', resetView)

// --- Schema reading ---

// Grist's fetchTable returns column-oriented data ({id: [...], colId: [...]});
// turn it into an array of row objects.
function toRows(columnar) {
  const keys = Object.keys(columnar)
  const n = columnar.id ? columnar.id.length : 0
  return Array.from({ length: n }, (_, i) =>
    Object.fromEntries(keys.map((k) => [k, columnar[k][i]])),
  )
}

// Columns Grist manages internally and never shows as user columns.
function isHiddenColumn(colId) {
  return colId === 'manualSort' || colId.startsWith('gristHelper_')
}

// Summary tables are derived from another table and import scratch tables are
// temporary, so neither belongs in a schema diagram.
function isUserTable(table) {
  return !table.summarySourceTable && !table.tableId.startsWith('GristHidden_')
}

// Returns [{tableId, columns: [{colId, label, description, type, isFormula}]}] in the
// document's table order, columns in their Raw Data order.
async function readSchema() {
  const [tablesData, columnsData] = await Promise.all([
    grist.docApi.fetchTable('_grist_Tables'),
    grist.docApi.fetchTable('_grist_Tables_column'),
  ])
  const tables = toRows(tablesData).filter(isUserTable)
  const columns = toRows(columnsData)
    .filter((c) => !isHiddenColumn(c.colId))
    .sort((a, b) => a.parentPos - b.parentPos)

  return tables.map((t) => ({
    tableId: t.tableId,
    columns: columns
      .filter((c) => c.parentId === t.id)
      .map((c) => ({
        colId: c.colId,
        label: c.label,
        // Column descriptions are newer than the other fields; older
        // documents may not have them.
        description: c.description || '',
        type: c.type,
        isFormula: c.isFormula,
      })),
  }))
}

// --- Mermaid generation ---

// Mermaid ER attribute types/names only allow [A-Za-z0-9_-] plus [] and ().
// Grist types look like "Text", "Ref:People", "DateTime:Europe/Paris", so the
// part after the colon becomes a parenthesized argument: "Ref(People)".
function mermaidType(gristType) {
  const [base, arg] = String(gristType || 'Any').split(/:(.*)/s)
  const clean = (s) => s.replace(/[^A-Za-z0-9_-]/g, '_')
  return arg ? `${clean(base)}(${clean(arg)})` : clean(base)
}

function mermaidName(id) {
  const name = String(id).replace(/[^A-Za-z0-9_-]/g, '_')
  return /^[A-Za-z_]/.test(name) ? name : `_${name}`
}

// Attribute comments are double-quoted strings, so quotes can't appear inside.
function mermaidComment(text) {
  return `"${String(text).replace(/"/g, "'")}"`
}

// A Ref:<Table> column stores the row id of a record in <Table>, and a
// RefList:<Table> column a list of them; both are foreign keys.
function isForeignKey(column) {
  return /^Ref(List)?:/.test(String(column.type || ''))
}

// Splits a Ref/RefList column's type into {isList, targetTableId}, or returns
// null for any other column.
function parseReference(column) {
  const match = /^Ref(List)?:(.+)$/s.exec(String(column.type || ''))
  return match ? { isList: Boolean(match[1]), targetTableId: match[2] } : null
}

// One Mermaid relationship per reference column whose target table is also in
// the diagram, labelled with the column ID. Cardinality, written target first:
// - Ref:<Target>     each source row points to zero or one target row, and a
//                    target row can be referenced by any number of source rows:
//                    Target |o--o{ Source
// - RefList:<Target> each source row points to any number of target rows, and
//                    vice versa: Target }o--o{ Source
function relationshipLines(tables) {
  const tableIds = new Set(tables.map((t) => t.tableId))
  const lines = []
  for (const table of tables) {
    for (const column of table.columns) {
      const ref = parseReference(column)
      if (!ref || !tableIds.has(ref.targetTableId)) continue
      const cardinality = ref.isList ? '}o--o{' : '|o--o{'
      lines.push(
        `    ${mermaidName(ref.targetTableId)} ${cardinality} ${mermaidName(table.tableId)} : ${mermaidComment(column.colId)}`,
      )
    }
  }
  return lines
}

// The comment collects, in order: the column header (single-quoted, and only
// when it differs from the column ID), a "formula" flag for computed columns,
// and the column's description, collapsed onto one line.
// Mermaid expects keys between the attribute name and its comment.
function attributeLine(column) {
  const notes = []
  if (column.label && column.label !== column.colId) notes.push(`'${column.label}'`)
  if (column.isFormula) notes.push('formula')
  const description = column.description.replace(/\s+/g, ' ').trim()
  if (description) notes.push(description)
  const key = isForeignKey(column) ? ' FK' : ''
  const comment = notes.length ? ` ${mermaidComment(notes.join(' ; '))}` : ''
  return `        ${mermaidType(column.type)} ${mermaidName(column.colId)}${key}${comment}`
}

function buildErDiagram(tables, { relationships = false } = {}) {
  const lines = ['erDiagram']
  for (const table of tables) {
    lines.push(`    ${mermaidName(table.tableId)} {`)
    for (const column of table.columns) lines.push(attributeLine(column))
    lines.push('    }')
  }
  if (relationships) lines.push(...relationshipLines(tables))
  return lines.join('\n')
}

// --- Rendering ---

function showError(message) {
  errorDiv.textContent = message
  errorDiv.style.display = message ? 'block' : 'none'
}

function populateTableSelect(tables) {
  const options = [
    [LINKED_TABLE, `Linked table${linkedTableId ? ` (${linkedTableId})` : ''}`],
    [ALL_TABLES, 'All tables'],
    ...tables.map((t) => [t.tableId, t.tableId]),
  ]
  tableSelect.replaceChildren(
    ...options.map(([value, text]) => new Option(text, value)),
  )
  // Fall back to the linked table if the saved table was renamed or removed.
  tableSelect.value = options.some(([v]) => v === tableChoice)
    ? tableChoice
    : LINKED_TABLE
}

function selectTables(tables) {
  const choice = tableSelect.value
  if (choice === ALL_TABLES) return tables
  const tableId = choice === LINKED_TABLE ? linkedTableId : choice
  return tables.filter((t) => t.tableId === tableId)
}

async function renderDiagram(source) {
  if (source === lastSource) return
  lastSource = source
  sourceArea.value = source

  const id = `er-${++renderCount}`
  try {
    const { svg } = await mermaid.render(id, source)
    // A newer render may have started while this one was awaiting.
    if (source !== lastSource) return
    diagram.innerHTML = svg
    showError('')
  } catch (err) {
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
    showError(err.message || String(err))
  }
}

async function refresh() {
  try {
    if (linkedTableId === null) {
      linkedTableId = await grist.selectedTable.getTableId().catch(() => null)
    }
    const tables = await readSchema()
    populateTableSelect(tables)

    const selected = selectTables(tables)
    const columnCount = selected.reduce((n, t) => n + t.columns.length, 0)
    statusSpan.textContent = `${selected.length} table(s), ${columnCount} column(s)`

    if (selected.length === 0) {
      lastSource = null
      diagram.innerHTML = ''
      sourceArea.value = ''
      showError('No table to show: pick one in the Table menu.')
      return
    }
    await renderDiagram(
      buildErDiagram(selected, { relationships: tableSelect.value === ALL_TABLES }),
    )
  } catch (err) {
    console.error(err)
    showError(
      `Could not read the document schema: ${err.message || err}\n` +
        'This widget needs "Full document access" in the Creator Panel.',
    )
  }
}

// Data/schema changes can arrive in bursts; coalesce them into one refresh.
let refreshTimer = null
function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(refresh, 300)
}

// --- Controls ---

tableSelect.addEventListener('change', () => {
  tableChoice = tableSelect.value
  grist.widgetApi.setOption('table', tableChoice).catch(console.error)
  refresh()
})

refreshButton.addEventListener('click', refresh)

sourceButton.addEventListener('click', () => {
  const open = sourceContainer.classList.toggle('open')
  sourceButton.textContent = open ? 'Hide source' : 'Show source'
})

copyButton.addEventListener('click', async () => {
  const text = sourceArea.value
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard API is often blocked inside iframes; fall back to a selection copy.
    const wasOpen = sourceContainer.classList.contains('open')
    sourceContainer.classList.add('open')
    sourceArea.select()
    document.execCommand('copy')
    if (!wasOpen) sourceContainer.classList.remove('open')
  }
  copyButton.textContent = 'Copied'
  setTimeout(() => (copyButton.textContent = 'Copy'), 1200)
})

// --- Grist connection ---

grist.ready({
  // Reading the _grist_* metadata tables through docApi needs full access.
  requiredAccess: 'full',
})

grist.onOptions((options) => {
  tableChoice = options?.table ?? LINKED_TABLE
  scheduleRefresh()
})

// Adding, removing, renaming or retyping a column in the linked table changes
// its records' shape, so onRecords doubles as a schema-change signal; other
// tables' changes need the Refresh button.
grist.onRecords(() => scheduleRefresh())

scheduleRefresh()
