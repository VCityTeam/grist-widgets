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

let currentColumn = "mermaid"
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

// --- Moteur de rendu Mermaid Corrigé ---
async function renderMermaid(code) {
  // On masque TOUJOURS l'erreur au début d'une nouvelle tentative de rendu
  errorDiv.style.display = "none"
  errorDiv.innerText = ""

  if (!code || code.trim() === "") {
    element.innerHTML = ""
    return
  }

  const uniqueId = "mermaid-" + Date.now()

  try {
    // Étape 1: Tenter de générer le SVG
    const { svg } = await mermaid.render(uniqueId, code)

    // Étape 2: Si ça réussit, on met à jour le DOM
    element.innerHTML = svg
    updateTransform()
  } catch (err) {
    // Étape 3: Si ça échoue (erreur de frappe), on affiche l'erreur en bas
    errorDiv.innerText = err.message || err
    errorDiv.style.display = "block"

    // On nettoie le badge généré en cache par Mermaid qui pollue le DOM en cas d'échec
    const badElement = document.getElementById(uniqueId)
    if (badElement) badElement.remove()

    // Note : On ne vide pas l'ancien diagramme valide tant que l'utilisateur n'a pas fini de taper,
    // ce qui évite que l'écran clignote pendant la saisie.
  }
}

// --- Saisie et Sauvegarde ---
editor.addEventListener("input", (e) => {
  const code = e.target.value

  // Rendu visuel
  renderMermaid(code)

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

  currentColumn = mappings && mappings.mermaid ? mappings.mermaid : "mermaid"
  currentRecordId = record.id

  if (document.activeElement !== editor) {
    const code = record[currentColumn] || ""
    editor.value = code
    renderMermaid(code)
  }
})
