import { useRef, useState, useCallback, useEffect, type PointerEvent, type WheelEvent } from 'react'
import { useStore } from '../state/store'
import { FrameView } from './FrameView'
import './Canvas.css'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const MARQUEE_THRESHOLD = 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

type DragState =
  | { kind: 'pan'; startClientX: number; startClientY: number; viewX: number; viewY: number }
  | { kind: 'marquee'; startClientX: number; startClientY: number; additive: boolean }

export function Canvas() {
  const frames = useStore((s) => s.frames)
  const view = useStore((s) => s.canvasView)
  const setCanvasView = useStore((s) => s.setCanvasView)
  const selectFrame = useStore((s) => s.selectFrame)
  const selectFrames = useStore((s) => s.selectFrames)
  const selectedFrameIds = useStore((s) => s.selectedFrameIds)
  const spacePressed = useStore((s) => s.spacePressed)

  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<ScreenRect | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  // No primeiro carregamento, enquadra todos os frames existentes (os 4 formatos padrão) na tela.
  useEffect(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect || frames.length === 0) return
    const FIT_PADDING = 80
    const minX = Math.min(...frames.map((f) => f.canvasX))
    const minY = Math.min(...frames.map((f) => f.canvasY))
    const maxX = Math.max(...frames.map((f) => f.canvasX + f.widthPx))
    const maxY = Math.max(...frames.map((f) => f.canvasY + f.heightPx))
    const contentWidth = maxX - minX
    const contentHeight = maxY - minY
    const zoom = clamp(
      Math.min((rect.width - FIT_PADDING * 2) / contentWidth, (rect.height - FIT_PADDING * 2) / contentHeight),
      MIN_ZOOM,
      1,
    )
    setCanvasView({
      zoom,
      x: (rect.width - contentWidth * zoom) / 2 - minX * zoom,
      y: (rect.height - contentHeight * zoom) / 2 - minY * zoom,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = viewportRef.current!.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const zoomFactor = Math.exp(-e.deltaY * 0.0015)
        const newZoom = clamp(view.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM)
        const worldX = (cx - view.x) / view.zoom
        const worldY = (cy - view.y) / view.zoom
        setCanvasView({ zoom: newZoom, x: cx - worldX * newZoom, y: cy - worldY * newZoom })
      } else {
        setCanvasView({ x: view.x - e.deltaX, y: view.y - e.deltaY })
      }
    },
    [view, setCanvasView],
  )

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (spacePressed) {
        dragRef.current = { kind: 'pan', startClientX: e.clientX, startClientY: e.clientY, viewX: view.x, viewY: view.y }
        setIsPanning(true)
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        return
      }
      if (e.target !== e.currentTarget) return
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      dragRef.current = { kind: 'marquee', startClientX: e.clientX, startClientY: e.clientY, additive }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [spacePressed, view],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return

      if (drag.kind === 'pan') {
        setCanvasView({
          x: drag.viewX + (e.clientX - drag.startClientX),
          y: drag.viewY + (e.clientY - drag.startClientY),
        })
        return
      }

      const rect = viewportRef.current!.getBoundingClientRect()
      const x0 = drag.startClientX - rect.left
      const y0 = drag.startClientY - rect.top
      const x1 = e.clientX - rect.left
      const y1 = e.clientY - rect.top
      setMarqueeRect({
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
      })
    },
    [setCanvasView],
  )

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      setMarqueeRect(null)
      setIsPanning(false)
      if (!drag) return
      if (drag.kind === 'pan') return

      const dx = Math.abs(e.clientX - drag.startClientX)
      const dy = Math.abs(e.clientY - drag.startClientY)
      if (dx < MARQUEE_THRESHOLD && dy < MARQUEE_THRESHOLD) {
        if (!drag.additive) selectFrame(null)
        return
      }

      const rect = viewportRef.current!.getBoundingClientRect()
      const toWorld = (clientX: number, clientY: number) => ({
        x: (clientX - rect.left - view.x) / view.zoom,
        y: (clientY - rect.top - view.y) / view.zoom,
      })
      const p0 = toWorld(drag.startClientX, drag.startClientY)
      const p1 = toWorld(e.clientX, e.clientY)
      const minX = Math.min(p0.x, p1.x)
      const maxX = Math.max(p0.x, p1.x)
      const minY = Math.min(p0.y, p1.y)
      const maxY = Math.max(p0.y, p1.y)

      const hitIds = frames
        .filter((f) => f.canvasX < maxX && f.canvasX + f.widthPx > minX && f.canvasY < maxY && f.canvasY + f.heightPx > minY)
        .map((f) => f.id)

      if (drag.additive) {
        selectFrames([...new Set([...selectedFrameIds, ...hitIds])])
      } else {
        selectFrames(hitIds)
      }
    },
    [frames, view, selectedFrameIds, selectFrame, selectFrames],
  )

  const zoomBy = (factor: number) => {
    const newZoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    setCanvasView({ zoom: newZoom })
  }

  const resetView = () => setCanvasView({ x: 0, y: 0, zoom: 1 })

  const dotSize = Math.max(6, 25 * view.zoom)

  const viewportClass = [
    'canvas-viewport',
    spacePressed && 'canvas-viewport--hand',
    isPanning && 'canvas-viewport--panning',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={viewportClass}
      ref={viewportRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{
        backgroundSize: `${dotSize}px ${dotSize}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div
        className="canvas-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        {frames.map((frame) => (
          <FrameView key={frame.id} frame={frame} />
        ))}
      </div>

      {marqueeRect && (
        <div
          className="canvas-marquee"
          style={{ left: marqueeRect.x, top: marqueeRect.y, width: marqueeRect.width, height: marqueeRect.height }}
        />
      )}

      {frames.length === 0 && (
        <div className="canvas-empty-hint">
          Clique em &quot;Novo frame&quot; no painel à esquerda para começar
        </div>
      )}

      <div className="zoom-controls">
        <button className="secondary" onClick={() => zoomBy(0.8)} title="Diminuir zoom">
          −
        </button>
        <button className="secondary" onClick={resetView} title="Redefinir zoom">
          {Math.round(view.zoom * 100)}%
        </button>
        <button className="secondary" onClick={() => zoomBy(1.25)} title="Aumentar zoom">
          +
        </button>
      </div>
    </div>
  )
}
