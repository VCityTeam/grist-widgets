// This code is adapted from https://docs.getgrist.com/doc/qnJkZmcudBnq~cAvV7yyj2tZn4q5CD5zpgo

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  theme: "default",
})

const editor = document.getElementById("editor")
const canvas = document.getElementById("canvas")
const element = document.getElementById("diagram")
const errorDiv = document.getElementById("error")

let scale = 1
let translateX = 10
let translateY = 10
let isDragging = false
let startX, startY

const MARKDOWN_COLUMN = "markdown"

let currentColumn = MARKDOWN_COLUMN
let currentRecordId = null

function updateTransform() {
  element.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`
}

// --- Zoom & Pan ---
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault()
    scale += e.deltaY < 0 ? 0.1 : -0.1
    scale = Math.max(0.1, Math.min(scale, 5))
    updateTransform()
  },
  { passive: false }
)

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return
  isDragging = true
  startX = e.clientX - translateX
  startY = e.clientY - translateY
})
window.addEventListener("mousemove", (e) => {
  if (!isDragging) return
  translateX = e.clientX - startX
  translateY = e.clientY - startY
  updateTransform()
})
window.addEventListener("mouseup", () => (isDragging = false))

// --- Markdown + Mermaid rendering engine ---
async function renderMermaidBlocks(container) {
  const errors = []
  const codeBlocks = container.querySelectorAll("code.language-mermaid")

  let i = 0
  for (const codeBlock of codeBlocks) {
    const code = codeBlock.textContent
    const uniqueId = `mermaid-${Date.now()}-${i++}`
    const target = codeBlock.closest("pre") || codeBlock

    try {
      const { svg } = await mermaid.render(uniqueId, code)
      const wrapper = document.createElement("div")
      wrapper.innerHTML = svg
      target.replaceWith(wrapper.firstElementChild)
    } catch (err) {
      // Leave the source code block displayed (with an error style) instead of clearing it,
      // which avoids the screen flickering while the user is typing.
      target.classList.add("mermaid-error")
      errors.push(err.message || String(err))

      // Clean up the cached badge Mermaid generates that pollutes the DOM on failure
      const badElement = document.getElementById(uniqueId)
      if (badElement) badElement.remove()
    }
  }

  return errors
}

async function renderContent(text) {
  // ALWAYS hide the error at the start of a new render attempt
  errorDiv.style.display = "none"
  errorDiv.innerText = ""

  if (!text || text.trim() === "") {
    element.innerHTML = ""
    return
  }

  // Step 1: Convert the Markdown to HTML (```mermaid blocks become
  // <code class="language-mermaid">)
  element.innerHTML = marked.parse(text)

  // Step 2: Replace each mermaid block with its rendered SVG
  const errors = await renderMermaidBlocks(element)
  updateTransform()

  if (errors.length > 0) {
    errorDiv.innerText = errors.join("\n\n")
    errorDiv.style.display = "block"
  }
}

// --- Input and saving ---
editor.addEventListener("input", (e) => {
  const code = e.target.value

  // Visual render
  renderContent(code)

  // Save to Grist
  if (currentRecordId) {
    grist.selectedTable
      .update({
        id: currentRecordId,
        fields: { [currentColumn]: code },
      })
      .catch((err) => console.error("Grist write error:", err))
  }
})

// --- Grist connection ---
function getMappedColumn(mappings) {
  return (mappings && mappings[MARKDOWN_COLUMN]) || MARKDOWN_COLUMN
}

function loadRecord(record, column) {
  currentColumn = column
  currentRecordId = record.id

  if (document.activeElement !== editor) {
    const code = record[column] || ""
    editor.value = code
    renderContent(code)
  }
}

grist.ready({
  requiredAccess: "full",
  // Declaring the required column lets Grist link it correctly
  // (cell selection, mapping in the configuration panel).
  columns: [{ name: MARKDOWN_COLUMN, title: "Markdown", type: "Text" }],
})

grist.onRecord((record, mappings) => {
  if (!record) return
  loadRecord(record, getMappedColumn(mappings))
})

// If no row has been selected yet when the widget loads, show the first
// row whose Markdown column isn't empty as the default.
grist.onRecords((records, mappings) => {
  if (currentRecordId !== null || !records) return

  const column = getMappedColumn(mappings)
  const first = records.find((r) => r[column])
  if (first) loadRecord(first, column)
})
