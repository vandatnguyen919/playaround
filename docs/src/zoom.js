// Click an image or a Mermaid diagram on a page to open it in a zoom view.
// Zoom with the wheel, a pinch, double click, the buttons or + - 0 keys; drag
// to move; Esc, the close button or a click on the empty area closes it.
// No dependency: a <dialog> and pointer events. Loaded as a client module.
import ExecutionEnvironment from '@docusaurus/ExecutionEnvironment'

const TARGETS = '.markdown img, .docusaurus-mermaid-container svg'
const MIN = 0.5
const MAX = 10
const STEP = 1.25

let dialog, stage, content, label
let scale = 1
let x = 0
let y = 0
const pointers = new Map()
let pinch = null
let moved = false
let pressedEmpty = false

function apply() {
  content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  label.textContent = `${Math.round(scale * 100)}%`
}

// Zoom by factor, keeping the point under (cx, cy) in place.
function zoomAt(factor, cx, cy) {
  const next = Math.min(MAX, Math.max(MIN, scale * factor))
  const r = stage.getBoundingClientRect()
  const px = (cx ?? r.left + r.width / 2) - r.left - r.width / 2
  const py = (cy ?? r.top + r.height / 2) - r.top - r.height / 2
  x = px - ((px - x) * next) / scale
  y = py - ((py - y) * next) / scale
  scale = next
  apply()
}

function reset() {
  scale = 1
  x = 0
  y = 0
  apply()
}

function build() {
  dialog = document.createElement('dialog')
  dialog.className = 'zoom-dialog'
  dialog.setAttribute('aria-label', 'Zoomed view')
  dialog.innerHTML = `
    <div class="zoom-toolbar">
      <button type="button" data-act="out" aria-label="Zoom out" title="Zoom out (-)">&minus;</button>
      <button type="button" data-act="reset" aria-label="Reset zoom" title="Reset (0)" class="zoom-level">100%</button>
      <button type="button" data-act="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
      <button type="button" data-act="close" aria-label="Close" title="Close (Esc)">&times;</button>
    </div>
    <div class="zoom-stage"><div class="zoom-content"></div></div>
    <p class="zoom-hint">Scroll or pinch to zoom, drag to move, Esc to close</p>`
  document.body.appendChild(dialog)
  stage = dialog.querySelector('.zoom-stage')
  content = dialog.querySelector('.zoom-content')
  label = dialog.querySelector('.zoom-level')

  dialog.querySelector('.zoom-toolbar').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act
    if (act === 'in') zoomAt(STEP)
    else if (act === 'out') zoomAt(1 / STEP)
    else if (act === 'reset') reset()
    else if (act === 'close') dialog.close()
  })

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
    },
    { passive: false },
  )

  stage.addEventListener('dblclick', (e) => {
    if (scale > 1.01) reset()
    else zoomAt(2.5, e.clientX, e.clientY)
  })

  stage.addEventListener('pointerdown', (e) => {
    // Read the target before capture: once captured, the click is reported on
    // the stage wherever it happened.
    if (pointers.size === 0) pressedEmpty = e.target === stage
    stage.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) moved = false
    pinch = null
  })
  stage.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) {
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      if (Math.abs(dx) + Math.abs(dy) > 0) moved = true
      x += dx
      y += dy
      apply()
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch) zoomAt(dist / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2)
      pinch = dist
      moved = true
    }
  })
  const up = (e) => {
    pointers.delete(e.pointerId)
    pinch = null
  }
  stage.addEventListener('pointerup', up)
  stage.addEventListener('pointercancel', up)

  // A click on the empty area around the picture closes, unless it ended a drag.
  stage.addEventListener('click', () => {
    if (!moved && pressedEmpty) dialog.close()
  })

  dialog.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(STEP)
    else if (e.key === '-') zoomAt(1 / STEP)
    else if (e.key === '0') reset()
  })

  dialog.addEventListener('close', () => {
    content.replaceChildren()
    document.documentElement.classList.remove('zoom-open')
  })
}

function open(target) {
  if (!dialog) build()
  const rect = target.getBoundingClientRect()
  const copy = target.cloneNode(true)
  copy.removeAttribute('loading')
  copy.style.maxWidth = 'none'
  copy.style.maxHeight = 'none'
  content.replaceChildren(copy)
  document.documentElement.classList.add('zoom-open')
  dialog.showModal()

  // Start fitted to the stage, then let transforms do the zooming.
  const s = stage.getBoundingClientRect()
  const fit = Math.min((s.width * 0.95) / rect.width, (s.height * 0.95) / rect.height)
  copy.style.width = `${rect.width * fit}px`
  copy.style.height = `${rect.height * fit}px`
  reset()
  dialog.querySelector('[data-act="close"]').focus()
}

if (ExecutionEnvironment.canUseDOM) {
  document.addEventListener('click', (e) => {
    const target = e.target.closest?.(TARGETS)
    if (!target || target.closest('a') || target.closest('.zoom-dialog')) return
    e.preventDefault()
    open(target)
  })
}
