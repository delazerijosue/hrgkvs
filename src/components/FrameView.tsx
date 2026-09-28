import { useCallback, useMemo, useRef, type PointerEvent } from 'react'
import { useStore } from '../state/store'
import { computeLayout } from '../lib/layout'
import { getEtiquetaRenderRect, type ResolvedEtiqueta } from '../lib/assets'
import { getGuideBoxes } from '../lib/guides'
import { fromPx } from '../lib/units'
import { getFrameLabel, resolveFrameAssets } from '../lib/frame'
import { PhotoLayer } from './PhotoLayer'
import type { Frame } from '../types'
import './FrameView.css'

function hasSelectModifier(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.shiftKey || e.metaKey || e.ctrlKey
}

export function FrameView({ frame }: { frame: Frame }) {
  const selectedFrameIds = useStore((s) => s.selectedFrameIds)
  const debugMode = useStore((s) => s.debugMode)
  const guidesMode = useStore((s) => s.guidesMode)
  const spacePressed = useStore((s) => s.spacePressed)
  const selectFrame = useStore((s) => s.selectFrame)
  const toggleFrameSelection = useStore((s) => s.toggleFrameSelection)
  const moveFrame = useStore((s) => s.moveFrame)
  const snapshot = useStore((s) => s.snapshot)
  const zoom = useStore((s) => s.canvasView.zoom)

  const isSelected = selectedFrameIds.includes(frame.id)
  const { etiquetaAsset, taglineAsset } = resolveFrameAssets(frame)

  const layout = useMemo(
    () => computeLayout(frame.widthPx, frame.heightPx, frame.overrides, etiquetaAsset.aspectRatio, taglineAsset.aspectRatio),
    [frame.widthPx, frame.heightPx, frame.overrides, etiquetaAsset.aspectRatio, taglineAsset.aspectRatio],
  )

  const dragState = useRef<{ startX: number; startY: number; frameX: number; frameY: number } | null>(null)

  const onPhotoSelect = useCallback(
    (modifier: boolean) => {
      if (modifier) toggleFrameSelection(frame.id)
      else selectFrame(frame.id)
    },
    [frame.id, selectFrame, toggleFrameSelection],
  )

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (spacePressed) return
      if (e.target !== e.currentTarget) return
      if (hasSelectModifier(e)) {
        toggleFrameSelection(frame.id)
        return
      }
      selectFrame(frame.id)
      snapshot()
      dragState.current = { startX: e.clientX, startY: e.clientY, frameX: frame.canvasX, frameY: frame.canvasY }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [frame.id, frame.canvasX, frame.canvasY, selectFrame, toggleFrameSelection, snapshot, spacePressed],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragState.current) return
      const dx = (e.clientX - dragState.current.startX) / zoom
      const dy = (e.clientY - dragState.current.startY) / zoom
      moveFrame(frame.id, dragState.current.frameX + dx, dragState.current.frameY + dy)
    },
    [frame.id, zoom, moveFrame],
  )

  const onPointerUp = useCallback(() => {
    dragState.current = null
  }, [])

  return (
    <div
      className={`frame ${isSelected ? 'frame--selected' : ''}`}
      style={{ left: frame.canvasX, top: frame.canvasY, width: frame.widthPx, height: frame.heightPx }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {guidesMode ? (
        <GuidesLayer frame={frame} layout={layout} />
      ) : (
        <>
          <PhotoLayer frame={frame} photoArea={layout.photoArea} onSelect={onPhotoSelect} />

          <EtiquetaLayers asset={etiquetaAsset} contentBox={layout.etiqueta} />

          <img
            src={taglineAsset.src}
            alt="Tagline"
            className="frame__tagline"
            draggable={false}
            style={{
              left: layout.tagline.x,
              top: layout.tagline.y,
              width: layout.tagline.width,
              height: layout.tagline.height,
            }}
          />
        </>
      )}

      {debugMode && isSelected && <DebugOverlay frame={frame} layout={layout} />}

      <div className="frame__label" style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'bottom left' }}>
        {getFrameLabel(frame)}
      </div>
    </div>
  )
}

function EtiquetaLayers({
  asset,
  contentBox,
}: {
  asset: ResolvedEtiqueta
  contentBox: ReturnType<typeof computeLayout>['etiqueta']
}) {
  const rect = getEtiquetaRenderRect(asset, contentBox)
  const style = { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
  return (
    <>
      {asset.shadow && (
        <img src={asset.shadow.src} alt="" className="frame__etiqueta frame__etiqueta--shadow" draggable={false} style={style} />
      )}
      <img src={asset.front.src} alt="Etiqueta" className="frame__etiqueta" draggable={false} style={style} />
    </>
  )
}

function GuidesLayer({ frame, layout }: { frame: Frame; layout: ReturnType<typeof computeLayout> }) {
  const boxes = getGuideBoxes(frame.widthPx, frame.heightPx, layout)
  return (
    <div className="guides-layer">
      {boxes.map((box) => (
        <div
          key={box.key}
          className={`guide-rect guide-rect--${box.key}`}
          style={{ left: box.rect.x, top: box.rect.y, width: box.rect.width, height: box.rect.height }}
        >
          <span className="guide-rect__label">{box.label}</span>
        </div>
      ))}
    </div>
  )
}

function DebugOverlay({ frame, layout }: { frame: Frame; layout: ReturnType<typeof computeLayout> }) {
  const unit = frame.unit
  const fmt = (px: number) => fromPx(px, unit).toFixed(unit === 'cm' ? 2 : 0)

  return (
    <div className="debug-overlay">
      <div className="debug-rect debug-rect--margin" style={{ left: layout.margin.left, top: layout.margin.top, width: frame.widthPx - layout.margin.left - layout.margin.right, height: frame.heightPx - layout.margin.top - layout.margin.bottom }} />
      <div className="debug-rect debug-rect--etiqueta" style={{ left: layout.etiqueta.x, top: layout.etiqueta.y, width: layout.etiqueta.width, height: layout.etiqueta.height }} />
      <div className="debug-rect debug-rect--tagline" style={{ left: layout.tagline.x, top: layout.tagline.y, width: layout.tagline.width, height: layout.tagline.height }} />
      <div className="debug-info">
        <div>tamanho: {fmt(frame.widthPx)} × {fmt(frame.heightPx)} {unit}</div>
        <div>posição: {fmt(frame.canvasX)}, {fmt(frame.canvasY)}</div>
        <div>orientação: {layout.orientation}</div>
        <div>margens: T{fmt(layout.margin.top)} R{fmt(layout.margin.right)} B{fmt(layout.margin.bottom)} L{fmt(layout.margin.left)}</div>
        <div>etiqueta: {fmt(layout.etiqueta.width)}×{fmt(layout.etiqueta.height)} @ {fmt(layout.etiqueta.x)},{fmt(layout.etiqueta.y)} {layout.etiqueta.wideMode ? '(modo largo)' : ''}</div>
        <div>tagline: {fmt(layout.tagline.width)}×{fmt(layout.tagline.height)} @ {fmt(layout.tagline.x)},{fmt(layout.tagline.y)}</div>
      </div>
    </div>
  )
}
