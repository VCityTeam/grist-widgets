/* global grist, Plot */
'use strict'

// Required - each row's geometry: a GeoJSON Feature, FeatureCollection, or bare
// geometry object, as JSON text (e.g. written by the geocoding-map widget's GeoJson
// column). A FeatureCollection's features are all flattened into the plot, tagged
// with their row's Value/Label/id.
const GeoJson = 'GeoJson'
// Required - the numeric measure that choropleth fill color encodes.
const Value = 'Value'
// Optional - text shown alongside Value in each feature's tooltip.
const Label = 'Label'

const DEFAULT_CONFIG = {
  projection: 'equal-earth',
  scaleType: 'sequential',
  colorScheme: 'blues',
  reverseScheme: false,
  noDataColor: '#e4e4e4',
  strokeColor: '#333333',
  showLegend: true,
  showGraticule: false,
  showSphere: false,
}

const plotEl = document.getElementById('plot')
const statusEl = document.getElementById('status')
const controls = {
  projection: document.getElementById('projection'),
  scaleType: document.getElementById('scale-type'),
  colorScheme: document.getElementById('color-scheme'),
  reverseScheme: document.getElementById('reverse-scheme'),
  noDataColor: document.getElementById('no-data-color'),
  strokeColor: document.getElementById('stroke-color'),
  showLegend: document.getElementById('show-legend'),
  showGraticule: document.getElementById('show-graticule'),
  showSphere: document.getElementById('show-sphere'),
}

let config = { ...DEFAULT_CONFIG }
let features = []
let selectedId = null

function showStatus(message) {
  statusEl.textContent = message || ''
  statusEl.style.display = message ? 'block' : 'none'
}

function syncControlsFromConfig() {
  controls.projection.value = config.projection
  controls.scaleType.value = config.scaleType
  controls.colorScheme.value = config.colorScheme
  controls.reverseScheme.checked = config.reverseScheme
  controls.noDataColor.value = config.noDataColor
  controls.strokeColor.value = config.strokeColor
  controls.showLegend.checked = config.showLegend
  controls.showGraticule.checked = config.showGraticule
  controls.showSphere.checked = config.showSphere
}

async function persistConfig() {
  await grist.widgetApi.setOption('config', config)
}

// Turns each mapped record's GeoJson field into one or more plottable Features,
// flattening a FeatureCollection and wrapping a bare geometry into a Feature. Each
// resulting feature carries the row's choropleth Value (null if missing/blank).
function buildFeatures(records) {
  const result = []
  for (const rec of records) {
    if (!rec[GeoJson]) {
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(rec[GeoJson])
    } catch (e) {
      continue
    }
    const value = rec[Value]
    const props = {
      id: rec.id,
      value: value != null && value !== '' ? Number(value) : null,
      label: rec[Label] ?? null,
    }
    if (parsed.type === 'FeatureCollection') {
      for (const f of parsed.features) {
        result.push({
          type: 'Feature',
          geometry: f.geometry,
          properties: { ...f.properties, ...props },
        })
      }
    } else if (parsed.type === 'Feature') {
      result.push({
        type: 'Feature',
        geometry: parsed.geometry,
        properties: { ...parsed.properties, ...props },
      })
    } else {
      result.push({ type: 'Feature', geometry: parsed, properties: props })
    }
  }
  return result
}

function featureTitle(d) {
  const p = d.properties || {}
  const lines = []
  if (p.label != null) {
    lines.push(String(p.label))
  }
  lines.push(p.value != null ? String(p.value) : 'No data')
  return lines.join('\n')
}

function strokeWidthFor(d) {
  return d.properties?.id != null && d.properties.id === selectedId ? 3 : 1
}

function renderPlot() {
  plotEl.replaceChildren()

  if (features.length === 0) {
    showStatus(
      'No data to display: map GeoJson and Value columns, and select records with valid GeoJSON.',
    )
    return
  }
  showStatus('')

  const marks = []
  if (config.showSphere) {
    marks.push(Plot.sphere({ stroke: 'currentColor', strokeOpacity: 0.3 }))
  }
  if (config.showGraticule) {
    marks.push(Plot.graticule({ stroke: 'currentColor', strokeOpacity: 0.15 }))
  }
  marks.push(
    Plot.geo(features, {
      fill: (d) => d.properties.value,
      stroke: config.strokeColor,
      strokeWidth: strokeWidthFor,
      title: featureTitle,
    }),
  )

  const rect = plotEl.getBoundingClientRect()
  const plot = Plot.plot({
    width: Math.max(200, Math.floor(rect.width)),
    height: Math.max(200, Math.floor(rect.height)),
    projection: config.projection,
    color: {
      type: config.scaleType,
      scheme: config.colorScheme,
      reverse: config.reverseScheme,
      unknown: config.noDataColor,
      legend: config.showLegend,
      label: Value,
    },
    marks,
  })
  plotEl.appendChild(plot)
  attachInteractivity(plot)
}

// Wires clicks on rendered geo paths back to Grist's cursor. Plot.geo renders one
// <path> per feature, in data order, inside a <g aria-label="geo"> group.
function attachInteractivity(plot) {
  const group = plot.querySelector('g[aria-label="geo"]')
  if (!group) {
    return
  }
  const paths = group.children
  for (let i = 0; i < paths.length && i < features.length; i++) {
    const feature = features[i]
    if (feature.properties?.id == null) {
      continue
    }
    paths[i].addEventListener('click', () => {
      grist.setCursorPos?.({ rowId: feature.properties.id }).catch(() => {})
    })
  }
}

let resizeTimer = null
new ResizeObserver(() => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(renderPlot, 100)
}).observe(plotEl)

for (const [key, el] of Object.entries(controls)) {
  const prop = key
  el.addEventListener('change', () => {
    const value = el.type === 'checkbox' ? el.checked : el.value
    config = { ...config, [prop]: value }
    renderPlot()
    persistConfig()
  })
}

grist.onRecords((data) => {
  const records = grist.mapColumnNames(data) || data
  features = buildFeatures(records)
  renderPlot()
})

grist.onRecord((record) => {
  const rec = grist.mapColumnNames(record) || record
  if (rec && rec.id != null) {
    selectedId = rec.id
    renderPlot()
  }
})

grist.onOptions((options) => {
  config = { ...DEFAULT_CONFIG, ...(options || {}).config }
  syncControlsFromConfig()
  renderPlot()
})

grist.ready({
  columns: [GeoJson, { name: Value, type: 'Numeric' }, { name: Label, type: 'Text', optional: true }],
  allowSelectBy: true,
})

syncControlsFromConfig()
