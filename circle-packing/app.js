/* global grist, d3 */
'use strict'

// Required - text shown on each leaf circle.
const Label = 'Label'
// Required - determines each leaf circle's area (must be > 0 to be packed).
const Value = 'Value'
// Optional - hierarchy path for the record, e.g. "Fruit/Citrus". Records that
// share a path segment are nested inside the same group circle. Unmapped
// records (or an unmapped column) become direct children of the root circle.
const Group = 'Group'
// Optional - categorical key used to color leaf circles (e.g. a status or
// type column). Leaves are white when unmapped; group circles are always
// colored by depth, independent of this field.
const Color = 'Color'

const PATH_SEPARATOR = '/'
// Internal coordinate space for d3.pack(); the <svg> viewBox maps this back
// to whatever size the widget panel actually is, so it stays responsive
// without needing a resize observer.
const SIZE = 640
const PADDING = 3

// Group circles are tinted by depth (deeper = darker/bluer); leaves are
// either white or colored by the optional Color column, see leafFill().
const DEPTH_COLOR = d3
  .scaleLinear()
  .domain([0, 6])
  .range(['hsl(152,70%,90%)', 'hsl(228,25%,45%)'])
  .interpolate(d3.interpolateHcl)

const svg = d3.select('#chart')
const statusEl = document.getElementById('status')
const breadcrumbEl = document.getElementById('breadcrumb')

let rootHierarchy = null // current d3.hierarchy root, after pack() has run
let node = null // <circle> selection for the current render
let label = null // <text> selection for the current render
let focus = null // node currently zoomed to fill the view
let view = null // [x, y, diameter] last passed to zoomTo()
let selectedId = null // Grist row id highlighted (from a click or onRecord)
// Names from root to the current focus, so a data refresh (onRecords fires
// on almost any edit to the table) can restore the user's zoom level instead
// of always snapping back out to the root circle.
let focusPath = []

function showStatus(msg) {
  statusEl.textContent = msg || ''
  statusEl.style.display = msg ? 'block' : 'none'
}

// Turns the flat record list into the nested {name, children} shape
// d3.hierarchy() expects, grouping records by Group path segments.
function buildHierarchy(records) {
  const root = { name: 'root', children: [] }
  const groupIndex = new Map()
  groupIndex.set('', root)

  for (const rec of records) {
    const value = Number(rec[Value])
    if (!Number.isFinite(value) || value <= 0 || !rec[Label]) {
      continue
    }
    const segments = rec[Group]
      ? String(rec[Group])
          .split(PATH_SEPARATOR)
          .map((s) => s.trim())
          .filter(Boolean)
      : []

    let parent = root
    let pathKey = ''
    for (const segment of segments) {
      pathKey += PATH_SEPARATOR + segment
      let groupNode = groupIndex.get(pathKey)
      if (!groupNode) {
        groupNode = { name: segment, children: [] }
        groupIndex.set(pathKey, groupNode)
        parent.children.push(groupNode)
      }
      parent = groupNode
    }

    parent.children.push({
      name: String(rec[Label]),
      value,
      id: rec.id,
      color: rec[Color] ?? null,
    })
  }

  return root
}

// Builds a categorical color scale from whatever Color values are present
// among the leaves, or null if the Color column isn't mapped/used.
function buildCategoryScale(root) {
  const values = new Set()
  root.each((d) => {
    if (!d.children && d.data.color != null) {
      values.add(d.data.color)
    }
  })
  return values.size > 0
    ? d3.scaleOrdinal(d3.schemeTableau10).domain([...values])
    : null
}

function leafFill(d, categoryScale) {
  return categoryScale && d.data.color != null
    ? categoryScale(d.data.color)
    : 'lightgrey'
}

function isSelected(d) {
  return d.data.id != null && d.data.id === selectedId
}

function strokeFor(d) {
  return isSelected(d)
    ? { stroke: '#ff7800', width: 3 }
    : { stroke: null, width: null }
}

function updateSelectionStyle() {
  if (!node) {
    return
  }
  node
    .attr('stroke', (d) => strokeFor(d).stroke)
    .attr('stroke-width', (d) => strokeFor(d).width)
}

function findNodeByPath(root, path) {
  let current = root
  for (const name of path) {
    const next = (current.children || []).find((c) => c.data.name === name)
    if (!next) {
      return root
    }
    current = next
  }
  return current
}

function isWithinFocus(d) {
  let a = d
  while (a) {
    if (a === focus) {
      return true
    }
    a = a.parent
  }
  return false
}

function updateBreadcrumb() {
  breadcrumbEl.innerHTML = ''
  const chain = focus.ancestors().reverse()
  chain.forEach((d, i) => {
    if (i > 0) {
      const sep = document.createElement('span')
      sep.className = 'sep'
      sep.textContent = '›'
      breadcrumbEl.appendChild(sep)
    }
    const span = document.createElement('span')
    span.textContent = d.data.name === 'root' ? 'All' : d.data.name
    if (d === focus) {
      span.className = 'current'
    } else {
      span.addEventListener('click', () => zoom(d))
    }
    breadcrumbEl.appendChild(span)
  })
}

// Applies a [x, y, diameter] view rect to the current node/label selections.
// Coordinates are translated relative to the view's center so the fixed
// viewBox (centered on 0,0) always shows whatever is currently focused.
function zoomTo(v) {
  const k = SIZE / v[2]
  view = v
  label.attr(
    'transform',
    (d) => `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`,
  )
  node
    .attr(
      'transform',
      (d) => `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`,
    )
    .attr('r', (d) => d.r * k)
}

function zoom(d, slow) {
  focus = d
  focusPath = focus
    .ancestors()
    .reverse()
    .slice(1)
    .map((n) => n.data.name)
  updateBreadcrumb()

  const transition = svg
    .transition()
    .duration(slow ? 3000 : 750)
    .tween('zoom', () => {
      const i = d3.interpolateZoom(view, [focus.x, focus.y, focus.r * 2])
      return (t) => zoomTo(i(t))
    })

  label
    .filter(function (d) {
      return d.parent === focus || this.style.display === 'inline'
    })
    .transition(transition)
    .style('fill-opacity', (d) => (d.parent === focus ? 1 : 0))
    .on('start', function (d) {
      if (d.parent === focus) {
        this.style.display = 'inline'
      }
    })
    .on('end', function (d) {
      if (d.parent !== focus) {
        this.style.display = 'none'
      }
    })
}

function selectLeaf(d) {
  selectedId = d.data.id
  updateSelectionStyle()
  grist.setCursorPos?.({ rowId: d.data.id }).catch(() => {})
}

// Mirrors a cursor move made in Grist: highlights the matching leaf, and
// zooms out just far enough to bring it into view if it's hidden behind the
// current zoom level (without disturbing the zoom otherwise).
function selectFromGrist(id) {
  selectedId = id
  updateSelectionStyle()
  if (!rootHierarchy) {
    return
  }
  const target = rootHierarchy.descendants().find((d) => d.data.id === id)
  if (target && !isWithinFocus(target)) {
    zoom(target.parent || rootHierarchy)
  }
}

function clearChart() {
  svg.selectAll('*').remove()
  rootHierarchy = null
  node = null
  label = null
  focus = null
  breadcrumbEl.innerHTML = ''
}

function renderChart(root) {
  rootHierarchy = root
  const categoryScale = buildCategoryScale(root)

  svg.selectAll('*').remove()
  svg.attr('viewBox', `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`)

  focus = findNodeByPath(root, focusPath)

  node = svg
    .append('g')
    .selectAll('circle')
    .data(root.descendants().slice(1))
    .join('circle')
    .attr('fill', (d) =>
      d.children ? DEPTH_COLOR(d.depth) : leafFill(d, categoryScale),
    )
    .attr('fill-opacity', (d) => (d.children ? 1 : 0.85))
    .on('mouseover', function () {
      d3.select(this).attr('stroke', '#333').attr('stroke-width', 1.5)
    })
    .on('mouseout', function (event, d) {
      const s = strokeFor(d)
      d3.select(this).attr('stroke', s.stroke).attr('stroke-width', s.width)
    })
    .on('click', (event, d) => {
      event.stopPropagation()
      if (d.children) {
        if (focus !== d) {
          zoom(d, event.altKey)
        }
      } else if (d.data.id != null) {
        selectLeaf(d)
      }
    })

  label = svg
    .append('g')
    .style('font', '10px sans-serif')
    .attr('pointer-events', 'none')
    .attr('text-anchor', 'middle')
    .selectAll('text')
    .data(root.descendants())
    .join('text')
    .style('fill-opacity', (d) => (d.parent === focus ? 1 : 0))
    .style('display', (d) => (d.parent === focus ? 'inline' : 'none'))
    .text((d) => d.data.name)

  svg.on('click', () => {
    if (focus !== root) {
      zoom(root)
    }
  })

  updateSelectionStyle()
  updateBreadcrumb()
  zoomTo([focus.x, focus.y, focus.r * 2])
}

function renderRecords(records) {
  showStatus('')
  const data = buildHierarchy(records)
  const hierarchy = d3
    .hierarchy(data)
    .sum((d) => d.value || 0)
    .sort((a, b) => b.value - a.value)

  if (!hierarchy.value) {
    clearChart()
    showStatus(
      'No data to display: map Label and Value columns, with at least one positive numeric Value.',
    )
    return
  }

  const root = d3.pack().size([SIZE, SIZE]).padding(PADDING)(hierarchy)
  renderChart(root)
}

grist.onRecords((data, mappings) => {
  const records = grist.mapColumnNames(data) || data
  renderRecords(records)
})

grist.onRecord((record) => {
  const rec = grist.mapColumnNames(record) || record
  if (rec && rec.id != null) {
    selectFromGrist(rec.id)
  }
})

grist.ready({
  columns: [
    Label,
    { name: Value, type: 'Numeric' },
    { name: Group, type: 'Choice', title: 'Group', optional: true },
    { name: Color, type: 'Choice', title: 'Color Category', optional: true },
  ],
  allowSelectBy: true,
})
