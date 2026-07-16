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

let currentColumn = "markdown"
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

// --- Moteur de rendu Markdown + Mermaid ---
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
      // On laisse le bloc de code source affiché (avec un style d'erreur) plutôt que de le vider,
      // ce qui évite que l'écran clignote pendant la saisie.
      target.classList.add("mermaid-error")
      errors.push(err.message || String(err))

      // On nettoie le badge généré en cache par Mermaid qui pollue le DOM en cas d'échec
      const badElement = document.getElementById(uniqueId)
      if (badElement) badElement.remove()
    }
  }

  return errors
}

async function renderContent(text) {
  // On masque TOUJOURS l'erreur au début d'une nouvelle tentative de rendu
  errorDiv.style.display = "none"
  errorDiv.innerText = ""

  if (!text || text.trim() === "") {
    element.innerHTML = ""
    return
  }

  // Étape 1: Convertir le Markdown en HTML (les blocs ```mermaid deviennent
  // des <code class="language-mermaid">)
  element.innerHTML = marked.parse(text)

  // Étape 2: Remplacer chaque bloc mermaid par son SVG rendu
  const errors = await renderMermaidBlocks(element)
  updateTransform()

  if (errors.length > 0) {
    errorDiv.innerText = errors.join("\n\n")
    errorDiv.style.display = "block"
  }
}

// --- Saisie et Sauvegarde ---
editor.addEventListener("input", (e) => {
  const code = e.target.value

  // Rendu visuel
  renderContent(code)

  // Sauvegarde Grist
  if (currentRecordId) {
    grist.selectedTable
      .update({
        id: currentRecordId,
        fields: { [currentColumn]: code },
      })
      .catch((err) => console.error("Erreur d'écriture Grist:", err))
  }
})

// --- Connexion Grist ---
grist.ready({ requiredAccess: "full" })

grist.onRecord((record, mappings) => {
  if (!record) return

  currentColumn = mappings && mappings.markdown ? mappings.markdown : "markdown"
  currentRecordId = record.id

  if (document.activeElement !== editor) {
    const code = record[currentColumn] || ""
    editor.value = code
    renderContent(code)
  }
})
