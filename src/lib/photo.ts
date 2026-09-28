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
 * Size (in area-local px) of the image at zoom=1: uniformly scaled so it
 * just covers `area` at rotation 0 (matches CSS `object-fit: cover`) —
 * NOT necessarily the same aspect ratio as `area` itself, so it must be
 * tracked separately from the area's own width/height (see `coverScale`).
 */
function coverSize(area: Rect, naturalWidth: number, naturalHeight: number): { w: number; h: number } {
  const base = coverScale(area, naturalWidth, naturalHeight)
  return { w: naturalWidth * base, h: naturalHeight * base }
}

/**
 * Minimum scale (zoom multiplier over `img`'s cover-fit size) so the image,
 * rotated by `rotationDeg` around its center, still fully covers `area`
 * with zero pan. 1 at 0° (no boost needed, matches the old no-rotation
 * behavior exactly); grows as rotation approaches 90° and/or the image's
 * own aspect ratio diverges further from the area's.
 */
function minCoverScale(area: Rect, rotationDeg: number, img: { w: number; h: number }): number {
  const rad = toRad(rotationDeg)
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const marginX = (area.width / 2) * c + (area.height / 2) * s
  const marginY = (area.width / 2) * s + (area.height / 2) * c
  return Math.max((2 * marginX) / img.w, (2 * marginY) / img.h)
}

/**
 * How far the scaled+rotated image can be panned, expressed in the image's
 * OWN (rotated) local axes, before a gap would appear on that axis.
 */
function localPanBounds(area: Rect, scale: number, rotationDeg: number, img: { w: number; h: number }): { x: number; y: number } {
  const rad = toRad(rotationDeg)
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const halfW = (scale * img.w) / 2
  const halfH = (scale * img.h) / 2
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

export function clampPan(
  area: Rect,
  transform: PhotoTransform,
  naturalWidth: number,
  naturalHeight: number,
): PhotoTransform {
  const img = coverSize(area, naturalWidth, naturalHeight)
  const rotation = transform.rotation
  const scale = Math.max(minCoverScale(area, rotation, img), transform.scale)
  const bounds = localPanBounds(area, scale, rotation, img)
  const local = toLocal(transform.panX, transform.panY, rotation)
  const clampedLocal = { x: clamp(local.x, -bounds.x, bounds.x), y: clamp(local.y, -bounds.y, bounds.y) }
  const { x: panX, y: panY } = fromLocal(clampedLocal.x, clampedLocal.y, rotation)
  return { scale, panX, panY, rotation }
}

/** Drags the image by (dx, dy) area-local px, clamped to stay gap-free. */
export function panPhoto(
  area: Rect,
  transform: PhotoTransform,
  dx: number,
  dy: number,
  naturalWidth: number,
  naturalHeight: number,
): PhotoTransform {
  return clampPan(area, { ...transform, panX: transform.panX + dx, panY: transform.panY + dy }, naturalWidth, naturalHeight)
}

/** Changes zoom in place — the center stays fixed because scaling is anchored there. */
export function zoomPhoto(
  area: Rect,
  transform: PhotoTransform,
  newScale: number,
  naturalWidth: number,
  naturalHeight: number,
): PhotoTransform {
  return clampPan(area, { ...transform, scale: newScale }, naturalWidth, naturalHeight)
}

/** Changes rotation in place, around the same center — scale/pan are re-clamped so no gap appears at the new angle. */
export function rotatePhoto(
  area: Rect,
  transform: PhotoTransform,
  newRotationDeg: number,
  naturalWidth: number,
  naturalHeight: number,
): PhotoTransform {
  return clampPan(area, { ...transform, rotation: newRotationDeg }, naturalWidth, naturalHeight)
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
export function preservePhotoFraction(
  oldArea: Rect,
  newArea: Rect,
  transform: PhotoTransform,
  naturalWidth: number,
  naturalHeight: number,
): PhotoTransform {
  const oldImg = coverSize(oldArea, naturalWidth, naturalHeight)
  const oldBounds = localPanBounds(oldArea, transform.scale, transform.rotation, oldImg)
  const oldLocal = toLocal(transform.panX, transform.panY, transform.rotation)
  const fracX = oldBounds.x !== 0 ? oldLocal.x / oldBounds.x : 0
  const fracY = oldBounds.y !== 0 ? oldLocal.y / oldBounds.y : 0

  const newImg = coverSize(newArea, naturalWidth, naturalHeight)
  const newBounds = localPanBounds(newArea, transform.scale, transform.rotation, newImg)
  const { x: panX, y: panY } = fromLocal(fracX * newBounds.x, fracY * newBounds.y, transform.rotation)

  return clampPan(newArea, { ...transform, panX, panY }, naturalWidth, naturalHeight)
}

/**
 * Cover-fit scale (matches CSS `object-fit: cover`) — used only to replicate
 * the on-screen fit for canvas/SVG export, which has no native object-fit.
 */
export function coverScale(area: Rect, naturalWidth: number, naturalHeight: number): number {
  if (naturalWidth <= 0 || naturalHeight <= 0) return 1
  return Math.max(area.width / naturalWidth, area.height / naturalHeight)
}
