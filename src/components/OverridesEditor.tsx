import { useMemo, useRef, type ChangeEvent } from 'react'
import { useStore } from '../state/store'
import { computeLayout, type TaglineVariant } from '../lib/layout'
import { loadCustomAsset, isAcceptedAssetFile } from '../lib/customAssets'
import { clampPan, loadPhotoFile, rotatePhoto, zoomPhoto, MAX_PHOTO_ROTATION, MAX_PHOTO_ZOOM } from '../lib/photo'
import { fromPx, toPx } from '../lib/units'
import { resolveFrameAssets } from '../lib/frame'
import { Accordion } from './Accordion'
import type { Frame } from '../types'
import './OverridesEditor.css'

export function OverridesEditor({ frame }: { frame: Frame }) {
  const updateOverrides = useStore((s) => s.updateOverrides)
  const clearOverride = useStore((s) => s.clearOverride)
  const resizeFrame = useStore((s) => s.resizeFrame)
  const setCustomEtiqueta = useStore((s) => s.setCustomEtiqueta)
  const setCustomTagline = useStore((s) => s.setCustomTagline)
  const setPhoto = useStore((s) => s.setPhoto)
  const updatePhotoTransform = useStore((s) => s.updatePhotoTransform)
  const snapshot = useStore((s) => s.snapshot)

  const etiquetaInputRef = useRef<HTMLInputElement>(null)
  const taglineInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const { etiquetaAsset, taglineAsset, variant } = resolveFrameAssets(frame)
  const layout = useMemo(
    () => computeLayout(frame.widthPx, frame.heightPx, frame.overrides, etiquetaAsset.aspectRatio, taglineAsset.aspectRatio),
    [frame.widthPx, frame.heightPx, frame.overrides, etiquetaAsset.aspectRatio, taglineAsset.aspectRatio],
  )

  const unit = frame.unit
  const disp = (px: number) => Number(fromPx(px, unit).toFixed(unit === 'cm' ? 2 : 0))
  const step = unit === 'cm' ? 0.1 : 1

  const setPx = (key: 'marginTopSides' | 'marginBottom' | 'etiquetaHeight' | 'taglineWidth', displayValue: number) => {
    updateOverrides(frame.id, { [key]: toPx(displayValue, unit) })
  }

  const setEtiquetaPos = (axis: 'x' | 'y', displayValue: number) => {
    const current = frame.overrides.etiquetaPos ?? { x: layout.etiqueta.x, y: layout.etiqueta.y }
    updateOverrides(frame.id, {
      etiquetaPos: { ...current, [axis]: toPx(displayValue, unit) },
    })
  }

  const onResize = (axis: 'width' | 'height', displayValue: number) => {
    if (!displayValue || displayValue <= 0) return
    const width = axis === 'width' ? displayValue : disp(frame.widthPx)
    const height = axis === 'height' ? displayValue : disp(frame.heightPx)
    resizeFrame(frame.id, width, height)
  }

  const onEtiquetaFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !isAcceptedAssetFile(file)) return
    const asset = await loadCustomAsset(file)
    setCustomEtiqueta(frame.id, asset)
  }

  const onTaglineFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !isAcceptedAssetFile(file)) return
    const asset = await loadCustomAsset(file)
    setCustomTagline(frame.id, asset)
  }

  const onPhotoFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !/^image\/(png|jpe?g)$/.test(file.type)) return
    snapshot()
    const photo = await loadPhotoFile(file)
    setPhoto(frame.id, photo)
  }

  const onPhotoZoom = (value: number) => {
    if (!frame.photo || Number.isNaN(value)) return
    const zoomed = zoomPhoto(layout.photoArea, frame.photo.transform, value, frame.photo.naturalWidth, frame.photo.naturalHeight)
    updatePhotoTransform(frame.id, zoomed)
  }

  const onPhotoRotate = (value: number) => {
    if (!frame.photo || Number.isNaN(value)) return
    const rotated = rotatePhoto(layout.photoArea, frame.photo.transform, value, frame.photo.naturalWidth, frame.photo.naturalHeight)
    updatePhotoTransform(frame.id, rotated)
  }

  const onPhotoPan = (axis: 'panX' | 'panY', displayValue: number) => {
    if (!frame.photo || Number.isNaN(displayValue)) return
    const clamped = clampPan(
      layout.photoArea,
      {
        ...frame.photo.transform,
        [axis]: toPx(displayValue, unit),
      },
      frame.photo.naturalWidth,
      frame.photo.naturalHeight,
    )
    updatePhotoTransform(frame.id, clamped)
  }

  return (
    <div className="overrides-editor">
      <Accordion title="Foto">
        <p className="asset-status">{frame.photo ? 'Foto enviada' : 'Nenhuma foto enviada'}</p>
        <div className="asset-actions">
          <button type="button" className="secondary" onClick={() => photoInputRef.current?.click()}>
            {frame.photo ? 'Trocar foto' : 'Enviar foto'}
          </button>
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden-input"
          onChange={onPhotoFile}
        />

        {frame.photo && (
          <>
            <div className="slider-control">
              <label>Zoom</label>
              <input
                type="range"
                min={1}
                max={MAX_PHOTO_ZOOM}
                step={0.01}
                value={frame.photo.transform.scale}
                onFocus={() => snapshot()}
                onChange={(e) => onPhotoZoom(Number(e.target.value))}
              />
              <input
                type="number"
                step={0.01}
                min={1}
                max={MAX_PHOTO_ZOOM}
                value={Math.round(frame.photo.transform.scale * 100) / 100}
                onFocus={() => snapshot()}
                onChange={(e) => onPhotoZoom(Number(e.target.value))}
              />
            </div>
            <div className="slider-control">
              <label>Rotação (°)</label>
              <input
                type="range"
                min={-MAX_PHOTO_ROTATION}
                max={MAX_PHOTO_ROTATION}
                step={0.5}
                value={frame.photo.transform.rotation}
                onFocus={() => snapshot()}
                onChange={(e) => onPhotoRotate(Number(e.target.value))}
              />
              <input
                type="number"
                step={1}
                min={-MAX_PHOTO_ROTATION}
                max={MAX_PHOTO_ROTATION}
                value={Math.round(frame.photo.transform.rotation * 10) / 10}
                onFocus={() => snapshot()}
                onChange={(e) => onPhotoRotate(Number(e.target.value))}
              />
            </div>
            <div className="field-row">
              <div>
                <label>Posição X</label>
                <input
                  type="number"
                  step={step}
                  value={disp(frame.photo.transform.panX)}
                  onFocus={() => snapshot()}
                  onChange={(e) => onPhotoPan('panX', Number(e.target.value))}
                />
              </div>
              <div>
                <label>Posição Y</label>
                <input
                  type="number"
                  step={step}
                  value={disp(frame.photo.transform.panY)}
                  onFocus={() => snapshot()}
                  onChange={(e) => onPhotoPan('panY', Number(e.target.value))}
                />
              </div>
            </div>
          </>
        )}
      </Accordion>

      <Accordion title="Tamanho do frame">
        <div className="field-row">
          <div>
            <label>Largura ({unit})</label>
            <input
              type="number"
              step={step}
              min={step}
              value={disp(frame.widthPx)}
              onChange={(e) => onResize('width', Number(e.target.value))}
            />
          </div>
          <div>
            <label>Altura ({unit})</label>
            <input
              type="number"
              step={step}
              min={step}
              value={disp(frame.heightPx)}
              onChange={(e) => onResize('height', Number(e.target.value))}
            />
          </div>
        </div>
      </Accordion>

      <Accordion title="Etiqueta">
        <p className="asset-status">
          {etiquetaAsset.isCustom
            ? 'Etiqueta personalizada enviada (sem sombra)'
            : 'Usando etiqueta padrão do sistema (frente + sombra)'}
        </p>
        <div className="asset-actions">
          <button type="button" className="secondary" onClick={() => etiquetaInputRef.current?.click()}>
            Enviar etiqueta
          </button>
          {etiquetaAsset.isCustom && (
            <button type="button" className="secondary" onClick={() => setCustomEtiqueta(frame.id, null)}>
              Usar padrão
            </button>
          )}
        </div>
        <input
          ref={etiquetaInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          className="hidden-input"
          onChange={onEtiquetaFile}
        />

        <div className="field-row">
          <div>
            <label>Posição X</label>
            <input
              type="number"
              step={step}
              value={disp(layout.etiqueta.x)}
              onChange={(e) => setEtiquetaPos('x', Number(e.target.value))}
            />
          </div>
          <div>
            <label>Posição Y</label>
            <input
              type="number"
              step={step}
              value={disp(layout.etiqueta.y)}
              onChange={(e) => setEtiquetaPos('y', Number(e.target.value))}
            />
          </div>
        </div>
        <div>
          <label>Altura ({unit})</label>
          <input
            type="number"
            step={step}
            min={step}
            value={disp(layout.etiqueta.height)}
            onChange={(e) => setPx('etiquetaHeight', Number(e.target.value))}
          />
        </div>
        <ResetRow
          show={!!(frame.overrides.etiquetaPos || frame.overrides.etiquetaHeight)}
          onReset={() => {
            clearOverride(frame.id, 'etiquetaPos')
            clearOverride(frame.id, 'etiquetaHeight')
          }}
        />
        {layout.etiqueta.wideMode && <p className="hint">Etiqueta larga: movida para a parte inferior.</p>}
      </Accordion>

      <Accordion title="Margens">
        <div>
          <label>Superior / laterais ({unit})</label>
          <input
            type="number"
            step={step}
            min={0}
            value={disp(layout.margin.top)}
            onChange={(e) => setPx('marginTopSides', Number(e.target.value))}
          />
        </div>
        <div>
          <label>Inferior ({unit})</label>
          <input
            type="number"
            step={step}
            min={0}
            value={disp(layout.margin.bottom)}
            onChange={(e) => setPx('marginBottom', Number(e.target.value))}
          />
        </div>
        <ResetRow
          show={!!(frame.overrides.marginTopSides || frame.overrides.marginBottom)}
          onReset={() => {
            clearOverride(frame.id, 'marginTopSides')
            clearOverride(frame.id, 'marginBottom')
          }}
        />
      </Accordion>

      <Accordion title="Tagline">
        <p className="asset-status">
          {taglineAsset.isCustom ? 'Tagline personalizada enviada' : `Usando variante padrão ${variant.toUpperCase()}`}
        </p>
        <div className="asset-actions">
          <button type="button" className="secondary" onClick={() => taglineInputRef.current?.click()}>
            Enviar tagline
          </button>
          {taglineAsset.isCustom && (
            <button type="button" className="secondary" onClick={() => setCustomTagline(frame.id, null)}>
              Usar padrão
            </button>
          )}
        </div>
        <input
          ref={taglineInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          className="hidden-input"
          onChange={onTaglineFile}
        />

        {!taglineAsset.isCustom && (
          <div className="variant-toggle">
            {(['a', 'b'] as TaglineVariant[]).map((v) => (
              <button
                key={v}
                type="button"
                className={variant === v ? '' : 'secondary'}
                onClick={() => updateOverrides(frame.id, { taglineVariant: v })}
              >
                Variante {v.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        <div>
          <label>Largura ({unit})</label>
          <input
            type="number"
            step={step}
            min={step}
            value={disp(layout.tagline.width)}
            onChange={(e) => setPx('taglineWidth', Number(e.target.value))}
          />
        </div>
        <ResetRow
          show={!!frame.overrides.taglineWidth}
          onReset={() => clearOverride(frame.id, 'taglineWidth')}
        />
      </Accordion>
    </div>
  )
}

function ResetRow({ show, onReset }: { show: boolean; onReset: () => void }) {
  if (!show) return null
  return (
    <button type="button" className="secondary reset-btn" onClick={onReset}>
      Restaurar padrão
    </button>
  )
}
