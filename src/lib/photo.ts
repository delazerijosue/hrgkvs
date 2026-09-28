/**
 * Photo fit/zoom/pan/rotate (Seção 6).
 *
 * The photo is fit to its area the same way native CSS `object-fit: cover`
 * works: scaled uniformly so the larger side matches the area exactly, then
 * centered — the overflow on the other axis is cropped by the area's own
 * `overflow: hidden`. This guarantees full coverage at any natural image
 * size without any manual width/height math (see PhotoLayer.tsx).
 *
 * Zoom is a plain scale from the center (`transform-origin: center`).
 * Rotation turns that already-covering rectangle around the same center —
 * which on its own would open a gap at the corners, so the scale is
 * auto-boosted just enough to keep full coverage at the current angle (see
 * `minCoverScale`). Pan is a translate applied after scale+rotate, clamped
 * in the image's own (rotated) axes so it can never reveal a gap either —
 * see `clampPan` for the exact geometry.
 */
import type { Rect } from './layout'

export interface PhotoTransform {
  /** Zoom multiplier over the cover-fit size. Auto-boosted at extreme rotation angles so the image still fully covers the area (see clampPan). */
  scale: number
  /** Translation from center, in unscaled area-local px, applied after scale+rotate. */
  panX: number
  panY: number
  /** Rotation in degrees, clockwise, around the area's center. */
  rotation: number
}

export const MAX_PHOTO_ZOOM = 3
export const MAX_PHOTO_ROTATION = 180

export function defaultPhotoTransform(): PhotoTransform {
  return { scale: 1, panX: 0, panY: 0, rotation: 0 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Minimum scale so a rectangle matching `area`, rotated by `rotationDeg`
 * around its center, still fully covers `area` with zero pan. 1 at 0°
 * (no boost needed, matches the old no-rotation behavior exactly); grows
 * toward the area's own aspect ratio as rotation approaches 90°.
 */
function minCoverScale(area: Rect, rotationDeg: number): number {
  const rad = toRad(rotationDeg)
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const ratio = Math.max(area.width / area.height, area.height / area.width)
  return c + ratio * s
}

/**
 * How far the scaled+rotated image can be panned, expressed in the image's
 * OWN (rotated) local axes, before a gap would appear on that axis.
 */
function localPanBounds(area: Rect, scale: number, rotationDeg: number): { x: number; y: number } {
  const rad = toRad(rotationDeg)
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const halfW = (scale * area.width) / 2
  const halfH = (scale * area.height) / 2
  const marginX = (area.width / 2) * c + (area.height / 2) * s
  const marginY = (area.width / 2) * s + (area.height / 2) * c
  return { x: Math.max(0, halfW - marginX), y: Math.max(0, halfH - marginY) }
}

/** Rotates a screen-space (x, y) vector into the image's own local (unrotated) axes — inverse of `fromLocal`. */
function toLocal(x: number, y: number, rotationDeg: number): { x: number; y: number } {
  const rad = toRad(rotationDeg)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: x * cos + y * sin, y: -x * sin + y * cos }
}

/** Inverse of `toLocal`. */
function fromLocal(x: number, y: number, rotationDeg: number): { x: number; y: number } {
  const rad = toRad(rotationDeg)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

export function clampPan(area: Rect, transform: PhotoTransform): PhotoTransform {
  const rotation = transform.rotation
  const scale = Math.max(minCoverScale(area, rotation), transform.scale)
  const bounds = localPanBounds(area, scale, rotation)
  const local = toLocal(transform.panX, transform.panY, rotation)
  const clampedLocal = { x: clamp(local.x, -bounds.x, bounds.x), y: clamp(local.y, -bounds.y, bounds.y) }
  const { x: panX, y: panY } = fromLocal(clampedLocal.x, clampedLocal.y, rotation)
  return { scale, panX, panY, rotation }
}

/** Drags the image by (dx, dy) area-local px, clamped to stay gap-free. */
export function panPhoto(area: Rect, transform: PhotoTransform, dx: number, dy: number): PhotoTransform {
  return clampPan(area, { ...transform, panX: transform.panX + dx, panY: transform.panY + dy })
}

/** Changes zoom in place — the center stays fixed because scaling is anchored there. */
export function zoomPhoto(area: Rect, transform: PhotoTransform, newScale: number): PhotoTransform {
  return clampPan(area, { ...transform, scale: newScale })
}

/** Changes rotation in place, around the same center — scale/pan are re-clamped so no gap appears at the new angle. */
export function rotatePhoto(area: Rect, transform: PhotoTransform, newRotationDeg: number): PhotoTransform {
  return clampPan(area, { ...transform, rotation: newRotationDeg })
}

export interface LoadedPhoto {
  src: string
  naturalWidth: number
  naturalHeight: number
  transform: PhotoTransform
}

export function loadPhotoFile(file: File): Promise<LoadedPhoto> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({
        src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        transform: defaultPhotoTransform(),
      })
    }
    img.onerror = reject
    img.src = src
  })
}

/**
 * Re-derives a pan for a new photo area, preserving the same relative
 * position (fraction of the allowed pan range, measured in the image's own
 * rotated axes) instead of the raw pixel offset — so a resized (or
 * duplicated-then-resized) frame keeps a similar crop instead of snapping
 * back to center.
 */
export function preservePhotoFraction(oldArea: Rect, newArea: Rect, transform: PhotoTransform): PhotoTransform {
  const oldBounds = localPanBounds(oldArea, transform.scale, transform.rotation)
  const oldLocal = toLocal(transform.panX, transform.panY, transform.rotation)
  const fracX = oldBounds.x !== 0 ? oldLocal.x / oldBounds.x : 0
  const fracY = oldBounds.y !== 0 ? oldLocal.y / oldBounds.y : 0

  const newBounds = localPanBounds(newArea, transform.scale, transform.rotation)
  const { x: panX, y: panY } = fromLocal(fracX * newBounds.x, fracY * newBounds.y, transform.rotation)

  return clampPan(newArea, { ...transform, panX, panY })
}

/**
 * Cover-fit scale (matches CSS `object-fit: cover`) — used only to replicate
 * the on-screen fit for canvas/SVG export, which has no native object-fit.
 */
export function coverScale(area: Rect, naturalWidth: number, naturalHeight: number): number {
  if (naturalWidth <= 0 || naturalHeight <= 0) return 1
  return Math.max(area.width / naturalWidth, area.height / naturalHeight)
}
