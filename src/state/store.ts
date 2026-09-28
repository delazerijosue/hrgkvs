import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { computeLayout, defaultOverrides, type FrameOverrides } from '../lib/layout'
import { resolveFrameAssets } from '../lib/frame'
import { preservePhotoFraction } from '../lib/photo'
import { toPx, type Unit } from '../lib/units'
import type { CustomAsset } from '../lib/customAssets'
import type { Frame, PhotoState } from '../types'

function deepCloneFrame(source: Frame, id: string): Frame {
  return {
    ...source,
    id,
    overrides: { ...source.overrides, etiquetaPos: source.overrides.etiquetaPos ? { ...source.overrides.etiquetaPos } : undefined },
    photo: source.photo ? { ...source.photo, transform: { ...source.photo.transform } } : null,
    customEtiqueta: source.customEtiqueta ? { ...source.customEtiqueta } : null,
    customTagline: source.customTagline ? { ...source.customTagline } : null,
  }
}

/** Clone offset by a fixed amount — used when the new frame should appear visibly apart from its source (duplicate/paste). */
function cloneFrameOffset(source: Frame, id: string): Frame {
  const cloned = deepCloneFrame(source, id)
  return { ...cloned, canvasX: source.canvasX + 48, canvasY: source.canvasY + 48 }
}

interface CanvasView {
  x: number
  y: number
  zoom: number
}

interface HistoryEntry {
  frames: Frame[]
  selectedFrameIds: string[]
}

const MAX_HISTORY = 50

interface AppState {
  frames: Frame[]
  selectedFrameIds: string[]
  /** In-app clipboard (Ctrl/Cmd+C e Ctrl/Cmd+V) — não é o clipboard do sistema. */
  clipboard: Frame[]
  /** Modo "Guias": mostra/exporta caixas vetoriais no lugar dos assets reais, para montar o layout no Illustrator. */
  guidesMode: boolean
  debugMode: boolean
  /** Tecla espaço pressionada — ativa a ferramenta de mão (pan por arrasto) no canvas. */
  spacePressed: boolean
  leftPanelCollapsed: boolean
  canvasView: CanvasView
  past: HistoryEntry[]
  future: HistoryEntry[]

  /** Salva o estado atual no histórico de undo. Chame antes de uma mudança que deva ser desfazível. */
  snapshot: () => void
  undo: () => void
  redo: () => void

  createFrame: (input: { width: number; height: number; unit: Unit }) => string
  duplicateFrame: (id: string) => string | null
  selectFrame: (id: string | null) => void
  selectFrames: (ids: string[]) => void
  toggleFrameSelection: (id: string) => void
  removeFrame: (id: string) => void
  removeFrames: (ids: string[]) => void
  copySelection: () => void
  pasteClipboard: () => void
  moveFrame: (id: string, canvasX: number, canvasY: number) => void
  resizeFrame: (id: string, width: number, height: number) => void
  updateOverrides: (id: string, patch: Partial<FrameOverrides>) => void
  clearOverride: (id: string, key: keyof FrameOverrides) => void
  setPhoto: (id: string, photo: PhotoState | null) => void
  setPhotoForFrames: (ids: string[], photo: PhotoState) => void
  updatePhotoTransform: (id: string, transform: PhotoState['transform']) => void
  setCustomEtiqueta: (id: string, asset: CustomAsset | null) => void
  setCustomTagline: (id: string, asset: CustomAsset | null) => void
  toggleDebug: () => void
  setGuidesMode: (value: boolean) => void
  setSpacePressed: (value: boolean) => void
  toggleLeftPanel: () => void
  setCanvasView: (view: Partial<CanvasView>) => void
}

const NEW_FRAME_GAP = 160

function nextFramePosition(frames: Frame[]): { x: number; y: number } {
  if (frames.length === 0) return { x: 0, y: 0 }
  const last = frames[frames.length - 1]
  return { x: last.canvasX + last.widthPx + NEW_FRAME_GAP, y: last.canvasY }
}

const DEFAULT_FRAME_SIZES: { width: number; height: number }[] = [
  { width: 1080, height: 1350 },
  { width: 1080, height: 1920 },
  { width: 1920, height: 1080 },
  { width: 600, height: 1800 },
]

function createDefaultFrames(): Frame[] {
  const frames: Frame[] = []
  DEFAULT_FRAME_SIZES.forEach(({ width, height }, i) => {
    const { x, y } = nextFramePosition(frames)
    frames.push({
      id: nanoid(),
      name: `Frame ${i + 1}`,
      widthPx: toPx(width, 'px'),
      heightPx: toPx(height, 'px'),
      inputWidth: width,
      inputHeight: height,
      unit: 'px',
      canvasX: x,
      canvasY: y,
      overrides: defaultOverrides(),
      photo: null,
      customEtiqueta: null,
      customTagline: null,
    })
  })
  return frames
}

export const useStore = create<AppState>((set, get) => ({
  frames: createDefaultFrames(),
  selectedFrameIds: [],
  clipboard: [],
  guidesMode: false,
  debugMode: false,
  spacePressed: false,
  leftPanelCollapsed: false,
  canvasView: { x: 0, y: 0, zoom: 1 },
  past: [],
  future: [],

  snapshot: () => {
    const { frames, selectedFrameIds, past } = get()
    const entry: HistoryEntry = { frames, selectedFrameIds }
    const nextPast = [...past, entry].slice(-MAX_HISTORY)
    set({ past: nextPast, future: [] })
  },

  undo: () => {
    const { past, future, frames, selectedFrameIds } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    const current: HistoryEntry = { frames, selectedFrameIds }
    set({
      frames: previous.frames,
      selectedFrameIds: previous.selectedFrameIds,
      past: past.slice(0, -1),
      future: [...future, current],
    })
  },

  redo: () => {
    const { past, future, frames, selectedFrameIds } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    const current: HistoryEntry = { frames, selectedFrameIds }
    set({
      frames: next.frames,
      selectedFrameIds: next.selectedFrameIds,
      past: [...past, current],
      future: future.slice(0, -1),
    })
  },

  createFrame: ({ width, height, unit }) => {
    get().snapshot()
    const widthPx = toPx(width, unit)
    const heightPx = toPx(height, unit)
    const { x, y } = nextFramePosition(get().frames)
    const id = nanoid()
    const frame: Frame = {
      id,
      name: `Frame ${get().frames.length + 1}`,
      widthPx,
      heightPx,
      inputWidth: width,
      inputHeight: height,
      unit,
      canvasX: x,
      canvasY: y,
      overrides: defaultOverrides(),
      photo: null,
      customEtiqueta: null,
      customTagline: null,
    }
    set((s) => ({ frames: [...s.frames, frame], selectedFrameIds: [id] }))
    return id
  },

  duplicateFrame: (id) => {
    get().snapshot()
    const source = get().frames.find((f) => f.id === id)
    if (!source) return null
    const newId = nanoid()
    const clone: Frame = { ...cloneFrameOffset(source, newId), name: `${source.name} cópia` }
    set((s) => ({ frames: [...s.frames, clone], selectedFrameIds: [newId] }))
    return newId
  },

  selectFrame: (id) => set({ selectedFrameIds: id ? [id] : [] }),

  selectFrames: (ids) => set({ selectedFrameIds: ids }),

  toggleFrameSelection: (id) =>
    set((s) => ({
      selectedFrameIds: s.selectedFrameIds.includes(id)
        ? s.selectedFrameIds.filter((x) => x !== id)
        : [...s.selectedFrameIds, id],
    })),

  removeFrames: (ids) => {
    if (ids.length === 0) return
    get().snapshot()
    const idSet = new Set(ids)
    set((s) => ({
      frames: s.frames.filter((f) => !idSet.has(f.id)),
      selectedFrameIds: s.selectedFrameIds.filter((x) => !idSet.has(x)),
    }))
  },

  copySelection: () => {
    const { frames, selectedFrameIds } = get()
    const selected = frames.filter((f) => selectedFrameIds.includes(f.id))
    if (selected.length === 0) return
    set({ clipboard: selected.map((f) => deepCloneFrame(f, f.id)) })
  },

  pasteClipboard: () => {
    const { clipboard } = get()
    if (clipboard.length === 0) return
    get().snapshot()
    const clones = clipboard.map((f) => cloneFrameOffset(f, nanoid()))
    set((s) => ({
      frames: [...s.frames, ...clones],
      selectedFrameIds: clones.map((c) => c.id),
      clipboard: clones,
    }))
  },

  removeFrame: (id) => {
    get().snapshot()
    set((s) => ({
      frames: s.frames.filter((f) => f.id !== id),
      selectedFrameIds: s.selectedFrameIds.filter((x) => x !== id),
    }))
  },

  moveFrame: (id, canvasX, canvasY) =>
    set((s) => ({
      frames: s.frames.map((f) => (f.id === id ? { ...f, canvasX, canvasY } : f)),
    })),

  resizeFrame: (id, width, height) => {
    get().snapshot()
    set((s) => ({
      frames: s.frames.map((f) => {
        if (f.id !== id || width <= 0 || height <= 0) return f
        const widthPx = toPx(width, f.unit)
        const heightPx = toPx(height, f.unit)
        const resized: Frame = { ...f, widthPx, heightPx, inputWidth: width, inputHeight: height }

        if (!resized.photo) return resized

        const { etiquetaAsset: etiqueta, taglineAsset: tagline } = resolveFrameAssets(f)
        const oldPhotoArea = computeLayout(f.widthPx, f.heightPx, f.overrides, etiqueta.aspectRatio, tagline.aspectRatio).photoArea
        const newPhotoArea = computeLayout(widthPx, heightPx, resized.overrides, etiqueta.aspectRatio, tagline.aspectRatio).photoArea
        const transform = preservePhotoFraction(
          oldPhotoArea,
          newPhotoArea,
          resized.photo.transform,
          resized.photo.naturalWidth,
          resized.photo.naturalHeight,
        )
        return { ...resized, photo: { ...resized.photo, transform } }
      }),
    }))
  },

  updateOverrides: (id, patch) => {
    get().snapshot()
    set((s) => ({
      frames: s.frames.map((f) =>
        f.id === id ? { ...f, overrides: { ...f.overrides, ...patch } } : f,
      ),
    }))
  },

  clearOverride: (id, key) => {
    get().snapshot()
    set((s) => ({
      frames: s.frames.map((f) => {
        if (f.id !== id) return f
        const overrides = { ...f.overrides }
        delete overrides[key]
        return { ...f, overrides }
      }),
    }))
  },

  setPhoto: (id, photo) => {
    get().snapshot()
    set((s) => ({
      frames: s.frames.map((f) => (f.id === id ? { ...f, photo } : f)),
    }))
  },

  setPhotoForFrames: (ids, photo) => {
    if (ids.length === 0) return
    get().snapshot()
    const idSet = new Set(ids)
    set((s) => ({
      frames: s.frames.map((f) => (idSet.has(f.id) ? { ...f, photo: { ...photo, transform: { ...photo.transform } } } : f)),
    }))
  },

  updatePhotoTransform: (id, transform) =>
    set((s) => ({
      frames: s.frames.map((f) =>
        f.id === id && f.photo ? { ...f, photo: { ...f.photo, transform } } : f,
      ),
    })),

  setCustomEtiqueta: (id, asset) => {
    get().snapshot()
    set((s) => ({
      frames: s.frames.map((f) => (f.id === id ? { ...f, customEtiqueta: asset } : f)),
    }))
  },

  setCustomTagline: (id, asset) => {
    get().snapshot()
    set((s) => ({
      frames: s.frames.map((f) => (f.id === id ? { ...f, customTagline: asset } : f)),
    }))
  },

  toggleDebug: () => set((s) => ({ debugMode: !s.debugMode })),
  setGuidesMode: (value) => set({ guidesMode: value }),
  setSpacePressed: (value) => set({ spacePressed: value }),
  toggleLeftPanel: () => set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),
  setCanvasView: (view) => set((s) => ({ canvasView: { ...s.canvasView, ...view } })),
}))
