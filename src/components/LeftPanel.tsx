import { useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react'
import { useStore } from '../state/store'
import type { Unit } from '../lib/units'
import { getFrameLabel } from '../lib/frame'
import { loadPhotoFile } from '../lib/photo'
import { exportFramePDF, exportFramePNG, exportFrameGuidesPDF } from '../lib/export'
import { OverridesEditor } from './OverridesEditor'
import { Accordion } from './Accordion'
import './LeftPanel.css'

export function LeftPanel() {
  const collapsed = useStore((s) => s.leftPanelCollapsed)
  const toggleLeftPanel = useStore((s) => s.toggleLeftPanel)
  const debugMode = useStore((s) => s.debugMode)
  const toggleDebug = useStore((s) => s.toggleDebug)
  const guidesMode = useStore((s) => s.guidesMode)
  const setGuidesMode = useStore((s) => s.setGuidesMode)
  const createFrame = useStore((s) => s.createFrame)
  const frames = useStore((s) => s.frames)
  const selectedFrameIds = useStore((s) => s.selectedFrameIds)
  const selectFrame = useStore((s) => s.selectFrame)
  const toggleFrameSelection = useStore((s) => s.toggleFrameSelection)
  const removeFrame = useStore((s) => s.removeFrame)
  const removeFrames = useStore((s) => s.removeFrames)
  const duplicateFrame = useStore((s) => s.duplicateFrame)
  const setPhoto = useStore((s) => s.setPhoto)
  const setPhotoForFrames = useStore((s) => s.setPhotoForFrames)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)

  const [width, setWidth] = useState('1080')
  const [height, setHeight] = useState('1350')
  const [unit, setUnit] = useState<Unit>('px')
  const [bulkBusy, setBulkBusy] = useState<'pdf' | 'png' | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoTargetRef = useRef<'bulk' | string | null>(null)

  const selectedFrame = selectedFrameIds.length === 1 ? frames.find((f) => f.id === selectedFrameIds[0]) ?? null : null
  const selectedFrames = frames.filter((f) => selectedFrameIds.includes(f.id))

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const w = Number(width)
    const h = Number(height)
    if (!w || !h || w <= 0 || h <= 0) return
    createFrame({ width: w, height: h, unit })
  }

  const onFrameListClick = (e: MouseEvent, id: string) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleFrameSelection(id)
    else selectFrame(id)
  }

  const runBulkExport = async (kind: 'pdf' | 'png') => {
    setBulkBusy(kind)
    try {
      for (const f of selectedFrames) {
        if (guidesMode) await exportFrameGuidesPDF(f)
        else if (kind === 'pdf') await exportFramePDF(f)
        else await exportFramePNG(f)
      }
    } finally {
      setBulkBusy(null)
    }
  }

  const openPhotoDialog = (target: 'bulk' | string) => {
    photoTargetRef.current = target
    photoInputRef.current?.click()
  }

  const onPhotoFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const target = photoTargetRef.current
    photoTargetRef.current = null
    if (!file || !target || !/^image\/(png|jpe?g)$/.test(file.type)) return
    const photo = await loadPhotoFile(file)
    if (target === 'bulk') setPhotoForFrames(selectedFrameIds, photo)
    else setPhoto(target, photo)
  }

  if (collapsed) {
    return (
      <div className="left-panel left-panel--collapsed">
        <button className="secondary" onClick={toggleLeftPanel} title="Expandir painel">
          »
        </button>
      </div>
    )
  }

  return (
    <div className="left-panel">
      <div className="left-panel__header">
        <h1>Gerador de Artes</h1>
        <button className="secondary" onClick={toggleLeftPanel} title="Recolher painel">
          «
        </button>
      </div>

      <section className="left-panel__section left-panel__history">
        <button className="secondary" onClick={undo} disabled={!canUndo} title="Desfazer (Cmd/Ctrl+Z)">
          ↶ Desfazer
        </button>
        <button className="secondary" onClick={redo} disabled={!canRedo} title="Refazer (Cmd/Ctrl+Shift+Z)">
          ↷ Refazer
        </button>
      </section>

      <Accordion title="Novo frame">
        <form onSubmit={onSubmit} className="new-frame-form">
          <div className="field-row">
            <div>
              <label>Largura</label>
              <input
                type="number"
                min={1}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </div>
            <div>
              <label>Altura</label>
              <input
                type="number"
                min={1}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label>Unidade</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              <option value="px">px</option>
              <option value="cm">cm</option>
            </select>
          </div>
          <button type="submit">+ Criar frame</button>
        </form>
      </Accordion>

      <Accordion title="Modo">
        <div>
          <label>Visualização</label>
          <div className="mode-toggle">
            <button
              type="button"
              className={guidesMode ? 'secondary' : ''}
              onClick={() => setGuidesMode(false)}
            >
              Design
            </button>
            <button
              type="button"
              className={guidesMode ? '' : 'secondary'}
              onClick={() => setGuidesMode(true)}
            >
              Guias
            </button>
          </div>
          {guidesMode && (
            <p className="hint">
              Mostra caixas no lugar dos assets e exporta só o vetor (PDF) para montar no Illustrator.
            </p>
          )}
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={debugMode} onChange={toggleDebug} />
          Modo debug
        </label>
      </Accordion>

      {frames.length > 0 && (
        <Accordion title={`Frames (${frames.length})`} className="left-panel__frames">
          <ul className="frame-list">
            {frames.map((f) => (
              <li
                key={f.id}
                className={selectedFrameIds.includes(f.id) ? 'active' : ''}
                onClick={(e) => onFrameListClick(e, f.id)}
              >
                <span className="frame-list__name">{getFrameLabel(f)}</span>
                <span className="frame-list__actions">
                  <button
                    className="secondary frame-list__icon-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      duplicateFrame(f.id)
                    }}
                    title="Duplicar frame"
                    type="button"
                  >
                    ⧉
                  </button>
                  <button
                    className="secondary frame-list__icon-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFrame(f.id)
                    }}
                    title="Remover frame"
                    type="button"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Accordion>
      )}

      {selectedFrames.length > 0 && (
        <Accordion title={`Seleção (${selectedFrames.length})`} className="left-panel__selection">
          <ul className="selection-photo-grid">
            {selectedFrames.map((f) => (
              <li key={f.id}>
                <div
                  className="selection-photo-grid__thumb"
                  style={f.photo ? { backgroundImage: `url(${f.photo.src})` } : undefined}
                >
                  {!f.photo && <span>Sem foto</span>}
                </div>
                <span className="selection-photo-grid__name">{f.name}</span>
                <button className="secondary" type="button" onClick={() => openPhotoDialog(f.id)}>
                  Trocar foto
                </button>
              </li>
            ))}
          </ul>

          {selectedFrames.length > 1 && (
            <button className="secondary" type="button" onClick={() => openPhotoDialog('bulk')}>
              Trocar foto de todos os selecionados
            </button>
          )}

          <input
            ref={photoInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden-input"
            onChange={onPhotoFileSelected}
          />

          <div className="selection-toolbar">
            <div className="selection-toolbar__actions">
              {!guidesMode && (
                <button
                  className="secondary"
                  type="button"
                  disabled={bulkBusy !== null}
                  onClick={() => runBulkExport('png')}
                >
                  {bulkBusy === 'png' ? 'Exportando…' : 'Exportar PNG'}
                </button>
              )}
              <button
                className="secondary"
                type="button"
                disabled={bulkBusy !== null}
                onClick={() => runBulkExport('pdf')}
              >
                {bulkBusy === 'pdf' ? 'Exportando…' : guidesMode ? 'Exportar PDF (guias)' : 'Exportar PDF'}
              </button>
              <button className="secondary" type="button" onClick={() => removeFrames(selectedFrameIds)}>
                Remover
              </button>
            </div>
          </div>
        </Accordion>
      )}

      {selectedFrame && (
        <Accordion title="Ajustes do frame" className="left-panel__overrides">
          <OverridesEditor frame={selectedFrame} />
        </Accordion>
      )}
    </div>
  )
}
