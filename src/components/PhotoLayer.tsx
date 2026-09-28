import { useCallback, useRef, type ChangeEvent, type MouseEvent, type PointerEvent } from 'react'
import { useStore } from '../state/store'
import { coverScale, loadPhotoFile, panPhoto } from '../lib/photo'
import type { Rect } from '../lib/layout'
import type { Frame } from '../types'
import './PhotoLayer.css'

export function PhotoLayer({
  frame,
  photoArea,
  onSelect,
}: {
  frame: Frame
  photoArea: Rect
  onSelect: (modifier: boolean) => void
}) {
  const setPhoto = useStore((s) => s.setPhoto)
  const updatePhotoTransform = useStore((s) => s.updatePhotoTransform)
  const snapshot = useStore((s) => s.snapshot)
  const canvasZoom = useStore((s) => s.canvasView.zoom)
  const spacePressed = useStore((s) => s.spacePressed)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragState = useRef<{ lastX: number; lastY: number } | null>(null)

  const onFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!/^image\/(png|jpe?g)$/.test(file.type)) return
      loadPhotoFile(file).then((photo) => setPhoto(frame.id, photo))
    },
    [frame.id, setPhoto],
  )

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (spacePressed) return
      if (!frame.photo) return
      e.stopPropagation()
      const modifier = e.shiftKey || e.metaKey || e.ctrlKey
      onSelect(modifier)
      if (modifier) return
      snapshot()
      dragState.current = { lastX: e.clientX, lastY: e.clientY }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [spacePressed, frame.photo, onSelect, snapshot],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragState.current || !frame.photo) return
      const dx = (e.clientX - dragState.current.lastX) / canvasZoom
      const dy = (e.clientY - dragState.current.lastY) / canvasZoom
      dragState.current = { lastX: e.clientX, lastY: e.clientY }
      const next = panPhoto(photoArea, frame.photo.transform, dx, dy, frame.photo.naturalWidth, frame.photo.naturalHeight)
      updatePhotoTransform(frame.id, next)
    },
    [frame.id, frame.photo, photoArea, canvasZoom, updatePhotoTransform],
  )

  const onPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    dragState.current = null
    e.stopPropagation()
  }, [])

  const openFileDialog = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    fileInputRef.current?.click()
  }, [])

  return (
    <div
      className="photo-layer"
      style={{ left: photoArea.x, top: photoArea.y, width: photoArea.width, height: photoArea.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {frame.photo ? (
        (() => {
          const base = coverScale(photoArea, frame.photo.naturalWidth, frame.photo.naturalHeight)
          const w = frame.photo.naturalWidth * base
          const h = frame.photo.naturalHeight * base
          const { panX, panY, rotation, scale } = frame.photo.transform
          return (
            <img
              src={frame.photo.src}
              alt="Foto"
              className="photo-layer__img"
              draggable={false}
              style={{
                width: `${w}px`,
                height: `${h}px`,
                transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) rotate(${rotation}deg) scale(${scale})`,
              }}
            />
          )
        })()
      ) : (
        <button className="photo-layer__placeholder" onClick={openFileDialog} type="button">
          <span className="photo-layer__plus">+</span>
          <span>Enviar foto</span>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="photo-layer__input"
        onChange={onFileChange}
      />
    </div>
  )
}
