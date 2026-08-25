/* global grist, DOMPurify */
'use strict'

// Adapted from https://github.com/gristlabs/grist-widget/tree/master/printlabels to render
// LabelHtml as sanitized HTML (images, formatting, line breaks via tags) instead of escaped
// plain text.

const LabelHtml = 'LabelHtml'
const LabelCount = 'LabelCount'

const TEMPLATES = [
  { id: 'labels8', name: '8 per sheet (2-1/3" x 3-3/8")', perPage: 8 },
  { id: 'labels10', name: '10 per sheet (2" x 4")', perPage: 10 },
  { id: 'labels20', name: '20 per sheet (1" x 4")', perPage: 20 },
  { id: 'labels30', name: '30 per sheet (1" x 2-5/8")', perPage: 30 },
  { id: 'labels60', name: '60 per sheet (1/2" x 1-3/4")', perPage: 60 },
  { id: 'labels80', name: '80 per sheet (1/2" x 1-3/4")', perPage: 80 },
  { id: 'badge1', name: '1 per sheet (badge, 7.5" x 10")', perPage: 1 },
]
const DEFAULT_TEMPLATE = TEMPLATES.find((t) => t.id === 'labels30')

function findTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || DEFAULT_TEMPLATE
}

const statusEl = document.getElementById('status')
const headerEl = document.getElementById('header')
const pagesEl = document.getElementById('pages')
const labelTypeSelect = document.getElementById('labeltype')
const optionsBtn = document.getElementById('options-btn')
const optionsContainer = document.getElementById('options-container')
const optionsPopup = document.getElementById('options-popup')
const blanksInput = document.getElementById('blanks')

let rows = null
let template = DEFAULT_TEMPLATE
let blanks = 0

for (const tmpl of TEMPLATES) {
  const option = document.createElement('option')
  option.value = tmpl.id
  option.textContent = tmpl.name
  labelTypeSelect.appendChild(option)
}

function showStatus(message) {
  statusEl.textContent = message
  statusEl.style.display = message ? 'block' : 'none'
  headerEl.style.display = message ? 'none' : 'flex'
  pagesEl.style.display = message ? 'none' : ''
}

// Splits the flat label list into pages of template.perPage labels, padding the front with
// `blanks` empty labels and the last page's tail with empty labels so the grid stays full.
function arrangeLabels(labels, tmpl, blankCount) {
  const pages = []
  let page = []
  for (let i = 0; i < blankCount + labels.length; i++) {
    if (page.length >= tmpl.perPage) {
      pages.push(page)
      page = []
    }
    page.push(i < blankCount ? '' : labels[i - blankCount])
  }
  while (page.length < tmpl.perPage) {
    page.push('')
  }
  pages.push(page)
  return pages
}

function buildLabels(records) {
  const haveCounts = records[0].hasOwnProperty(LabelCount)
  const labels = []
  for (const r of records) {
    const count = haveCounts ? parseFloat(r[LabelCount]) : 1
    for (let i = 0; i < count; i++) {
      labels.push(r[LabelHtml])
    }
  }
  return labels
}

function renderPages(pages) {
  pagesEl.innerHTML = ''
  for (const page of pages) {
    const pageOuter = document.createElement('div')
    pageOuter.className = 'page-outer'

    const labelPage = document.createElement('div')
    labelPage.className = `labelpage page-${template.id}`

    for (const label of page) {
      const labelEl = document.createElement('div')
      labelEl.className = `label label-${template.id}`
      const content = document.createElement('div')
      content.className = 'label-content'
      content.innerHTML = label ? DOMPurify.sanitize(label) : ''
      labelEl.appendChild(content)
      labelPage.appendChild(labelEl)
    }

    pageOuter.appendChild(labelPage)
    pagesEl.appendChild(pageOuter)
  }
}

function render() {
  if (!rows || !rows.length) {
    showStatus('No data. Please add some rows')
    return
  }
  if (!rows[0].hasOwnProperty(LabelHtml)) {
    showStatus('Please pick a column to show in the Creator Panel.')
    return
  }
  showStatus('')
  renderPages(arrangeLabels(buildLabels(rows), template, blanks))
  setTimeout(updateSize, 0)
}

// Page width before any scaling is applied.
let pageWidth = null

function updateSize() {
  const page = document.querySelector('.page-outer')
  if (!page) return
  if (!pageWidth) {
    pageWidth = page.getBoundingClientRect().width
  }
  document.body.style.setProperty('--page-scaling', window.innerWidth / pageWidth)
}

async function saveOptions() {
  await grist.widgetApi.setOption('template', template.id)
  await grist.widgetApi.setOption('blanks', blanks)
}

labelTypeSelect.addEventListener('change', () => {
  template = findTemplate(labelTypeSelect.value)
  saveOptions()
  render()
})

blanksInput.addEventListener('change', () => {
  blanks = parseInt(blanksInput.value, 10) || 0
  saveOptions()
  render()
})

optionsBtn.addEventListener('click', () => {
  optionsContainer.classList.add('show')
})
optionsContainer.addEventListener('click', () => {
  optionsContainer.classList.remove('show')
})
optionsPopup.addEventListener('click', (e) => e.stopPropagation())

window.addEventListener('resize', updateSize)

grist.ready({
  requiredAccess: 'read table',
  columns: [
    { name: LabelHtml, title: 'Label HTML', type: 'Text' },
    { name: LabelCount, title: 'Label count', type: 'Numeric', optional: true },
  ],
})

grist.onOptions((options) => {
  template = findTemplate(options && options.template)
  blanks = (options && options.blanks) || 0
  labelTypeSelect.value = template.id
  blanksInput.value = blanks
  render()
})

grist.onRecords((records) => {
  rows = grist.mapColumnNames(records) || records
  render()
})
