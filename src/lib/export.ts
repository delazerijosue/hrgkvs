/**
 * Export engine (Seção 7).
 *  - PNG: rasterized on an offscreen canvas at 150 DPI.
 *  - PDF: vector — built as an SVG document and converted with svg2pdf.js.
 *    Etiqueta e tagline entram como vetor real (<g> com o markup SVG
 *    inlined) quando o asset (padrão ou enviado pelo usuário) é SVG;
 *    quando é PNG/JPG (padrão ou upload), entram como raster embutido em
 *    alta resolução. A foto é sempre raster, por natureza.
 */
import { jsPDF } from 'jspdf'
import 'svg2pdf.js'
import { computeLayout } from './layout'
import { getEtiquetaRenderRect, type EtiquetaLayer, type ResolvedEtiqueta } from './assets'
import { getGuideBoxes, type GuideBox } from './guides'
import { coverScale } from './photo'
import { pxToMm, pxToExportPixels } from './units'
import { assetUrl } from './url'
import { resolveFrameAssets } from './frame'
import type { Frame } from '../types'
import type { Rect } from './layout'

const SVG_NS = 'http://www.w3.org/2000/svg'
const PLACEHOLDER_GRAY = '#9aa5ab'

// Fonte customizada da tagline (variante A). Registrada no jsPDF para que
// svg2pdf.js converta o texto em glifos vetoriais reais, em vez de cair
// numa fonte padrão do PDF.
const HERING_FONT_FILE = 'HeringSans-Bold.ttf'
const HERING_FONT_FAMILY = 'HeringSans-Bold'
let heringFontBase64: Promise<string> | null = null

function loadHeringFontBase64(): Promise<string> {
  if (!heringFontBase64) {
    heringFontBase64 = fetch(assetUrl('assets/fonts/HeringSans-Bold.ttf'))
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        return btoa(binary)
      })
  }
  return heringFontBase64
}

async function registerCustomFonts(pdf: jsPDF) {
  const base64 = await loadHeringFontBase64()
  pdf.addFileToVFS(HERING_FONT_FILE, base64)
  pdf.addFont(HERING_FONT_FILE, HERING_FONT_FAMILY, 'normal', 700)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function frameLayout(frame: Frame) {
  const { etiquetaAsset: etiqueta, taglineAsset: tagline, variant } = resolveFrameAssets(frame)
  const layout = computeLayout(frame.widthPx, frame.heightPx, frame.overrides, etiqueta.aspectRatio, tagline.aspectRatio)
  return { layout, etiqueta, tagline, variant }
}

function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

function filenameFor(frame: Frame, ext: string): string {
  const safe = frame.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
  return `${safe || 'frame'}.${ext}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---------- Canvas rendering (compartilhado entre PNG e os rasters do PDF) ----------

/** Desenha a foto do frame (ou o placeholder cinza) em `ctx`, dentro de `destRect`, na origem local `(originX, originY)` — permite tanto renderizar o frame inteiro (origin 0,0) quanto recortar só um pedaço (ex.: o patch da etiqueta). */
async function drawPhotoInto(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  photoArea: Rect,
  destRect: Rect,
  originX: number,
  originY: number,
  scale: number,
) {
  ctx.save()
  ctx.beginPath()
  ctx.rect((destRect.x - originX) * scale, (destRect.y - originY) * scale, destRect.width * scale, destRect.height * scale)
  ctx.clip()
  if (frame.photo) {
    const img = await loadImage(frame.photo.src)
    const { scale: zoom, panX, panY, rotation } = frame.photo.transform
    const base = coverScale(photoArea, frame.photo.naturalWidth, frame.photo.naturalHeight)
    const w = frame.photo.naturalWidth * base * zoom
    const h = frame.photo.naturalHeight * base * zoom
    const cx = photoArea.x + photoArea.width / 2 + panX
    const cy = photoArea.y + photoArea.height / 2 + panY
    ctx.translate((cx - originX) * scale, (cy - originY) * scale)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(img, (-w / 2) * scale, (-h / 2) * scale, w * scale, h * scale)
  } else {
    ctx.fillStyle = PLACEHOLDER_GRAY
    ctx.fillRect((destRect.x - originX) * scale, (destRect.y - originY) * scale, destRect.width * scale, destRect.height * scale)
  }
  ctx.restore()
}

/** Desenha a etiqueta (sombra em multiply + frente) em `ctx`, na origem local `(originX, originY)`. */
async function drawEtiquetaInto(
  ctx: CanvasRenderingContext2D,
  etiqueta: ResolvedEtiqueta,
  etiquetaRect: Rect,
  originX: number,
  originY: number,
  scale: number,
) {
  const x = (etiquetaRect.x - originX) * scale
  const y = (etiquetaRect.y - originY) * scale
  const w = etiquetaRect.width * scale
  const h = etiquetaRect.height * scale
  if (etiqueta.shadow) {
    const shadowImg = await loadImage(etiqueta.shadow.src)
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(shadowImg, x, y, w, h)
    ctx.restore()
  }
  const frontImg = await loadImage(etiqueta.front.src)
  ctx.drawImage(frontImg, x, y, w, h)
}

// ---------- PNG (150 DPI) ----------

export async function exportFramePNG(frame: Frame): Promise<void> {
  const { layout, etiqueta, tagline } = frameLayout(frame)
  const scale = pxToExportPixels(1)

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(frame.widthPx * scale)
  canvas.height = Math.round(frame.heightPx * scale)
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const photoArea = layout.photoArea
  await drawPhotoInto(ctx, frame, photoArea, photoArea, 0, 0, scale)

  const etiquetaRect = getEtiquetaRenderRect(etiqueta, layout.etiqueta)
  await drawEtiquetaInto(ctx, etiqueta, etiquetaRect, 0, 0, scale)

  const taglineImg = await loadImage(tagline.src)
  ctx.drawImage(
    taglineImg,
    layout.tagline.x * scale,
    layout.tagline.y * scale,
    layout.tagline.width * scale,
    layout.tagline.height * scale,
  )

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  )
  downloadBlob(blob, filenameFor(frame, 'png'))
}

// ---------- PDF (vector) ----------

const svgSourceCache: Record<string, Promise<{ inner: string; viewBox: [number, number, number, number] }>> = {}

function parseSvgMarkup(text: string): { inner: string; viewBox: [number, number, number, number] } {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  let viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/\s+/).map(Number)
  if (viewBox.length !== 4 || viewBox.some(Number.isNaN)) {
    const w = parseFloat(root.getAttribute('width') ?? '100')
    const h = parseFloat(root.getAttribute('height') ?? '100')
    viewBox = [0, 0, w, h]
  }
  return { inner: root.innerHTML, viewBox: viewBox as [number, number, number, number] }
}

function getSvgSource(layer: EtiquetaLayer) {
  if (layer.svgText) return Promise.resolve(parseSvgMarkup(layer.svgText))
  if (!svgSourceCache[layer.src]) {
    svgSourceCache[layer.src] = fetch(layer.src)
      .then((r) => r.text())
      .then(parseSvgMarkup)
  }
  return svgSourceCache[layer.src]
}

/** Adiciona uma camada (etiqueta ou tagline) ao SVG de exportação, como vetor real quando é SVG, ou <image> raster caso contrário. */
async function appendLayer(svg: SVGSVGElement, layer: EtiquetaLayer, rect: Rect) {
  if (layer.kind === 'svg') {
    const { inner, viewBox } = await getSvgSource(layer)
    const [, , vbWidth, vbHeight] = viewBox
    const group = document.createElementNS(SVG_NS, 'g')
    const scaleX = rect.width / vbWidth
    const scaleY = rect.height / vbHeight
    group.setAttribute('transform', `translate(${rect.x}, ${rect.y}) scale(${scaleX}, ${scaleY})`)
    group.innerHTML = inner
    svg.appendChild(group)
  } else {
    const image = document.createElementNS(SVG_NS, 'image')
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', layer.src)
    image.setAttribute('href', layer.src)
    image.setAttribute('x', String(rect.x))
    image.setAttribute('y', String(rect.y))
    image.setAttribute('width', String(rect.width))
    image.setAttribute('height', String(rect.height))
    svg.appendChild(image)
  }
}

function createFrameSvg(frame: Frame): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('width', String(frame.widthPx))
  svg.setAttribute('height', String(frame.heightPx))
  svg.setAttribute('viewBox', `0 0 ${frame.widthPx} ${frame.heightPx}`)

  const bg = document.createElementNS(SVG_NS, 'rect')
  bg.setAttribute('x', '0')
  bg.setAttribute('y', '0')
  bg.setAttribute('width', String(frame.widthPx))
  bg.setAttribute('height', String(frame.heightPx))
  bg.setAttribute('fill', '#ffffff')
  svg.appendChild(bg)
  return svg
}

async function savePdfFromSvg(frame: Frame, svg: SVGSVGElement, embedFont: boolean): Promise<void> {
  const widthMm = pxToMm(frame.widthPx)
  const heightMm = pxToMm(frame.heightPx)
  document.body.appendChild(svg)
  try {
    const pdf = new jsPDF({
      unit: 'mm',
      format: [widthMm, heightMm],
      orientation: widthMm > heightMm ? 'landscape' : 'portrait',
    })
    if (embedFont) await registerCustomFonts(pdf)
    await pdf.svg(svg, { x: 0, y: 0, width: widthMm, height: heightMm })
    pdf.save(filenameFor(frame, 'pdf'))
  } finally {
    svg.remove()
  }
}

function appendRasterImage(svg: SVGSVGElement, dataUrl: string, rect: Rect) {
  const image = document.createElementNS(SVG_NS, 'image')
  image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl)
  image.setAttribute('href', dataUrl)
  image.setAttribute('x', String(rect.x))
  image.setAttribute('y', String(rect.y))
  image.setAttribute('width', String(rect.width))
  image.setAttribute('height', String(rect.height))
  svg.appendChild(image)
}

/**
 * Recorta e reamostra a foto para a resolução de exportação (em vez de embutir
 * o arquivo original, que pode ter várias vezes mais pixels/MB do que o
 * necessário) — é o principal motivo do PDF ficar pesado.
 */
async function photoDataUrlForExport(frame: Frame, photoArea: Rect, scale: number): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(photoArea.width * scale)
  canvas.height = Math.round(photoArea.height * scale)
  const ctx = canvas.getContext('2d')!
  await drawPhotoInto(ctx, frame, photoArea, photoArea, photoArea.x, photoArea.y, scale)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/**
 * Compõe sombra (multiply) + frente da etiqueta já contra o que está atrás
 * dela (foto ou fundo branco) num único raster pequeno — o PDF não converte
 * mix-blend-mode em CSS/SVG para um blend mode real, então a sombra some ou
 * fica errada se exportada como camadas separadas.
 */
async function etiquetaDataUrlForExport(
  frame: Frame,
  photoArea: Rect,
  etiqueta: ResolvedEtiqueta,
  etiquetaRect: Rect,
  scale: number,
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(etiquetaRect.width * scale)
  canvas.height = Math.round(etiquetaRect.height * scale)
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const overlap = intersectRect(etiquetaRect, photoArea)
  if (overlap) await drawPhotoInto(ctx, frame, photoArea, overlap, etiquetaRect.x, etiquetaRect.y, scale)

  await drawEtiquetaInto(ctx, etiqueta, etiquetaRect, etiquetaRect.x, etiquetaRect.y, scale)

  return canvas.toDataURL('image/png')
}

export async function exportFramePDF(frame: Frame): Promise<void> {
  const { layout, etiqueta, tagline, variant } = frameLayout(frame)
  const svg = createFrameSvg(frame)
  const scale = pxToExportPixels(1)

  // Photo (recortada e reamostrada) ou placeholder cinza
  const photoArea = layout.photoArea
  if (frame.photo) {
    const dataUrl = await photoDataUrlForExport(frame, photoArea, scale)
    appendRasterImage(svg, dataUrl, photoArea)
  } else {
    const placeholder = document.createElementNS(SVG_NS, 'rect')
    placeholder.setAttribute('x', String(photoArea.x))
    placeholder.setAttribute('y', String(photoArea.y))
    placeholder.setAttribute('width', String(photoArea.width))
    placeholder.setAttribute('height', String(photoArea.height))
    placeholder.setAttribute('fill', PLACEHOLDER_GRAY)
    svg.appendChild(placeholder)
  }

  // Etiqueta: quando tem sombra (padrão do sistema), compõe sombra+frente num
  // raster único já com o multiply correto; upload personalizado (sem sombra)
  // continua entrando como vetor/raster puro, sem alteração.
  const etiquetaRect = getEtiquetaRenderRect(etiqueta, layout.etiqueta)
  if (etiqueta.shadow) {
    const dataUrl = await etiquetaDataUrlForExport(frame, photoArea, etiqueta, etiquetaRect, scale)
    appendRasterImage(svg, dataUrl, etiquetaRect)
  } else {
    await appendLayer(svg, etiqueta.front, etiquetaRect)
  }

  await appendLayer(svg, tagline, layout.tagline)

  // A fonte customizada só é usada pela tagline de texto (variante A padrão) —
  // não vale a pena embuti-la quando ela não entra no desenho.
  const embedFont = !tagline.isCustom && variant === 'a'
  await savePdfFromSvg(frame, svg, embedFont)
}

// ---------- PDF de guias (caixas vetoriais, sem os assets — para montar no Illustrator) ----------

function appendGuideBox(svg: SVGSVGElement, box: GuideBox, frameWidthPx: number) {
  const isFrame = box.key === 'frame'
  const stroke = isFrame ? '#7a8a92' : '#0067b3'
  // Escala pelo tamanho do FRAME (não da própria caixa), para os rótulos ficarem
  // legíveis e consistentes entre si independente do tamanho de cada zona.
  const baseFontSize = isFrame ? frameWidthPx * 0.01 : frameWidthPx * 0.016
  const fontSize = Math.max(isFrame ? 8 : 10, Math.min(baseFontSize, box.rect.height * 0.4))

  const rect = document.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('x', String(box.rect.x))
  rect.setAttribute('y', String(box.rect.y))
  rect.setAttribute('width', String(box.rect.width))
  rect.setAttribute('height', String(box.rect.height))
  rect.setAttribute('fill', 'none')
  rect.setAttribute('stroke', stroke)
  rect.setAttribute('stroke-width', '1.5')
  svg.appendChild(rect)

  const text = document.createElementNS(SVG_NS, 'text')
  text.setAttribute('x', String(box.rect.x + 8))
  text.setAttribute('y', String(box.rect.y + fontSize + 6))
  text.setAttribute('font-family', 'Helvetica, Arial, sans-serif')
  text.setAttribute('font-size', String(fontSize))
  text.setAttribute('font-weight', 'bold')
  text.setAttribute('fill', stroke)
  text.textContent = box.label
  svg.appendChild(text)
}

/** Exporta apenas as caixas vetoriais (margem, foto, etiqueta, tagline) — sem os assets reais — prontas para montar manualmente no Illustrator. */
export async function exportFrameGuidesPDF(frame: Frame): Promise<void> {
  const { layout } = frameLayout(frame)
  const svg = createFrameSvg(frame)

  for (const box of getGuideBoxes(frame.widthPx, frame.heightPx, layout)) {
    appendGuideBox(svg, box, frame.widthPx)
  }

  await savePdfFromSvg(frame, svg, false)
}
