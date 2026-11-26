import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { api, del, post, put } from '../api'
import { useApp } from '../AppContext'
import { Artwork } from '../Artwork'
import { CloseButton, Modal } from '../components'
import { COMPARISON_TOOLS, DEFAULT_PROMPTS, STUDIO_TOOLS } from '../data'
import { ArrowRightIcon, CheckIcon, CloseIcon, CollapseIcon, EyeIcon, LockIcon, PlusIcon, SparkIcon } from '../icons'
import { Select } from '../Select'
import { buildComparisonArtSvg, COMPARISON_DEMOS } from '../studioComparison'
import type { Asset, ModelCatalog, ModelOption, Product, Skill, StudioJob, UploadSlot } from '../types'

const RATIOS = ['smart', '1:1', '3:4', '16:9', '4:3', '9:16', '2:3', '3:2', '21:9'] as const
const VIDEO_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'] as const
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const
const IMAGE_RES_EDGES: Record<string, number> = { '1K': 1024, '1.5K': 1536, '2K': 2048, '4K': 4096 }
const SHOW_SKILLS = false
const LOCAL_ERASE_DEMO_GIF = '/gifs/local-erase-demo.gif'
const LOCAL_INPAINT_DEMO_GIF = '/gifs/local-inpaint-demo.gif'

type StudioRouteContext = {
  openTasks: () => void
}

type VideoCapability = {
  firstLabel: string
  supportsFirstLast: boolean
  maxRefs: number
  maxVideos: number
  maxVideoSec: number
  durations: number[]
  resolutions: string[]
  ratios: string[]
  audioChoices: boolean[]
  note: string
}

type MentionOption = {
  token: string
  name: string
  seed: number
  url?: string
  kind?: string
  detail: string
}

type MentionMenuState = {
  field: 'image' | 'video'
  start: number
  end: number
  query: string
  activeIndex: number
}

function capabilityForTool(tool: string) {
  if (tool === 'video' || tool === 'product') return 'video'
  if (tool === 'article') return 'understanding'
  return 'image'
}

function ratioIcon(ratio: string) {
  if (ratio === 'smart' || ratio === 'adaptive') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m15 4-1 3-3 1 3 1 1 3 1-3 3-1-3-1-1-3Z" />
        <path d="M5 19 14 10" />
        <path d="M3 17l4 4" />
      </svg>
    )
  }
  const [rawW, rawH] = ratio.split(':').map(Number)
  const aspect = rawW && rawH ? rawW / rawH : 1
  const width = aspect >= 1 ? 16 : Math.max(6, Math.round(16 * aspect))
  const height = aspect >= 1 ? Math.max(6, Math.round(16 / aspect)) : 16
  return (
    <i style={{ width, height }} aria-hidden="true" />
  )
}

function imageResolutionDisabledReason(resolution: string, provider: string, modelId: string) {
  if (provider === 'google' && modelId.includes('lite') && resolution !== '1K' && resolution !== 'custom') return 'Nano Banana Lite 仅支持 1K 分辨率'
  if (provider === 'google' && (resolution === '1.5K' || resolution === 'custom')) return 'Nano Banana 仅提供 1K、2K、4K 档位'
  if (provider === 'openai' && resolution === '4K') return '此预设超出 GPT Image 尺寸范围，请用 2K 或自定义'
  if (provider === 'ark' && modelId.includes('seedream-5') && resolution === '4K') return '当前 Seedream 5.0 模型最高支持 2K'
  if (provider === 'ark' && modelId.includes('seedream-4') && resolution === '1.5K') return '当前 Seedream 4.5 模型最低支持 2K'
  return ''
}

function presetImageDimensions(ratio: string, resolution: string, currentWidth: number, currentHeight: number) {
  const edge =
    resolution === 'custom'
      ? Math.round(Math.sqrt((currentWidth || 2048) * (currentHeight || 2048)))
      : IMAGE_RES_EDGES[resolution] || 2048
  if (ratio === 'smart' || ratio === 'custom') {
    const aspect = currentWidth && currentHeight ? currentWidth / currentHeight : 1
    if (ratio === 'smart') return { width: edge, height: edge }
    return {
      width: Math.max(64, Math.floor((edge * Math.sqrt(aspect)) / 16) * 16),
      height: Math.max(64, Math.floor(edge / Math.sqrt(aspect) / 16) * 16),
    }
  }
  let [width, height] = ratio.split(':').map(Number)
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const divisor = gcd(width, height)
  width /= divisor
  height /= divisor
  const scale = Math.max(16, Math.floor(edge / Math.sqrt(width * height) / 16) * 16)
  return { width: width * scale, height: height * scale }
}

function imageDimensionError(width: number, height: number, provider: string, modelId: string) {
  if (!width || !height || width < 64 || height < 64 || width > 16384 || height > 16384) return '宽高需为 64–16384 像素。'
  if (width / height < 1 / 16 || width / height > 16) return '图片比例需在 1:16–16:1 之间。'
  if (provider === 'openai' && modelId.startsWith('gpt-image-1') && !['1024x1024', '1536x1024', '1024x1536'].includes(`${width}x${height}`)) {
    return '当前 GPT Image 1 模型请选择 1024×1024、1536×1024 或 1024×1536。'
  }
  let minPixels = provider === 'ark' ? 921600 : 262144
  let maxPixels = 16777216
  if (provider === 'ark' && modelId.includes('seedream-5')) maxPixels = 4624220
  if (provider === 'ark' && modelId.includes('seedream-4')) minPixels = 3686400
  if (width * height < minPixels || width * height > maxPixels) {
    return `当前模型总像素需在 ${minPixels.toLocaleString()}–${maxPixels.toLocaleString()} 之间，请调整分辨率或宽高。`
  }
  return ''
}

function imageMaxCount(provider: string, referenceCount: number) {
  if (provider === 'google' || provider === 'midjourney') return 1
  if (provider === 'ark') return Math.max(1, Math.min(4, 15 - referenceCount))
  return 4
}

function isVideoUpload(slot: UploadSlot) {
  return slot.kind === 'video' || /\.(mp4|mov|webm|mkv|m4v)$/i.test(slot.name)
}

function assetToUploadSlot(asset: Asset): UploadSlot {
  return { id: String(asset.id), name: asset.name, seed: asset.seed, url: asset.url, kind: asset.kind }
}

function studioReferenceRole(toolId: string, index: number, videoMode: 'omni_reference' | 'first_last_frame', kind?: string) {
  if (toolId === 'video') {
    if (kind === 'video') return 'reference_video'
    if (videoMode === 'first_last_frame') return index === 0 ? 'first_frame' : 'last_frame'
  }
  if (toolId === 'virtual_try_on') return index === 0 ? 'try_on_person' : 'try_on_garment'
  if (toolId === 'apparel_set') return ['apparel_front', 'apparel_back', 'apparel_model'][index] || 'apparel_front'
  return 'source'
}

function videoCapability(provider: string, modelId: string): VideoCapability {
  const normalizedModelId = modelId.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  if (normalizedModelId.includes('seedance-2-5')) {
    return {
      firstLabel: '全能参考',
      supportsFirstLast: true,
      maxRefs: 30,
      maxVideos: 10,
      maxVideoSec: 30,
      durations: [4, 5, 6, 8, 10, 12, 15],
      resolutions: ['480p', '720p', '1080p'],
      ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'],
      audioChoices: [true, false],
      note: 'Seedance 2.5 支持最多 30 张参考图与 10 个参考视频；首尾帧模式下画面比例自动跟随首帧。',
    }
  }
  if (normalizedModelId.includes('seedance-2-0-fast')) {
    return {
      firstLabel: '全能参考',
      supportsFirstLast: true,
      maxRefs: 9,
      maxVideos: 3,
      maxVideoSec: 15,
      durations: [4, 5, 8, 10, 15],
      resolutions: ['480p', '720p'],
      ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'],
      audioChoices: [true, false],
      note: '',
    }
  }
  if (normalizedModelId.includes('seedance-2-0')) {
    return {
      firstLabel: '全能参考',
      supportsFirstLast: true,
      maxRefs: 9,
      maxVideos: 3,
      maxVideoSec: 15,
      durations: [4, 5, 8, 10, 15],
      resolutions: ['480p', '720p', '1080p'],
      ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'],
      audioChoices: [true, false],
      note: 'Seedance 2.0 支持最多 9 张参考图与 3 个参考视频（总时长 ≤ 15 秒）。',
    }
  }
  if (provider === 'kling' || modelId.includes('kling')) {
    return {
      firstLabel: '首帧参考',
      supportsFirstLast: true,
      maxRefs: 1,
      maxVideos: 0,
      maxVideoSec: 0,
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'],
      audioChoices: [false],
      note: '可灵 Kling V2 支持单图首帧或首尾帧；带参考图时画幅自动自适应。',
    }
  }
  if (provider === 'minimax' || modelId.includes('hailuo')) {
    return {
      firstLabel: '全能参考',
      supportsFirstLast: true,
      maxRefs: 1,
      maxVideos: 0,
      maxVideoSec: 0,
      durations: [6, 10],
      resolutions: ['720p', '1080p'],
      ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', 'adaptive'],
      audioChoices: [false],
      note: 'MiniMax 海螺 V2 首尾帧模式比例自适应首帧图片。',
    }
  }
  return {
    firstLabel: '首帧参考',
    supportsFirstLast: false,
    maxRefs: 1,
    maxVideos: 0,
    maxVideoSec: 0,
    durations: [5, 10],
    resolutions: ['480p', '720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    audioChoices: [true, false],
    note: '通义万相 Wan 2.1 支持单张首帧图生视频与音频同步生成。',
  }
}

function modelResolutionCredits(model: ModelOption | undefined, resolution: string) {
  if (!model) return 0
  const configured =
    resolution === '480p' ? model.credits480p
      : resolution === '720p' ? model.credits720p
        : resolution === '1080p' ? model.credits1080p
          : undefined
  return configured && configured > 0 ? configured : model.credits || 0
}

function outputCost(model: ModelOption | undefined, tool: string, count: number, duration: number, resolution = '') {
  if (!model || model.source === 'custom') return 0
  if (tool === 'video' || tool === 'product' || model.unit === '秒') return modelResolutionCredits(model, resolution) * duration
  if (tool === 'article') return model.credits || 0
  return (model.credits || 0) * count
}

function ComparisonCard({
  tool,
  index,
  onIndexChange,
  onUse,
}: {
  tool: string
  index: number
  onIndexChange: (index: number) => void
  onUse: () => void
}) {
  const demo = COMPARISON_DEMOS[tool]
  if (!demo) return null
  if (tool === 'image_erase' || tool === 'image_inpaint') {
    const isErase = tool === 'image_erase'
    return (
      <section
        className="ba-showcase-card ba-erase-gif-card"
        aria-label={isErase ? '涂抹局部消除动画演示' : '涂抹局部重绘动画演示'}
      >
        <div className="ba-erase-gif-frame">
          <img
            src={isErase ? LOCAL_ERASE_DEMO_GIF : LOCAL_INPAINT_DEMO_GIF}
            alt={isErase ? '涂抹杂物后自动消除并补全背景的动画演示' : '涂抹局部区域后自动替换新内容的动画演示'}
            draggable={false}
          />
          <span className="ba-gif-badge">{isErase ? '局部消除动画' : '局部重绘动画'}</span>
        </div>
        <div className="ba-footer">
          <div className="ba-slide-caption">
            {isErase ? '示例 · 涂抹需要移除的物体，AI 自动补全背景与光影' : '示例 · 涂抹需要替换的区域，AI 按描述生成新的局部内容'}
          </div>
        </div>
      </section>
    )
  }
  const slideIndex = index % demo.slides.length
  const slide = demo.slides[slideIndex]
  const staticImages = demo.images
  const beforeArt = staticImages ? { html: '', style: {}, tag: null, extraClass: undefined } : buildComparisonArtSvg(tool, slideIndex, 'before')
  const afterArt = staticImages ? { html: '', style: {}, tag: null, extraClass: undefined } : buildComparisonArtSvg(tool, slideIndex, 'after')
  const tall = !['image_inpaint', 'image_erase'].includes(tool)
  return (
    <section className={`ba-showcase-card${tall ? ' ba-showcase-tall' : ''}`} aria-label={`${STUDIO_TOOLS.find((item) => item.id === tool)?.name}创作前后对比`}>
      <div className={`ba-compare-grid${demo.layout === 'balanced' ? ' balanced' : ''}`}>
        <div className="ba-col before">
          <span className="ba-pill">{demo.beforeLabel}</span>
          <div className={`ba-frame before ${beforeArt.extraClass || ''}`} style={beforeArt.style}>
            {beforeArt.tag ? <span className={`ba-corner-tag ${beforeArt.tag.cls}`}>{beforeArt.tag.text}</span> : null}
            {staticImages
              ? <img src={staticImages.before} alt={`${demo.beforeLabel}示例`} />
              : <div dangerouslySetInnerHTML={{ __html: beforeArt.html }} />}
          </div>
        </div>
        <div className="ba-arrow-bridge" aria-hidden="true">
          <ArrowRightIcon size={16} strokeWidth={2.4} />
        </div>
        <div className="ba-col after">
          <span className="ba-pill">{demo.afterLabel}</span>
          <div className={`ba-frame after ${afterArt.extraClass || ''}`} style={afterArt.style}>
            {afterArt.tag ? <span className={`ba-corner-tag ${afterArt.tag.cls}`}>{afterArt.tag.text}</span> : null}
            {staticImages
              ? <img src={staticImages.after} alt={`${demo.afterLabel}示例`} />
              : <div dangerouslySetInnerHTML={{ __html: afterArt.html }} />}
          </div>
        </div>
      </div>
      <div className="ba-footer">
        {staticImages ? (
          <div className="ba-slide-caption">示例 · {slide.title}</div>
        ) : (
          <>
            <div className="ba-pager">
              <button type="button" className="ba-nav-btn" aria-label="上一组对比示例" onClick={() => onIndexChange((index - 1 + demo.slides.length) % demo.slides.length)}>
                ‹
              </button>
              <div className="ba-dots" role="tablist" aria-label="对比示例切换">
                {demo.slides.map((example, dotIndex) => (
                  <button
                    key={example.title}
                    type="button"
                    role="tab"
                    aria-selected={dotIndex === slideIndex}
                    aria-label={`查看示例 ${dotIndex + 1}`}
                    className={`ba-dot ${dotIndex === slideIndex ? 'active' : ''}`}
                    onClick={() => onIndexChange(dotIndex)}
                  />
                ))}
              </div>
              <button type="button" className="ba-nav-btn" aria-label="下一组对比示例" onClick={() => onIndexChange((index + 1) % demo.slides.length)}>
                ›
              </button>
            </div>
            <div className="ba-slide-caption">
              示例 {slideIndex + 1}/{demo.slides.length} · {slide.title}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

type BrushStroke = {
  points: Array<{ x: number; y: number }>
  size: number
  mode: 'brush' | 'eraser'
}

const BRUSH_COLOR = '#B0175A'
const DEFAULT_BRUSH_SIZE = 28

function InpaintCanvas({ erase, src }: { erase: boolean; src?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const activeStrokeRef = useRef<BrushStroke | null>(null)
  const [aspect, setAspect] = useState(4 / 3)
  const [strokes, setStrokes] = useState<BrushStroke[]>([])
  const [redoStrokes, setRedoStrokes] = useState<BrushStroke[]>([])
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE)
  const [brushMode, setBrushMode] = useState<'brush' | 'eraser'>('brush')
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false })
  const stageAreaRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })

  const brushWidth = (canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    return Math.max(1, brushSize * (canvas.width / Math.max(1, rect.width)))
  }

  const applyStrokeStyle = (ctx: CanvasRenderingContext2D, stroke: BrushStroke) => {
    ctx.globalCompositeOperation = stroke.mode === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = stroke.mode === 'eraser' ? 'rgba(0,0,0,1)' : BRUSH_COLOR
    ctx.fillStyle = stroke.mode === 'eraser' ? 'rgba(0,0,0,1)' : BRUSH_COLOR
    ctx.lineWidth = stroke.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: BrushStroke) => {
    if (!stroke.points.length) return
    applyStrokeStyle(ctx, stroke)
    if (stroke.points.length === 1) {
      ctx.beginPath()
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      return
    }
    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
    }
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }

  const redraw = (nextStrokes: BrushStroke[]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    nextStrokes.forEach((stroke) => drawStroke(ctx, stroke))
  }

  useEffect(() => {
    activeStrokeRef.current = null
    drawingRef.current = false
    setStrokes([])
    setRedoStrokes([])
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }, [src, aspect])

  useLayoutEffect(() => {
    const area = stageAreaRef.current
    if (!area) return
    const update = () => {
      const rect = area.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      let width = rect.width
      let height = width / aspect
      if (height > rect.height) {
        height = rect.height
        width = height * aspect
      }
      const next = { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) }
      setStageSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(area)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [aspect])

  const undo = () => {
    if (!strokes.length) return
    const last = strokes[strokes.length - 1]
    const next = strokes.slice(0, -1)
    setStrokes(next)
    setRedoStrokes([...redoStrokes, last])
    redraw(next)
  }

  const redo = () => {
    if (!redoStrokes.length) return
    const last = redoStrokes[redoStrokes.length - 1]
    const next = [...strokes, last]
    setStrokes(next)
    setRedoStrokes(redoStrokes.slice(0, -1))
    redraw(next)
  }

  const clearMask = () => {
    activeStrokeRef.current = null
    drawingRef.current = false
    setStrokes([])
    setRedoStrokes([])
    redraw([])
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const pointFromClient = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const beginStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    const stroke: BrushStroke = {
      points: [pointFromClient(event.clientX, event.clientY)],
      size: brushWidth(canvas),
      mode: brushMode,
    }
    activeStrokeRef.current = stroke
    drawStroke(ctx, stroke)
    setRedoStrokes([])
  }

  const extendStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const stroke = activeStrokeRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!stroke || !canvas || !ctx) return
    const native = event.nativeEvent as PointerEvent
    const samples = native.getCoalescedEvents?.() || []
    const points = samples.length ? samples : [native]
    applyStrokeStyle(ctx, stroke)
    for (const sample of points) {
      const pos = pointFromClient(sample.clientX, sample.clientY)
      const prev = stroke.points[stroke.points.length - 1]
      if (Math.hypot(pos.x - prev.x, pos.y - prev.y) < 0.8) continue
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      stroke.points.push(pos)
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  const endStroke = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const stroke = activeStrokeRef.current
    activeStrokeRef.current = null
    if (!stroke || !stroke.points.length) return
    setStrokes((current) => [...current, stroke])
  }

  return (
    <div className="inpaint-wrap">
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--ink-secondary)', fontWeight: 600 }}>
          当前底图：{src ? '已选择原图' : '尚未选择'}
        </span>
        <span className="inpaint-wrap-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={undo} disabled={!strokes.length} title="撤销（Ctrl+Z）">
            撤销
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={redo} disabled={!redoStrokes.length} title="重做（Ctrl+Shift+Z）">
            重做
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={clearMask} disabled={!strokes.length}>
            清除涂抹
          </button>
        </span>
      </div>
      <div className="inpaint-toolbar">
        <div className="inpaint-tool-toggle" role="group" aria-label="涂抹工具">
          <button
            type="button"
            className={brushMode === 'brush' ? 'active' : ''}
            aria-pressed={brushMode === 'brush'}
            onClick={() => setBrushMode('brush')}
          >
            画笔
          </button>
          <button
            type="button"
            className={brushMode === 'eraser' ? 'active' : ''}
            aria-pressed={brushMode === 'eraser'}
            onClick={() => setBrushMode('eraser')}
          >
            橡皮擦
          </button>
        </div>
        <label className="inpaint-brush-size">
          <span>笔刷大小</span>
          <input
            type="range"
            min={8}
            max={80}
            step={2}
            value={brushSize}
            aria-label="笔刷大小"
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
          <span className="tabular">{brushSize}px</span>
        </label>
        <span className="help-text">{brushMode === 'eraser' ? '橡皮擦只擦除粉色遮罩，不修改原图。' : '涂抹区域将以半透明粉色遮罩显示。'}</span>
      </div>
      <div className="inpaint-stage-area" ref={stageAreaRef}>
        <div
          className="inpaint-stage"
          style={stageSize.width ? { width: stageSize.width, height: stageSize.height } : undefined}
        >
          {src ? (
            <img
              src={src}
              alt="待处理原图"
              className="inpaint-stage-image"
              draggable={false}
              onLoad={(event) => {
                const img = event.currentTarget
                if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight)
              }}
            />
          ) : (
            <div className="inpaint-stage-empty">请先上传原图后再打开涂抹画布</div>
          )}
          <canvas
            ref={canvasRef}
            width={1000}
            height={Math.max(200, Math.round(1000 / aspect))}
            className="inpaint-stage-canvas"
            aria-label={erase ? '局部消除涂抹画布' : '局部重绘涂抹画布'}
            onPointerDown={(event) => {
              setCursor({ x: event.clientX - event.currentTarget.getBoundingClientRect().left, y: event.clientY - event.currentTarget.getBoundingClientRect().top, visible: true })
              beginStroke(event)
            }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top, visible: true })
              extendStroke(event)
            }}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={() => {
              if (drawingRef.current) endStroke()
              setCursor((current) => ({ ...current, visible: false }))
            }}
          />
          <span
            className={`inpaint-brush-cursor ${brushMode === 'eraser' ? 'is-eraser' : ''}`}
            aria-hidden="true"
            style={{
              left: cursor.x,
              top: cursor.y,
              width: brushSize,
              height: brushSize,
              opacity: cursor.visible ? 1 : 0,
            }}
          />
        </div>
      </div>
      <span className="help-text">
        涂抹需要{erase ? '智能消除' : '局部重绘'}的区域 · 支持撤销 / 重做（Ctrl+Z、Ctrl+Shift+Z），遮罩会随任务一并提交。
      </span>
    </div>
  )
}

export default function StudioPage() {
  const { user, toast, refreshUser } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { openTasks } = useOutletContext<StudioRouteContext>()
  const incoming = (location.state || {}) as { tool?: string; prompt?: string; asset?: Asset }
  const incomingTool = incoming.tool || 'image'
  const incomingAssetSlots: UploadSlot[] =
    incoming.asset && ['image', 'video'].includes(incoming.asset.kind)
      ? [{ id: String(incoming.asset.id), name: incoming.asset.name, seed: incoming.asset.seed, url: incoming.asset.url, kind: incoming.asset.kind }]
      : []
  const [toolId, setToolId] = useState(incomingTool)
  const [catalog, setCatalog] = useState<ModelCatalog>({ platform: [], custom: [] })
  const [assets, setAssets] = useState<Asset[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({})
  const [prompts, setPrompts] = useState<Record<string, string>>(() => ({ ...DEFAULT_PROMPTS, [incomingTool]: incoming.prompt || DEFAULT_PROMPTS[incomingTool] || '' }))
  const [counts, setCounts] = useState<Record<string, number>>({ image: 2, image_variation: 2, scene_variation: 4, pose_variation: 4, apparel_set: 6, product_retouch: 2 })
  const [imageRatio, setImageRatio] = useState('1:1')
  const [imageResolution, setImageResolution] = useState('2K')
  const [imageLocked, setImageLocked] = useState(true)
  const [imageWidth, setImageWidth] = useState(2048)
  const [imageHeight, setImageHeight] = useState(2048)
  const [videoRatio, setVideoRatio] = useState('16:9')
  const [videoResolution, setVideoResolution] = useState('720p')
  const [videoDuration, setVideoDuration] = useState(10)
  const [videoAudio, setVideoAudio] = useState(true)
  const [videoMode, setVideoMode] = useState<'omni_reference' | 'first_last_frame'>('omni_reference')
  const [productRatio, setProductRatio] = useState('9:16')
  const [productResolution, setProductResolution] = useState('720p')
  const [productAudio, setProductAudio] = useState(false)
  const [productCopyMode, setProductCopyMode] = useState('none')
  const [productImportValue, setProductImportValue] = useState('')
  const [productStoryboard, setProductStoryboard] = useState(false)
  const [articleStyle, setArticleStyle] = useState('fresh')
  const [compareRatio, setCompareRatio] = useState('3:4')
  const [printBackground, setPrintBackground] = useState('transparent')
  const [slots, setSlots] = useState<Record<string, UploadSlot[]>>({
    image: incomingTool === 'image' ? incomingAssetSlots : [],
    video: incomingTool === 'video' ? incomingAssetSlots : [],
    product: [],
    image_variation: [],
    scene_variation: [],
    pose_variation: [],
    print_extract: [],
    virtual_try_on: [],
    apparel_set: [],
    product_retouch: [],
    image_inpaint: [],
    image_erase: [],
  })
  const [comparisonIndex, setComparisonIndex] = useState<Record<string, number>>({})
  const [skillId, setSkillId] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<'image' | 'video' | 'any'>('image')
  const [pickerMediaTab, setPickerMediaTab] = useState<'all' | 'image' | 'video'>('all')
  const [pickerSelectedIds, setPickerSelectedIds] = useState<string[]>([])
  const [referenceTab, setReferenceTab] = useState<'all' | 'image' | 'video'>('all')
  const [referenceTrayCollapsed, setReferenceTrayCollapsed] = useState(false)
  const [referencePreview, setReferencePreview] = useState<UploadSlot | null>(null)
  const [inpaintOpen, setInpaintOpen] = useState(false)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [skillEdit, setSkillEdit] = useState<Skill | null>(null)
  const [skillForm, setSkillForm] = useState({ name: '', description: '', content: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ title: string; detail: string } | null>(null)
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mentionMenuRef = useRef<HTMLDivElement | null>(null)
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState | null>(null)

  const currentTool = STUDIO_TOOLS.find((item) => item.id === toolId) || STUDIO_TOOLS[0]
  const capability = capabilityForTool(toolId)
  const allModels = useMemo(
    () => [...catalog.platform.filter((model) => model.capability === capability), ...catalog.custom.filter((model) => model.capability === capability)],
    [catalog, capability],
  )
  const modelValue = selectedModels[toolId] || allModels[0]?.value || ''
  const currentModel = allModels.find((model) => model.value === modelValue) || allModels[0]
  const count = counts[toolId] || 1
  const duration = toolId === 'product' || toolId === 'video' ? (toolId === 'video' ? videoDuration : 15) : 0
  const activeResolution = toolId === 'video' ? videoResolution : toolId === 'product' ? productResolution : ''
  const unitCredits = modelResolutionCredits(currentModel, activeResolution)
  const estimated = outputCost(currentModel, toolId, count, duration, activeResolution)
  const availableCredits = user?.credits ?? 0
  const currentSlots = slots[toolId] || []
  const mentionOptions = useMemo<MentionOption[]>(() => {
    if (toolId === 'image') {
      return currentSlots.map((slot, index) => ({
        token: `@图片${index + 1}`,
        name: slot.name,
        seed: slot.seed,
        url: slot.url,
        kind: slot.kind,
        detail: '参考图片',
      }))
    }
    if (toolId !== 'video') return []
    if (videoMode === 'first_last_frame') {
      return currentSlots.slice(0, 2).map((slot, index) => ({
        token: index === 0 ? '@首帧' : '@尾帧',
        name: slot.name,
        seed: slot.seed,
        url: slot.url,
        kind: slot.kind,
        detail: index === 0 ? '起始首帧' : '结束尾帧',
      }))
    }
    const imageReferences = currentSlots.filter((slot) => !isVideoUpload(slot))
    const videoReferences = currentSlots.filter(isVideoUpload)
    return [
      ...imageReferences.map((slot, index) => ({
        token: `@图片${index + 1}`,
        name: slot.name,
        seed: slot.seed,
        url: slot.url,
        kind: slot.kind,
        detail: '参考图片',
      })),
      ...videoReferences.map((slot, index) => ({
        token: `@视频${index + 1}`,
        name: slot.name,
        seed: slot.seed,
        url: slot.url,
        kind: slot.kind,
        detail: '参考视频',
      })),
    ]
  }, [currentSlots, toolId, videoMode])
  const filteredMentionOptions = useMemo(() => {
    if (!mentionMenu) return []
    const query = mentionMenu.query.trim().toLocaleLowerCase()
    if (!query) return mentionOptions
    return mentionOptions.filter((item) => `${item.token} ${item.name} ${item.detail}`.toLocaleLowerCase().includes(query))
  }, [mentionMenu, mentionOptions])
  const isComparisonTool = COMPARISON_TOOLS.includes(toolId)
  const isInpaint = toolId === 'image_inpaint' || toolId === 'image_erase'
  const currentProvider = currentModel?.provider || ''
  const currentModelId = currentModel?.modelId || ''
  const videoCap = videoCapability(currentProvider, currentModelId)
  const imageMax = imageMaxCount(currentProvider, currentSlots.length)
  const imageDimError = imageDimensionError(imageWidth, imageHeight, currentProvider, currentModelId)
  const pickerMaxImages =
    toolId === 'video'
      ? videoMode === 'first_last_frame'
        ? 2
        : videoCap.maxRefs
      : toolId === 'virtual_try_on'
        ? 2
        : toolId === 'apparel_set'
          ? 3
          : isInpaint
            ? 1
            : 4
  const pickerMaxVideos = toolId === 'video' && videoMode === 'omni_reference' ? videoCap.maxVideos : 0
  const pickerImageCount = currentSlots.filter((slot) => !isVideoUpload(slot)).length
  const pickerVideoCount = currentSlots.filter(isVideoUpload).length
  const pickerImageRemaining = Math.max(0, pickerMaxImages - pickerImageCount)
  const pickerVideoRemaining = Math.max(0, pickerMaxVideos - pickerVideoCount)
  const pickerRemaining =
    pickerMode === 'image'
      ? pickerImageRemaining
      : pickerMode === 'video'
        ? pickerVideoRemaining
        : pickerImageRemaining + pickerVideoRemaining
  const pickerMultiSelect = pickerRemaining > 1
  const pickerAssetPool = assets.filter((asset) => pickerMode === 'any' || asset.kind === pickerMode)
  const filteredAssets = pickerAssetPool.filter(
    (asset) => pickerMediaTab === 'all' || asset.kind === pickerMediaTab,
  )
  const pickerTabOptions: Array<{ id: 'all' | 'image' | 'video'; label: string }> = [
    { id: 'all', label: `全部 (${pickerAssetPool.length})` },
    { id: 'image', label: `图片 (${pickerAssetPool.filter((asset) => asset.kind !== 'video').length})` },
    { id: 'video', label: `视频 (${pickerAssetPool.filter((asset) => asset.kind === 'video').length})` },
  ]
  const pickerSelectedAssets = pickerSelectedIds
    .map((id) => assets.find((asset) => String(asset.id) === id))
    .filter((asset): asset is Asset => Boolean(asset))
  const pickerSelectedImageCount = pickerSelectedAssets.filter((asset) => asset.kind !== 'video').length
  const pickerSelectedVideoCount = pickerSelectedAssets.filter((asset) => asset.kind === 'video').length
  const orderedVideoRatios = VIDEO_RATIOS.filter((ratio) => videoCap.ratios.includes(ratio))
  const paramsTitle =
    toolId === 'image'
      ? '生图模型与尺寸参数'
      : toolId === 'video'
        ? '视频模型与画面参数'
        : toolId === 'product'
          ? productStoryboard
            ? '生成视频'
            : '产品策划参数'
          : '模型与生成参数'
  const modelFieldLabel =
    toolId === 'image'
      ? '调用轨道与生图模型'
      : toolId === 'video'
        ? '调用轨道与视频模型'
        : toolId === 'product'
          ? '视频模型（支持产品多图参考）'
          : '调用轨道与模型选择'
  const primaryLabel =
    toolId === 'image'
      ? '立即生成图片'
      : toolId === 'video'
        ? '立即生成视频'
        : toolId === 'product'
          ? productStoryboard
            ? '生成 15 秒视频'
            : '生成分镜脚本'
          : '立即生成'
  const displayEstimated = toolId === 'product' && !productStoryboard ? 4 : estimated

  useEffect(() => {
    if (toolId !== 'image' || count <= imageMax) return
    setCounts((current) => ({ ...current, image: imageMax }))
  }, [count, imageMax, toolId])

  useEffect(() => {
    if (toolId !== 'video') return
    if (!videoCap.durations.includes(videoDuration)) {
      setVideoDuration(videoCap.durations[Math.min(2, videoCap.durations.length - 1)])
    }
    if (!videoCap.resolutions.includes(videoResolution)) {
      setVideoResolution(videoCap.resolutions[videoCap.resolutions.length - 1])
    }
    if (!videoCap.ratios.includes(videoRatio)) {
      setVideoRatio(videoCap.ratios[0])
    }
    if (!videoCap.audioChoices.includes(videoAudio)) {
      setVideoAudio(videoCap.audioChoices[0])
    }
    if (videoMode === 'first_last_frame' && !videoCap.supportsFirstLast) {
      setVideoMode('omni_reference')
    }
  }, [toolId, videoCap, videoDuration, videoResolution, videoRatio, videoAudio, videoMode])

  useEffect(() => {
    if (toolId !== 'product') return
    if (!videoCap.resolutions.includes(productResolution)) {
      setProductResolution(videoCap.resolutions[videoCap.resolutions.length - 1])
    }
  }, [toolId, videoCap, productResolution])

  const loadData = useCallback(async () => {
    try {
      const [modelCatalog, assetList, productList, skillList] = await Promise.all([
        api<ModelCatalog>('/models/catalog'),
        api<Asset[]>('/assets'),
        api<Product[]>('/products'),
        api<Skill[]>('/skills'),
      ])
      setCatalog(modelCatalog)
      setAssets(assetList)
      setProducts(productList)
      setSkills(skillList)
      setSelectedModels((current) => {
        const next = { ...current }
        for (const tool of STUDIO_TOOLS) {
          if (next[tool.id]) continue
          const cap = capabilityForTool(tool.id)
          const first = [...modelCatalog.platform, ...modelCatalog.custom].find((model) => model.capability === cap)
          if (first) next[tool.id] = first.value
        }
        return next
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : '工坊数据加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const setPrompt = (value: string) => setPrompts((current) => ({ ...current, [toolId]: value }))

  useEffect(() => {
    setMentionMenu(null)
  }, [toolId, videoMode])

  useEffect(() => {
    setReferenceTab('all')
    setReferenceTrayCollapsed(false)
    setReferencePreview(null)
  }, [toolId, videoMode])

  useEffect(() => {
    if (!currentSlots.length) setReferenceTrayCollapsed(false)
  }, [currentSlots.length])

  useEffect(() => {
    if (!mentionMenu) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (mentionMenuRef.current?.contains(target) || promptTextareaRef.current === target) return
      setMentionMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [mentionMenu])

  const handlePromptChange = (field: 'image' | 'video', event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    const cursor = event.target.selectionStart
    setPrompts((current) => ({ ...current, [field]: value }))
    const beforeCursor = value.slice(0, cursor)
    const match = beforeCursor.match(/(?:^|[\s，。！？；：、])@([^\s@]*)$/u)
    if (!match) {
      setMentionMenu(null)
      return
    }
    const start = beforeCursor.lastIndexOf('@')
    setMentionMenu((current) => ({
      field,
      start,
      end: cursor,
      query: match[1],
      activeIndex: current?.field === field && current.start === start ? current.activeIndex : 0,
    }))
  }

  const insertMentionOption = (option: MentionOption) => {
    if (!mentionMenu) return
    const value = prompts[toolId] || ''
    const start = Math.max(0, Math.min(mentionMenu.start, value.length))
    const end = Math.max(start, Math.min(mentionMenu.end, value.length))
    const insertion = `${option.token} `
    const next = value.slice(0, start) + insertion + value.slice(end)
    setPrompt(next)
    setMentionMenu(null)
    window.requestAnimationFrame(() => {
      const textarea = promptTextareaRef.current
      if (!textarea) return
      textarea.focus()
      const nextCursor = start + insertion.length
      textarea.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const handlePromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionMenu || mentionMenu.field !== toolId) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setMentionMenu(null)
      return
    }
    if (!filteredMentionOptions.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setMentionMenu((current) => {
        if (!current) return current
        const nextIndex = (current.activeIndex + direction + filteredMentionOptions.length) % filteredMentionOptions.length
        return { ...current, activeIndex: nextIndex }
      })
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const activeIndex = Math.min(mentionMenu.activeIndex, filteredMentionOptions.length - 1)
      insertMentionOption(filteredMentionOptions[activeIndex])
    }
  }

  const openAssetPicker = (mode: 'image' | 'video' | 'any' = 'image') => {
    setPickerSelectedIds([])
    setPickerMode(mode)
    setPickerMediaTab(mode === 'image' ? 'image' : mode === 'video' ? 'video' : 'all')
    setPickerOpen(true)
  }

  const closeAssetPicker = () => {
    setPickerOpen(false)
    setPickerSelectedIds([])
  }

  const uploadSlotFits = (slot: UploadSlot, list: UploadSlot[]) => {
    if (list.some((item) => item.id === slot.id)) return false
    if (isVideoUpload(slot)) {
      return pickerMaxVideos > 0 && list.filter(isVideoUpload).length < pickerMaxVideos
    }
    return list.filter((item) => !isVideoUpload(item)).length < pickerMaxImages
  }

  const addSlot = (slot: UploadSlot) => {
    setSlots((current) => {
      const list = current[toolId] || []
      if (!uploadSlotFits(slot, list)) return current
      return { ...current, [toolId]: [...list, slot] }
    })
  }

  const addSelectedPickerAssets = () => {
    const selectedAssets = pickerSelectedIds
      .map((id) => assets.find((asset) => String(asset.id) === id))
      .filter((asset): asset is Asset => Boolean(asset))
    if (!selectedAssets.length) return
    setSlots((current) => {
      const list = current[toolId] || []
      const next = [...list]
      for (const asset of selectedAssets) {
        const slot = assetToUploadSlot(asset)
        if (uploadSlotFits(slot, next)) next.push(slot)
      }
      if (next.length === list.length) return current
      return { ...current, [toolId]: next }
    })
    closeAssetPicker()
  }

  const removeSlot = (id: string) => {
    setSlots((current) => ({ ...current, [toolId]: (current[toolId] || []).filter((item) => item.id !== id) }))
  }

  const clearCurrentReferences = () => {
    setSlots((current) => ({ ...current, [toolId]: [] }))
    setPickerSelectedIds([])
    toast('已清空当前参考内容')
  }

  const uploadFile = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', file.name)
    try {
      const asset = await api<Asset>('/assets/upload', { method: 'POST', body: form })
      setAssets((current) => [asset, ...current])
      addSlot(assetToUploadSlot(asset))
      closeAssetPicker()
      toast('文件已上传至对象存储', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '上传失败', 'error')
    }
  }

  const useExample = (tool: string) => {
    const demo = COMPARISON_DEMOS[tool]
    if (!demo) return
    const idx = comparisonIndex[tool] || 0
    const slide = demo.slides[idx % demo.slides.length]
    const preset = slide.preset
    const stamp = Date.now()
    const refSlot = (ref: { name: string; seed: number } | undefined, key: string) =>
      ref ? { id: `demo-${key}-${stamp}`, name: ref.name, seed: ref.seed } : null
    let nextSlots: UploadSlot[] = []
    if (tool === 'virtual_try_on') {
      nextSlots = [
        refSlot(preset.person, 'person'),
        refSlot(preset.garment, 'garment'),
      ].filter((slot): slot is UploadSlot => Boolean(slot))
    } else if (tool === 'apparel_set') {
      nextSlots = [
        refSlot(preset.front, 'front'),
        refSlot(preset.back, 'back'),
        refSlot(preset.model, 'model'),
      ].filter((slot): slot is UploadSlot => Boolean(slot))
    } else {
      const source = refSlot(preset.source, 'source')
      nextSlots = source ? [source] : []
    }
    setToolId(tool)
    setPrompts((current) => ({
      ...current,
      [tool]: preset.prompt || '',
    }))
    setSlots((current) => ({ ...current, [tool]: nextSlots }))
    if (preset.count) setCounts((current) => ({ ...current, [tool]: preset.count || 1 }))
    if (preset.bg === 'transparent' || preset.bg === 'white') setPrintBackground(preset.bg)
    toast('已填入同款示例素材与参数，可微调或点击右侧立即生成', 'success')
  }

  const generateProductStoryboard = () => {
    if (!(slots.product || []).length) return toast('请先上传至少 1 张产品参考图', 'error')
    setProductStoryboard(true)
    toast('已生成 15 秒 5 镜结构化分镜脚本', 'success')
  }

  const chooseImageRatio = (ratio: string) => {
    setImageRatio(ratio)
    setImageLocked(true)
    const dimensions = presetImageDimensions(ratio, imageResolution, imageWidth, imageHeight)
    setImageWidth(dimensions.width)
    setImageHeight(dimensions.height)
  }

  const chooseImageResolution = (resolution: string) => {
    setImageResolution(resolution)
    const dimensions = presetImageDimensions(imageRatio, resolution, imageWidth, imageHeight)
    setImageWidth(dimensions.width)
    setImageHeight(dimensions.height)
  }

  const changeImageDimension = (axis: 'width' | 'height', rawValue: number) => {
    const value = Math.round(Number(rawValue)) || 0
    const aspect =
      imageRatio === 'smart' || imageRatio === 'custom'
        ? imageWidth && imageHeight
          ? imageWidth / imageHeight
          : 1
        : (() => {
            const [ratioWidth, ratioHeight] = imageRatio.split(':').map(Number)
            return ratioWidth / ratioHeight
          })()
    if (axis === 'width') {
      setImageWidth(value)
      if (imageLocked && value > 0) setImageHeight(Math.round(value / aspect))
    } else {
      setImageHeight(value)
      if (imageLocked && value > 0) setImageWidth(Math.round(value * aspect))
    }
    if (!imageLocked || imageRatio === 'smart') setImageRatio('custom')
    setImageResolution('custom')
  }

  const chooseVideoMode = (mode: 'omni_reference' | 'first_last_frame') => {
    if (mode === 'first_last_frame') {
      if (!videoCap.supportsFirstLast) return toast('当前模型不支持首尾帧模式', 'error')
      if (currentSlots.some((slot) => /\.(mp4|mov|webm|mkv)$/i.test(slot.name))) {
        return toast('参考视频不能与首尾帧混用，请先移除参考视频', 'error')
      }
      setSlots((current) => ({ ...current, video: (current.video || []).slice(0, 2) }))
    }
    setVideoMode(mode)
    if (mode === 'first_last_frame' && currentModelId.includes('seedance-2.5')) setVideoRatio('adaptive')
  }

  const chooseVideoResolution = (resolution: string) => {
    if (!videoCap.resolutions.includes(resolution)) {
      const candidate = allModels.find((model) => videoCapability(model.provider, model.modelId).resolutions.includes(resolution))
      if (!candidate) return toast(`暂无支持 ${resolution.toUpperCase()} 的视频模型，请联系管理员配置`, 'error')
      setSelectedModels((current) => ({ ...current, video: candidate.value }))
      toast(`已自动切换至支持 ${resolution.toUpperCase()} 的模型：${candidate.displayName}`, 'success')
    }
    setVideoResolution(resolution)
  }

  const chooseProductResolution = (resolution: string) => {
    if (!videoCap.resolutions.includes(resolution)) {
      const candidate = allModels.find((model) => videoCapability(model.provider, model.modelId).resolutions.includes(resolution))
      if (!candidate) return toast(`暂无支持 ${resolution.toUpperCase()} 的视频模型，请联系管理员配置`, 'error')
      setSelectedModels((current) => ({ ...current, product: candidate.value }))
      toast(`已自动切换至支持 ${resolution.toUpperCase()} 的模型：${candidate.displayName}`, 'success')
    }
    setProductResolution(resolution)
  }

  const primary = async () => {
    const prompt = prompts[toolId] || ''
    const promptOptional = isComparisonTool || toolId === 'image_erase'
    if (!promptOptional && prompt.trim().length < 2) {
      return toast('请填写创作提示词或需求描述', 'error')
    }
    if (isComparisonTool && !(currentSlots.length)) {
      return toast('请至少上传或选择 1 张参考原图后再提交', 'error')
    }
    if (isInpaint && !currentSlots.length) {
      return toast('请先上传原图，再打开涂抹画布并提交生成', 'error')
    }
    if (toolId === 'virtual_try_on' && currentSlots.length < 2) {
      return toast('请同时选择「人物参考图」与「目标服装图」后再提交生成', 'error')
    }
    if (toolId === 'apparel_set' && !currentSlots.length) {
      return toast('请至少上传 1 张「正面服装」参考图后再生成套图', 'error')
    }
    if (!currentModel) return toast('后台尚未配置适用于该能力的模型', 'error')
    if (estimated > availableCredits) {
      toast('可用积分不足，即将前往充值中心', 'error')
      return navigate('/credits')
    }
    setBusy(true)
    try {
      const data = await post<{ job: StudioJob; user: { credits: number } }>('/studio/jobs', {
        tool: toolId,
        toolName: currentTool.name,
        modelSource: currentModel.source === 'custom' ? 'custom' : 'platform',
        modelId: currentModel.source === 'custom' ? currentModel.value : currentModel.modelId,
        modelLabel: currentModel.displayName,
        prompt,
        count: counts[toolId] || 1,
        duration: toolId === 'video' ? videoDuration : toolId === 'product' ? 15 : 0,
        skillId: Number(skillId) || 0,
        params: {
          references: currentSlots.map((slot, index) => ({
            ...slot,
            role: studioReferenceRole(toolId, index, videoMode, slot.kind),
          })),
          ratio: toolId === 'image' ? imageRatio : toolId === 'video' ? videoRatio : toolId === 'product' ? productRatio : compareRatio,
          resolution: toolId === 'video' ? videoResolution : toolId === 'product' ? productResolution : imageResolution,
          width: toolId === 'image' ? imageWidth : undefined,
          height: toolId === 'image' ? imageHeight : undefined,
          videoMode: toolId === 'video' ? videoMode : undefined,
          audio: toolId === 'video' ? videoAudio : productAudio,
          copyMode: toolId === 'product' ? productCopyMode : undefined,
          printBackground: toolId === 'print_extract' ? printBackground : undefined,
          articleStyle,
          productId: products[0]?.id,
          storyboardGenerated: productStoryboard,
        },
      })
      await Promise.all([refreshUser(), loadData()])
      setNotice({
        title: `${data.job.toolName}任务已提交`,
        detail: `任务 #${data.job.id} 正在后台生成，完成后产物会自动存入个人资产库；${estimated > 0 ? `预冻结 ${estimated} 积分` : '使用自有模型 0 积分'}。`,
      })
      toast('任务已排队，可在顶部「任务」查看实时进度', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '创作任务提交失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const openSkillEditor = (skill?: Skill) => {
    setSkillEdit(skill || null)
    setSkillForm({ name: skill?.name || '', description: skill?.description || '', content: skill?.content || '' })
  }

  const saveSkill = async () => {
    if (!skillForm.name.trim() || !skillForm.content.trim()) return toast('技能名称与内容不能为空', 'error')
    try {
      if (skillEdit) await put(`/skills/${skillEdit.id}`, skillForm)
      else await post('/skills', skillForm)
      const fresh = await api<Skill[]>('/skills')
      setSkills(fresh)
      setSkillEdit(null)
      setSkillForm({ name: '', description: '', content: '' })
      toast('技能规范已保存', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '技能保存失败', 'error')
    }
  }

  const removeSkill = async (skill: Skill) => {
    if (skill.builtin) return toast('内置技能不可删除', 'error')
    if (!window.confirm(`删除技能「${skill.name}」？`)) return
    try {
      await del(`/skills/${skill.id}`)
      setSkills((current) => current.filter((item) => item.id !== skill.id))
      if (String(skill.id) === skillId) setSkillId('')
      toast('技能已删除')
    } catch (e) {
      toast(e instanceof Error ? e.message : '技能删除失败', 'error')
    }
  }

  function renderMentionMenu(field: 'image' | 'video') {
    if (!mentionMenu || mentionMenu.field !== field) return null
    const activeIndex = filteredMentionOptions.length ? Math.min(mentionMenu.activeIndex, filteredMentionOptions.length - 1) : 0
    return (
      <div ref={mentionMenuRef} className="studio-mention-menu" role="listbox" aria-label="选择 @参考主体">
        <div className="studio-mention-menu-head">
          <span>选择 @参考主体</span>
          <button type="button" onClick={() => setMentionMenu(null)}>
            关闭
          </button>
        </div>
        {filteredMentionOptions.length ? (
          filteredMentionOptions.map((item, index) => (
            <button
              key={item.token}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`studio-mention-item ${index === activeIndex ? 'active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMentionOption(item)}
            >
              <span className="studio-mention-thumb">
                {item.kind === 'video' ? (
                  <span className="studio-mention-play" aria-hidden="true">
                    ▶
                  </span>
                ) : (
                  <Artwork seed={item.seed} label="" sublabel="" url={item.url} kind="image" />
                )}
              </span>
              <span>
                <strong>{item.token}</strong>
                <small>
                  {item.name} · {item.detail}
                </small>
              </span>
            </button>
          ))
        ) : (
          <div className="studio-mention-empty">
            {mentionMenu.query.trim() ? '未找到匹配的参考图，请尝试 @图片1' : '暂无参考素材，请先上传或从资产库添加参考图。'}
          </div>
        )}
      </div>
    )
  }

  function renderReferenceUploader(kind: 'image' | 'video') {
    const isVideoTool = kind === 'video'
    const maxImages = isVideoTool ? videoCap.maxRefs : 4
    const maxVideos = isVideoTool ? videoCap.maxVideos : 0
    let imageNumber = 0
    let videoNumber = 0
    const labeledSlots = currentSlots.map((slot) => {
      if (isVideoUpload(slot)) {
        videoNumber += 1
        return { slot, label: `视频${videoNumber}` }
      }
      imageNumber += 1
      return { slot, label: `图片${imageNumber}` }
    })
    const openPicker = () => openAssetPicker(isVideoTool ? 'any' : 'image')
    const activeTab = !isVideoTool && referenceTab === 'video' ? 'all' : referenceTab
    const imageReferences = labeledSlots.filter(({ slot }) => !isVideoUpload(slot))
    const videoReferences = labeledSlots.filter(({ slot }) => isVideoUpload(slot))
    const visibleSlots =
      activeTab === 'image'
        ? imageReferences
        : activeTab === 'video'
          ? videoReferences
          : labeledSlots
    const tabOptions: Array<{ id: 'all' | 'image' | 'video'; label: string }> = [
      { id: 'all', label: `全部 (${currentSlots.length})` },
      { id: 'image', label: imageReferences.length ? `图片 (${imageReferences.length})` : '图片' },
      ...(isVideoTool ? [{ id: 'video' as const, label: videoReferences.length ? `视频 (${videoReferences.length})` : '视频' }] : []),
    ]
    const capacityLabel = isVideoTool
      ? `图片 ${imageReferences.length}/${maxImages}${maxVideos ? ` · 视频 ${videoReferences.length}/${maxVideos}` : ''}`
      : `图片 ${imageReferences.length}/${maxImages}`
    const canAdd = imageReferences.length < maxImages || (maxVideos > 0 && videoReferences.length < maxVideos)

    if (!currentSlots.length) {
      return (
        <button
          type="button"
          className="studio-ref-empty-tile"
          onClick={openPicker}
          aria-label={isVideoTool ? '上传参考图片或视频' : '上传参考图片'}
        >
          <span className="studio-ref-empty-plus">
            <PlusIcon size={20} />
          </span>
          <strong>参考内容</strong>
        </button>
      )
    }

    return (
      <div className={`studio-ref-tray ${isVideoTool ? 'is-video' : ''} ${referenceTrayCollapsed ? 'is-collapsed' : ''}`}>
        <div className="studio-ref-toolbar">
          <div className="studio-ref-tabs" role="tablist" aria-label="参考内容分类">
            {tabOptions.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`studio-ref-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setReferenceTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="studio-ref-toolbar-actions">
            <button type="button" className="studio-ref-clear" onClick={clearCurrentReferences}>
              清空全部参考
            </button>
            <button
              type="button"
              className="studio-ref-collapse"
              aria-expanded={!referenceTrayCollapsed}
              aria-label={referenceTrayCollapsed ? '展开参考内容' : '收起参考内容'}
              title={referenceTrayCollapsed ? '展开参考内容' : '收起参考内容'}
              onClick={() => setReferenceTrayCollapsed((collapsed) => !collapsed)}
            >
              <CollapseIcon size={15} />
            </button>
          </div>
        </div>
        {!referenceTrayCollapsed ? (
          <div className="studio-ref-strip">
            {visibleSlots.map(({ slot, label }) => (
              <div className="studio-ref-tile" key={slot.id}>
                <button
                  type="button"
                  className="studio-ref-tile-preview"
                  onClick={() => setReferencePreview(slot)}
                  aria-label={`预览${label}`}
                >
                  {isVideoUpload(slot) ? (
                    <span className="studio-ref-video-preview">
                      {slot.url ? <video src={slot.url} muted playsInline preload="metadata" /> : <span>视频参考</span>}
                      <i aria-hidden="true">▶</i>
                    </span>
                  ) : (
                    <Artwork
                      seed={slot.seed}
                      label=""
                      sublabel={slot.name}
                      url={slot.url}
                      kind="image"
                    />
                  )}
                </button>
                <span className="studio-ref-tile-label">{label}</span>
                <div className="studio-ref-tile-actions">
                  <button type="button" onClick={() => setReferencePreview(slot)} aria-label={`预览${label}`} title="预览">
                    <EyeIcon size={12} />
                  </button>
                  <button type="button" onClick={() => removeSlot(slot.id)} aria-label={`移除${label}`} title="移除">
                    <CloseIcon size={12} />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="studio-ref-add-tile"
              onClick={openPicker}
              disabled={!canAdd}
              aria-label={canAdd ? `添加参考内容，${capacityLabel}` : `参考内容已达上限，${capacityLabel}`}
              title={canAdd ? `${capacityLabel}，从资产库选择或上传新文件` : `${capacityLabel}，参考内容已达上限`}
            >
              <PlusIcon size={18} />
              <span>参考内容</span>
              {!canAdd ? <small>已达上限</small> : null}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  function renderUploadSlots(columns3 = false, customLabels?: string[]) {
    const labels = customLabels || ['参考原图']
    return (
      <div className="param-section">
        <div className="param-section-head">
          <span>{labels.length > 1 ? '上传所需参考图' : '上传参考原图'}</span>
          <small>
            {currentSlots.length}/{labels.length > 1 ? labels.length : 4} 已选
          </small>
        </div>
        <div className={`param-slot-grid ${columns3 ? 'cols-3' : ''}`}>
          {currentSlots.map((slot, index) => (
            <div className="param-slot-card" key={slot.id}>
              <div className="tool-slot-head">
                <span>{labels[index] || `参考图 ${index + 1}`}</span>
                <small className="required">必选</small>
              </div>
              <div className="param-slot-preview" style={{ cursor: 'pointer' }} onClick={() => openAssetPicker('image')} title="点击更换参考图">
                <Artwork seed={slot.seed} label={labels[index] || `参考图 ${index + 1}`} sublabel={slot.name} url={slot.url} kind={slot.kind} />
                <CloseButton onClick={() => removeSlot(slot.id)} label={`移除${labels[index] || '参考图'}`} />
              </div>
              <span className="param-slot-name" title={slot.name}>
                {slot.name}
              </span>
            </div>
          ))}
          {currentSlots.length < (labels.length > 1 ? labels.length : 4) ? (
            <div className="param-slot-card">
              <div className="tool-slot-head">
                <span>{labels[currentSlots.length] || `参考图 ${currentSlots.length + 1}`}</span>
                <small className={currentSlots.length === 0 ? 'required' : ''}>{currentSlots.length === 0 ? '必选' : '选填'}</small>
              </div>
              <button type="button" className="param-slot-add" onClick={() => openAssetPicker('image')}>
                <PlusIcon size={16} />
                <span>选择</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  function renderRightForm() {
    if (toolId === 'image') {
      const resolutionOptions = currentModel?.source === 'custom' ? ['1K', '1.5K', '2K', '4K'] : ['1.5K', '2K', '4K']
      return (
        <>
          <div className="param-section">
            <div className="param-section-head">
              <span>选择比例</span>
              <small>
                {imageRatio === 'smart' ? '智能匹配' : imageRatio} · {imageWidth}×{imageHeight}
              </small>
            </div>
            <div className="param-ratio-grid" role="group" aria-label="图片比例">
              {RATIOS.map((ratio) => (
                <button key={ratio} type="button" className={`param-ratio-btn ${imageRatio === ratio ? 'active' : ''}`} onClick={() => chooseImageRatio(ratio)}>
                  {ratioIcon(ratio)}
                  <span>{ratio === 'smart' ? '智能' : ratio}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="param-section">
            <div className="param-section-head">
              <span>选择分辨率</span>
              <small>{imageResolution === 'custom' ? '自定义' : imageResolution}</small>
            </div>
            <div className="param-seg-row" role="group" aria-label="图片分辨率">
              {resolutionOptions.map((res) => {
                const disabledReason = imageResolutionDisabledReason(res, currentProvider, currentModelId)
                return (
                  <button
                    key={res}
                    type="button"
                    className={`param-seg-btn ${imageResolution === res ? 'active' : ''}`}
                    title={disabledReason || undefined}
                    disabled={Boolean(disabledReason)}
                    onClick={() => chooseImageResolution(res)}
                  >
                    {res}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="param-section">
            <div className="param-section-head">
              <span>尺寸像素 (W × H)</span>
              <small>{imageLocked ? '比例已锁定' : '自由宽高'}</small>
            </div>
            <div className="param-dim-grid">
              <label className="param-dim-box">
                <span>W</span>
                <input
                  type="number"
                  min={64}
                  max={16384}
                  step={16}
                  value={imageWidth}
                  onChange={(event) => changeImageDimension('width', Number(event.target.value))}
                  aria-label="图片宽度"
                />
              </label>
              <button type="button" className={`param-dim-lock ${imageLocked ? 'locked' : ''}`} onClick={() => setImageLocked((locked) => !locked)} aria-label="锁定图片比例">
                <LockIcon size={14} />
              </button>
              <label className="param-dim-box">
                <span>H</span>
                <input
                  type="number"
                  min={64}
                  max={16384}
                  step={16}
                  value={imageHeight}
                  onChange={(event) => changeImageDimension('height', Number(event.target.value))}
                  aria-label="图片高度"
                />
              </label>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>px</span>
            </div>
            <div className={`param-hint-line ${imageDimError ? 'error' : ''}`}>
              {imageDimError ||
                (imageRatio === 'smart'
                  ? currentSlots.length
                    ? '智能：跟随第 1 张参考图比例。'
                    : '智能：暂无参考图，默认 1:1。'
                  : '可直接微调宽高，校验通过模型像素上限。')}
            </div>
          </div>
          <div className="param-section">
            <div className="param-section-head">
              <span>生成数量</span>
              <small>当前最多 {imageMax} 张</small>
            </div>
            <div className="param-seg-row" role="group" aria-label="生成数量">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`param-seg-btn ${count === n ? 'active' : ''}`}
                  disabled={n > imageMax}
                  title={n > imageMax ? '超出当前模型单次出图或参考图预算上限' : undefined}
                  onClick={() => setCounts((current) => ({ ...current, image: n }))}
                >
                  {n} 张
                </button>
              ))}
            </div>
            <div className="param-hint-line">每张独立生成，按所选张数产生调用费用；当前参考图 {currentSlots.length}/4 张。</div>
          </div>
        </>
      )
    }
    if (toolId === 'video') {
      const videoReferenceCount = currentSlots.filter((slot) => !/\.(mp4|mov|webm|mkv)$/i.test(slot.name)).length
      const videoFileCount = currentSlots.length - videoReferenceCount
      const ratioLocked = videoMode === 'first_last_frame' && currentModelId.includes('seedance-2.5')
      const ratioLockedToAdaptive =
        (currentProvider === 'kling' && currentSlots.length > 0) ||
        (currentProvider === 'minimax' && videoMode === 'first_last_frame')
      const effectiveRatios = ratioLockedToAdaptive ? ['adaptive'] : orderedVideoRatios
      return (
        <>
          <div className="param-section">
            <div className="param-section-head">
              <span>创作参考模式</span>
            </div>
            <div className="param-mode-tabs" role="tablist" aria-label="视频创作模式">
              <button
                type="button"
                role="tab"
                aria-selected={videoMode === 'omni_reference'}
                className={`param-mode-tab ${videoMode === 'omni_reference' ? 'active' : ''}`}
                onClick={() => chooseVideoMode('omni_reference')}
              >
                <strong>{videoCap.firstLabel}</strong>
                <small>
                  最多 {videoCap.maxRefs} 张图{videoCap.maxVideos ? ` · ${videoCap.maxVideos} 个视频` : ''}
                </small>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={videoMode === 'first_last_frame'}
                className={`param-mode-tab ${videoMode === 'first_last_frame' ? 'active' : ''}`}
                disabled={!videoCap.supportsFirstLast || videoFileCount > 0}
                onClick={() => chooseVideoMode('first_last_frame')}
              >
                <strong>首尾帧</strong>
                <small>{videoFileCount > 0 ? '请先移除参考视频' : '锁定起始与结束画面'}</small>
              </button>
            </div>
          </div>
          <div className="param-section">
            <div className="param-section-head">
              <span>视频比例与分辨率</span>
              <small>
                {videoRatio === 'adaptive' ? '自适应' : videoRatio} · {videoResolution}
              </small>
            </div>
            <div className="param-ratio-grid cols-6" role="group" aria-label="视频画面比例">
              {effectiveRatios.map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  className={`param-ratio-btn ${ratio === 'adaptive' ? 'is-adaptive' : ''} ${videoRatio === ratio ? 'active' : ''}`}
                  disabled={ratioLocked}
                  onClick={() => setVideoRatio(ratio)}
                >
                  {ratioIcon(ratio)}
                  <span>{ratio === 'adaptive' ? '自适应' : ratio}</span>
                  {ratio === 'adaptive' ? <small>跟随参考画面比例</small> : null}
                </button>
              ))}
            </div>
            <div className="param-seg-row" role="group" aria-label="视频分辨率">
              {VIDEO_RESOLUTIONS.map((res) => {
                const supported = videoCap.resolutions.includes(res)
                return (
                  <button
                    key={res}
                    type="button"
                    className={`param-seg-btn has-price ${videoResolution === res ? 'active' : ''}`}
                    onClick={() => chooseVideoResolution(res)}
                    title={supported ? `${res} 每秒消耗 ${modelResolutionCredits(currentModel, res)} 积分` : `点击后自动切换至支持 ${res.toUpperCase()} 的视频模型`}
                  >
                    <span>{res}</span>
                    <small>{supported ? `${modelResolutionCredits(currentModel, res)} 积分/秒` : '自动切换模型'}</small>
                  </button>
                )
              })}
            </div>
            {ratioLocked ? <div className="param-hint-line">当前首尾帧模式下，画面比例自动跟随首帧图片。</div> : null}
          </div>
          <div className="param-section">
            <div className="param-section-head">
              <span>视频时长</span>
              <small>按秒计费 · 当前 {videoDuration}s</small>
            </div>
            <div className="param-seg-row" style={{ gridAutoFlow: 'row', gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
              {videoCap.durations.map((sec) => (
                <button key={sec} type="button" className={`param-seg-btn ${videoDuration === sec ? 'active' : ''}`} onClick={() => setVideoDuration(sec)}>
                  {sec}s
                </button>
              ))}
            </div>
          </div>
          <div className="param-section">
            <div className="param-section-head">
              <span>音频生成</span>
              <small>{videoCap.audioChoices.length < 2 ? '当前模型固定模式' : '支持开关'}</small>
            </div>
            <button
              type="button"
              className={`param-audio-btn ${videoAudio ? 'active' : ''}`}
              disabled={videoCap.audioChoices.length < 2}
              onClick={() => setVideoAudio((value) => !value)}
            >
              <span>{videoAudio ? '生成同步音频（环境音 / 台词）' : '静音画面输出'}</span>
            </button>
          </div>
          {SHOW_SKILLS ? <div className="param-section">
            <div className="param-section-head">
              <span>调用 @技能规范 (.md)</span>
              <button type="button" className="text-button" onClick={() => setSkillsOpen(true)}>
                管理/导入
              </button>
            </div>
            <Select className="select" value={skillId} onChange={(event) => setSkillId(event.target.value)}>
              <option value="">不使用技能（仅按提示词与参考主体）</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  /@{skill.name}（{skill.builtin ? '内置' : '个人'}）
                </option>
              ))}
            </Select>
            {/* <div className="param-hint-line">仅作为生成提示参考，不执行文件中的命令、脚本或网络访问。</div> */}
          </div> : null}
          {videoCap.note ? <div className="param-hint-line">{videoCap.note}</div> : null}
          <div className="param-hint-line">
            当前参考图 {videoReferenceCount}/{videoCap.maxRefs} 张
            {videoCap.maxVideos ? ` · 参考视频 ${videoFileCount}/${videoCap.maxVideos} 个` : ''}
          </div>
        </>
      )
    }
    if (toolId === 'product') {
      return (
        <>
          <div className="param-section">
            <div className="param-section-head">
              <span>视频画幅</span>
              <small>15 秒 · {productRatio}</small>
            </div>
            <div className="param-ratio-grid cols-6">
              {['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'].map((ratio) => (
                <button key={ratio} type="button" className={`param-ratio-btn ${productRatio === ratio ? 'active' : ''}`} onClick={() => setProductRatio(ratio)}>
                  {ratioIcon(ratio)}
                  <span>{ratio}</span>
                </button>
              ))}
            </div>
          </div>
          {!productStoryboard ? (
            <>
              <div className="param-section">
                <div className="param-section-head">
                  <span>文案与声音偏好</span>
                </div>
                <Select
                  className="select"
                  value={productCopyMode}
                  onChange={(event) => {
                    setProductCopyMode(event.target.value)
                    setProductAudio(['voiceover', 'both'].includes(event.target.value))
                  }}
                >
                  <option value="none">纯画面（保留产品原有标识）</option>
                  <option value="text">包含画面卖点字幕</option>
                  <option value="voiceover">口播旁白</option>
                  <option value="both">画面文字 + 口播旁白</option>
                </Select>
              </div>
              <div className="param-section">
                <div className="param-section-head">
                  <span>快速从商品库导入参考图</span>
                </div>
                <Select
                  className="select"
                  value={productImportValue}
                  onChange={(event) => {
                    const product = products.find((item) => String(item.id) === event.target.value)
                    if (!product || currentSlots.length >= 4) return
                    setSlots((current) => ({
                      ...current,
                      product: [
                        ...(current.product || []),
                        {
                          id: `product-${product.id}-${Date.now()}`,
                          name: `${product.name}主图.png`,
                          seed: product.seed,
                          url: product.images[0]?.url,
                          kind: 'image',
                        },
                      ],
                    }))
                    setProductImportValue('')
                  }}
                >
                  <option value="">点击选择商品库素材填入...</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
                <div className="param-hint-line">
                  时长未明确时默认按 15 秒（5 镜 × 3 秒）规划；生成分镜后可逐镜微调并可选生成单镜分镜图。
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="param-section">
                <div className="param-section-head">
                  <span>视频分辨率</span>
                  <small>{productResolution}</small>
                </div>
                <div className="param-seg-row">
                  {VIDEO_RESOLUTIONS.map((res) => {
                    const supported = videoCap.resolutions.includes(res)
                    return (
                      <button
                        key={res}
                        type="button"
                        className={`param-seg-btn has-price ${productResolution === res ? 'active' : ''}`}
                        onClick={() => chooseProductResolution(res)}
                        title={supported ? `${res} 每秒消耗 ${modelResolutionCredits(currentModel, res)} 积分` : `点击后自动切换至支持 ${res.toUpperCase()} 的视频模型`}
                      >
                        <span>{res}</span>
                        <small>{supported ? `${modelResolutionCredits(currentModel, res)} 积分/秒` : '自动切换模型'}</small>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="param-section">
                <div className="param-section-head">
                  <span>音频与旁白</span>
                </div>
                <button type="button" className={`param-audio-btn ${productAudio ? 'active' : ''}`} onClick={() => setProductAudio((value) => !value)}>
                  <span>{productAudio ? '生成同步音频（含环境音/旁白）' : '纯画面静音输出'}</span>
                </button>
              </div>
              <div className="param-section" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 11, background: 'var(--bg-subtle)' }}>
                <strong style={{ fontSize: 12.5, color: 'var(--ink)' }}>分镜校验</strong>
                <div className={`param-hint-line ${productStoryboard ? '' : 'error'}`}>
                  {productStoryboard ? '分镜时间轴与转场校验已通过。' : '请先在中间区域生成 15 秒 5 镜分镜脚本。'}
                </div>
                <div className="help-text">使用 {currentSlots.length} 张产品参考图（上限 4 张）。</div>
              </div>
            </>
          )}
        </>
      )
    }
    if (toolId === 'article') {
      return (
        <>
          <div className="field">
            <span className="field-label">关联产品（自动植入卖点）</span>
            <Select className="select">
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <span className="field-label">排版风格</span>
            <Select className="select" value={articleStyle} onChange={(event) => setArticleStyle(event.target.value)}>
              <option value="fresh">Fresh 清新极简（内置默认）</option>
              <option value="editorial">Editorial 杂志刊物风</option>
            </Select>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => toast('已解析参考文档并注入写作上下文', 'success')}>
            导入参考文档 (.docx / .pdf / .md)
          </button>
        </>
      )
    }
    if (toolId === 'virtual_try_on') {
      return (
        <>
          {renderUploadSlots(false, ['人物参考图', '目标服装图'])}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <span className="field-label">画幅比例</span>
              <Select className="select">
                <option>3:4 竖版推荐</option>
                <option>1:1 方形</option>
              </Select>
            </div>
            <div className="field">
              <span className="field-label">出图张数</span>
              <Select className="select">
                <option>1 张试穿图</option>
              </Select>
            </div>
          </div>
          {currentSlots.length < 2 ? (
            <div className="dark-alert-box warn">
              <span>请同时选择「人物参考图」与「目标服装图」后再提交生成。</span>
            </div>
          ) : (
            <div className="param-hint-line">支持多图参考的模型会自动锁定服装细节；成图存入个人资产库。</div>
          )}
        </>
      )
    }
    if (toolId === 'apparel_set') {
      return (
        <>
          {renderUploadSlots(true, ['正面服装', '背面细节', '模特参考'])}
          <div className="field">
            <span className="field-label">套图输出张数</span>
            <Select className="select" value={count} onChange={(event) => setCounts((current) => ({ ...current, apparel_set: Number(event.target.value) }))}>
              <option value={6}>6 张电商标准套图</option>
              <option value={9}>9 张全套图</option>
            </Select>
          </div>
          {!currentSlots.length ? (
            <div className="dark-alert-box warn">
              <span>请至少上传或选择 1 张「正面服装」参考图后再生成套图。</span>
            </div>
          ) : (
            <div className="param-hint-line">正面服装为必选，配合背面与模特图可保持版型细节一致。</div>
          )}
        </>
      )
    }
    if (isComparisonTool) {
      const labels =
        toolId === 'image_variation'
          ? ['参考原图']
          : toolId === 'scene_variation'
            ? ['参考原图']
            : toolId === 'pose_variation'
              ? ['参考原图']
              : toolId === 'print_extract'
                ? ['服装图']
                : ['参考原图']
      return (
        <>
          {renderUploadSlots(false, labels)}
          {toolId === 'print_extract' ? (
            <>
              <div className="field">
                <span className="field-label">导出底色</span>
                <Select className="select" value={printBackground} onChange={(event) => setPrintBackground(event.target.value)}>
                  <option value="transparent">透明底 PNG</option>
                  <option value="white">纯白底 PNG</option>
                </Select>
              </div>
              <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 10, padding: 10, fontSize: 12, color: 'var(--warning)' }}>
                提示：印花提取输出为 AI 辅助整理稿，仅作设计打样参考。
              </div>
            </>
          ) : toolId === 'scene_variation' || toolId === 'pose_variation' ? (
            <div className="field">
              <span className="field-label">裂变数量（上限 4 组）</span>
              <Select className="select" value={count} onChange={(event) => setCounts((current) => ({ ...current, [toolId]: Number(event.target.value) }))}>
                <option value={2}>2 组</option>
                <option value={4}>4 组（上限）</option>
              </Select>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <span className="field-label">画幅比例</span>
                <Select className="select" value={compareRatio} onChange={(event) => setCompareRatio(event.target.value)}>
                  <option value="3:4">3:4 竖版</option>
                  <option value="1:1">1:1 方形</option>
                  <option value="16:9">16:9 横版</option>
                </Select>
              </div>
              <div className="field">
                <span className="field-label">出图张数</span>
                <Select className="select" value={count} onChange={(event) => setCounts((current) => ({ ...current, [toolId]: Number(event.target.value) }))}>
                  {[1, 2, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} 张
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
          {!currentSlots.length ? (
            <div className="dark-alert-box warn">
              <span>请至少添加 1 张参考原图再提交「{currentTool.name}」。</span>
            </div>
          ) : (
            <div className="param-hint-line">成图将自动上传对象存储并归档至个人资产库。</div>
          )}
        </>
      )
    }
    return (
      <div className="param-section" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 11, background: 'var(--bg-subtle)' }}>
        <strong style={{ fontSize: 12.5, color: 'var(--ink)' }}>涂抹遮罩导出规格</strong>
        <div className="param-hint-line">
          按原图比例输出 PNG 成图，并在完成后自动存入对象存储与个人资产库。
          {toolId === 'image_inpaint' ? '局部重绘需同时涂抹遮罩并填写修改要求。' : '涂抹后无需提示词即可自动填充消除杂物或水印。'}
        </div>
      </div>
    )
  }

  function renderStage() {
    if (toolId === 'image') {
      return (
        <section className="studio-composer-dark" aria-label="图片创作输入台">
          {currentSlots.length ? (
            <div className="composer-reference-dock">{renderReferenceUploader('image')}</div>
          ) : null}
          <div className="composer-input-flex">
            {!currentSlots.length ? (
              <div className="composer-ref-zone">{renderReferenceUploader('image')}</div>
            ) : null}
            <div className="composer-prompt-wrap">
              <textarea
                ref={promptTextareaRef}
                className="composer-textarea-dark"
                maxLength={4000}
                value={prompts.image || ''}
                onChange={(event) => handlePromptChange('image', event)}
                onKeyDown={handlePromptKeyDown}
                aria-label="图片画面描述"
                placeholder="描述主体、场景、构图、光线和画面风格。可上传参考图片，例如：参考图片1中的产品，制作自然光下的产品展示图，保持外观与配色一致。"
              />
              {currentSlots.length ? (
                <div className="composer-quick-row">
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>快捷引用：</span>
                  {currentSlots.map((slot, index) => (
                    <button key={slot.id} type="button" className="composer-tag-btn" onClick={() => setPrompt(`${prompts.image || ''} @图片${index + 1}`)}>
                      + 图片{index + 1}
                    </button>
                  ))}
                </div>
              ) : null}
              {renderMentionMenu('image')}
            </div>
          </div>
          <div className="composer-meta-footer">
            <span>支持 JPG、PNG、WebP，最多 4 张参考图（单张 &lt; 10 MB）；生成图片自动存对象存储并同步至个人资产库。</span>
            <span className="tabular">{(prompts.image || '').length} / 4000</span>
          </div>
        </section>
      )
    }

    if (toolId === 'video') {
      const imageReferences = currentSlots.filter((slot) => !/\.(mp4|mov|webm|mkv)$/i.test(slot.name))
      const videoReferences = currentSlots.filter((slot) => /\.(mp4|mov|webm|mkv)$/i.test(slot.name))
      const videoSeconds = videoReferences.length * 10
      const selectedSkill = skills.find((skill) => String(skill.id) === skillId)
      return (
        <section className="studio-composer-dark" aria-label="视频创作输入台">
          {videoMode === 'omni_reference' && currentSlots.length ? (
            <div className="composer-reference-dock">{renderReferenceUploader('video')}</div>
          ) : null}
          <div className="composer-input-flex">
            {videoMode === 'omni_reference' && !currentSlots.length ? (
              <div className="composer-ref-zone">{renderReferenceUploader('video')}</div>
            ) : null}
            {videoMode === 'omni_reference' ? null : (
              <div className="composer-ref-zone">
                <div className="frame-pair-wrap">
                  {currentSlots[0] ? (
                    <div className="ref-thumb-card" style={{ width: 86, height: 104 }}>
                    <Artwork seed={currentSlots[0].seed} label="首帧" sublabel={currentSlots[0].name} url={currentSlots[0].url} kind={currentSlots[0].kind} />
                      <span className="ref-thumb-label">首帧</span>
                      <CloseButton onClick={() => removeSlot(currentSlots[0].id)} label="移除首帧" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ref-add-tile"
                      style={{ width: 86, height: 104 }}
                      onClick={() => openAssetPicker('image')}
                    >
                      <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
                      <span>首帧</span>
                      <small>必选</small>
                    </button>
                  )}
                  <span className="frame-pair-arrow" aria-hidden="true">
                    →
                  </span>
                  {currentSlots[1] ? (
                    <div className="ref-thumb-card" style={{ width: 86, height: 104 }}>
                      <Artwork seed={currentSlots[1].seed} label="尾帧" sublabel={currentSlots[1].name} url={currentSlots[1].url} kind={currentSlots[1].kind} />
                      <span className="ref-thumb-label">尾帧</span>
                      <CloseButton onClick={() => removeSlot(currentSlots[1].id)} label="移除尾帧" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ref-add-tile"
                      style={{ width: 86, height: 104 }}
                      onClick={() => openAssetPicker('image')}
                    >
                      <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
                      <span>尾帧</span>
                      <small>必选</small>
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="composer-prompt-wrap">
              {SHOW_SKILLS && selectedSkill ? (
                <div className="composer-skill-chip">
                  <span>/{selectedSkill.name}</span>
                  <button type="button" aria-label="移除技能" onClick={() => setSkillId('')}>
                    ×
                  </button>
                </div>
              ) : null}
              <textarea
                ref={promptTextareaRef}
                className="composer-textarea-dark"
                maxLength={12000}
                value={prompts.video || ''}
                onChange={(event) => handlePromptChange('video', event)}
                onKeyDown={handlePromptKeyDown}
                aria-label="视频创作提示词"
                placeholder={
                  videoMode === 'omni_reference'
                    ? '描述主体、动作、镜头和声音；输入 @ 选择参考主体。例如：@图片1 中的产品在晨光厨房里缓慢旋转。'
                    : '描述首帧到尾帧之间的动作和运镜；输入 @ 选择首帧或尾帧。'
                }
              />
              <div className="composer-quick-row">
                <button type="button" className="composer-tag-btn" onClick={() => setPrompt(`${prompts.video || ''} @图片1 `)}>
                  @ 插入主体
                </button>
                {SHOW_SKILLS ? (
                  <button type="button" className="composer-tag-btn" onClick={() => setSkillsOpen(true)}>
                    / 调用技能
                  </button>
                ) : null}
                {videoMode === 'omni_reference'
                  ? imageReferences.map((slot, index) => (
                      <button key={slot.id} type="button" className="composer-tag-btn" onClick={() => setPrompt(`${prompts.video || ''} @图片${index + 1} `)}>
                        @图片{index + 1}
                      </button>
                    ))
                  : null}
                {videoMode === 'omni_reference'
                  ? videoReferences.map((slot, index) => (
                      <button key={slot.id} type="button" className="composer-tag-btn" onClick={() => setPrompt(`${prompts.video || ''} @视频${index + 1} `)}>
                        @视频{index + 1}
                      </button>
                    ))
                  : null}
                {videoMode === 'first_last_frame' && currentSlots[0] ? (
                  <button type="button" className="composer-tag-btn" onClick={() => setPrompt(`${prompts.video || ''} @首帧 `)}>
                    @首帧
                  </button>
                ) : null}
                {videoMode === 'first_last_frame' && currentSlots[1] ? (
                  <button type="button" className="composer-tag-btn" onClick={() => setPrompt(`${prompts.video || ''} @尾帧 `)}>
                    @尾帧
                  </button>
                ) : null}
              </div>
              {renderMentionMenu('video')}
            </div>
          </div>
          <div className="composer-meta-footer">
            <span>
              {videoMode === 'omni_reference'
                ? `${videoReferences.length ? `已选 ${videoReferences.length} 个参考视频 · ${videoSeconds.toFixed(1)}s；` : ''}输入 @ 可引用视频；通过已配置 OSS / TOS / COS 临时签名链接供模型读取。`
                : '首尾帧模式下，需分别指定首帧与尾帧图片，提示词不少于 10 个字。'}
            </span>
            <span className="tabular">{(prompts.video || '').length} / 12000</span>
          </div>
          {videoMode === 'first_last_frame' && (!currentSlots[0] || !currentSlots[1]) ? (
            <div className="dark-alert-box warn">
              <span>首尾帧模式需要分别选择「首帧」与「尾帧」图片后才能提交生成（当前缺失{!currentSlots[0] ? '首帧' : '尾帧'}）。</span>
            </div>
          ) : null}
        </section>
      )
    }

    if (toolId === 'product') {
      if (!productStoryboard) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="pfilm-card">
              <div className="pfilm-card-head">
                <strong style={{ fontSize: 14.5, color: 'var(--ink)' }}>产品参考图</strong>
                <span className="stage-ai-tag tabular">默认 15 秒 · {currentSlots.length} / 4 张</span>
              </div>
              <div className="pfilm-ref-grid">
                {currentSlots.map((slot, index) => (
                  <div style={{ position: 'relative' }} key={slot.id}>
                    <button type="button" className="pfilm-thumb" aria-label={`查看 ${slot.name}`}>
                      <Artwork seed={slot.seed} label={`产品图 ${index + 1}`} sublabel={slot.name} url={slot.url} kind={slot.kind} />
                    </button>
                    <CloseButton onClick={() => removeSlot(slot.id)} label={`移除 ${slot.name}`} />
                  </div>
                ))}
                {currentSlots.length < 4 ? (
                  <button type="button" className="pfilm-add-btn" onClick={() => openAssetPicker('image')}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
                    <span>添加图片</span>
                  </button>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>支持 1–4 张产品原图，单张小于 10 MB；点击缩略图可放大预览细节。</div>
            </section>
            <section className="pfilm-card">
              <div className="pfilm-card-head">
                <strong style={{ fontSize: 14.5, color: 'var(--ink)' }}>产品说明或创作要求</strong>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{(prompts.product || '').length} / 2000</span>
              </div>
              <textarea className="pfilm-dark-input" rows={4} maxLength={2000} value={prompts.product || ''} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：做一条 15 秒的短片，突出杯身纹理和开盖动作。" />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>时长未明确时按 15 秒规划。如需字幕、画面文字或旁白，请在这里注明。</span>
                <button type="button" className="dark-btn accent" onClick={generateProductStoryboard}>
                  生成分镜脚本
                </button>
              </div>
            </section>
          </div>
        )
      }
      return (
        <section className="pfilm-card">
          <div className="pfilm-card-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14.5, color: 'var(--ink)' }}>分镜脚本</strong>
              <span className="stage-ai-tag tabular">5 个镜头 · 15 秒 · {productRatio}</span>
            </div>
            <button type="button" className="dark-btn" onClick={() => setProductStoryboard(false)}>
              返回修改参考资料
            </button>
          </div>
          <div className="pfilm-ref-grid" style={{ alignItems: 'center' }}>
            {currentSlots.slice(0, 4).map((slot, index) => (
              <button type="button" className="pfilm-thumb" style={{ width: 58, height: 58 }} key={slot.id} title={slot.name}>
                <Artwork seed={slot.seed} label={`图${index + 1}`} sublabel="" url={slot.url} kind={slot.kind} />
              </button>
            ))}
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>已锁定 {currentSlots.length} 张产品原图；按纯画面设计，保留产品原有标识。</span>
          </div>
          <div className="field">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>创意概念</span>
            <textarea className="pfilm-dark-input" rows={2} maxLength={240} defaultValue="围绕产品核心使用瞬间打造 15 秒商业短片，前 3 秒建立感官钩子，随后多场景强化细节与品牌识别。" />
          </div>
          {[
            ['镜头 1', '0-3秒', '冰块慢动作落入透明杯，微距水花与玻璃水珠折射晨光'],
            ['镜头 2', '3-6秒', '冻干咖啡粉遇冰水瞬间溶化，深烘液体形成大理石纹理旋涡'],
            ['镜头 3', '6-9秒', '产品礼盒置于原木桌面，光影扫过品牌烫金标识'],
            ['镜头 4', '9-12秒', '都市女性手持产品自然饮用，生活方式场景建立代入'],
            ['镜头 5', '12-15秒', '产品组合矩阵与品牌收尾，留出标题安全区'],
          ].map(([index, time, scene], shotIndex) => (
            <details className="pfilm-shot" open={shotIndex === 0} key={index}>
              <summary>
                <span>
                  <strong>{index}</strong> <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 12 }}>{time} · 特写</span>
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>展开/折叠脚本</span>
              </summary>
              <div className="pfilm-shot-body">
                <textarea className="pfilm-dark-input" rows={5} defaultValue={`时间：${time}\n场景：商业场景 ${shotIndex + 1}\n主体：核心产品\n动作：${scene}\n景别：特写 / 中景\n运镜：缓慢推进\n画面文字：无\n旁白：无\n细节：保持品牌标识与材质纹理准确\n声音：自然环境音与轻节奏音乐`} />
                <div className="pfilm-frame-row">
                  <button type="button" className="dark-btn" onClick={() => toast('单镜分镜图已进入生成队列', 'success')}>
                    生成本镜分镜图（可选）
                  </button>
                  <div className="art-thumb" style={{ width: 66, height: 66, margin: 0, flexShrink: 0 }}>
                    <Artwork seed={shotIndex} label={`镜${shotIndex + 1}图`} sublabel="" />
                  </div>
                  <label className="pfilm-check">
                    <input type="checkbox" defaultChecked /> 用于视频参考
                  </label>
                </div>
              </div>
            </details>
          ))}
        </section>
      )
    }

    if (toolId === 'article') {
      return (
        <div className="wechat-phone-frame">
          <div className="wechat-phone-bar">
            <span>微信公众号 375px 手机实时预览</span>
            <span className="badge">{articleStyle === 'editorial' ? 'Editorial' : 'Fresh'}</span>
          </div>
          <div className="wechat-article-body">
            <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.35, color: 'var(--ink)' }}>
              3分钟做出咖啡店 38 元同款冷萃：夏日冰咖消费新趋势
            </div>
            <div className="art-thumb" style={{ marginBottom: 0 }}>
              <Artwork seed={4} label="正文配图 01" sublabel="AI 生成配图 · 存 OSS/TOS/COS" />
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.75, color: '#3F3F46' }}>
              炎夏午后无需去门店排队，只需冰水直冲 3 秒化开，即可呈现浓郁焦糖坚果风味，兼顾性价比与清爽体感。
            </p>
            <div style={{ paddingTop: 10, borderTop: '1px solid #E4E4E7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <Select className="select" style={{ height: 34, flex: 1, fontSize: 12 }}>
                <option>绑定公众号后推送草稿</option>
              </Select>
              <button type="button" className="btn btn-accent btn-sm" onClick={() => toast('请先在个人中心绑定公众号，再推送草稿', 'error')}>
                推送到草稿箱
              </button>
            </div>
          </div>
        </div>
      )
    }

    if (isInpaint) {
      const sourceSlot = currentSlots[0]
      const hasInpaintSource = Boolean(sourceSlot)
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ComparisonCard
            tool={toolId}
            index={comparisonIndex[toolId] || 0}
            onIndexChange={(index) => setComparisonIndex((current) => ({ ...current, [toolId]: index }))}
            onUse={() => useExample(toolId)}
          />
          <section className="inpaint-source-card">
            <div className="inpaint-source-head">
              <div>
                <strong>上传原图</strong>
                <span>先将待处理的原图上传或从个人资产库选择，之后才能打开涂抹画布。</span>
              </div>
              <small className={hasInpaintSource ? 'is-done' : 'required'}>{hasInpaintSource ? '已上传' : '必选'}</small>
            </div>
            {sourceSlot ? (
              <div className="inpaint-source-body">
                <button
                  type="button"
                  className="inpaint-source-thumb"
                  onClick={() => (sourceSlot.url ? setReferencePreview(sourceSlot) : openAssetPicker('image'))}
                  title="点击预览原图"
                >
                  <Artwork seed={sourceSlot.seed} label="" sublabel={sourceSlot.name} url={sourceSlot.url} kind={sourceSlot.kind} />
                </button>
                <div className="inpaint-source-meta">
                  <strong title={sourceSlot.name}>{sourceSlot.name}</strong>
                  <span>已作为涂抹画布底图，替换后画布内容会同步更新。</span>
                  <div className="inpaint-source-actions">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openAssetPicker('image')}>
                      更换原图
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => removeSlot(sourceSlot.id)}>
                      移除
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button type="button" className="inpaint-source-add" onClick={() => openAssetPicker('image')}>
                <span className="inpaint-source-add-icon">
                  <PlusIcon size={18} />
                </span>
                <strong>上传 / 选择原图</strong>
                <small>支持 JPG、PNG、WebP，单张 &lt; 10 MB</small>
              </button>
            )}
          </section>
          <section className="inpaint-entry">
            <span className="inpaint-entry-icon" aria-hidden="true">
              <SparkIcon size={20} />
            </span>
            <div className="inpaint-entry-copy">
              <strong>
                {toolId === 'image_erase' ? '局部消除涂抹画布' : '局部重绘涂抹画布'}
                {hasInpaintSource ? null : <em className="inpaint-entry-warn">需先上传原图</em>}
              </strong>
              <span>
                {hasInpaintSource
                  ? toolId === 'image_erase'
                    ? '在弹窗中涂抹水印、路人或杂物区域，由 AI 自动填充消除。'
                    : '在弹窗中涂抹需要替换的区域，再结合下方修改要求完成局部重绘。'
                  : '上传原图后按钮解锁，画布会在弹窗中以该图作为底图。'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-accent"
              disabled={!hasInpaintSource}
              title={hasInpaintSource ? '打开涂抹画布' : '请先上传原图'}
              onClick={() => {
                if (!hasInpaintSource) return toast('请先上传原图后再打开涂抹画布', 'error')
                setInpaintOpen(true)
              }}
            >
              {hasInpaintSource ? '打开涂抹画布' : '请先上传原图'}
            </button>
          </section>
          <section className="studio-composer-dark" aria-label="局部修改要求">
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-secondary)' }}>
              {toolId === 'image_inpaint' ? '局部重绘修改要求（必填）' : '局部消除补充说明（选填）'}
            </span>
            <textarea
              className="composer-textarea-dark"
              style={{ minHeight: 76 }}
              maxLength={1000}
              value={prompts[toolId] || (toolId === 'image_inpaint' ? '将涂抹区域替换为自然柔和木纹背景，保留主体边缘光影。' : '')}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={toolId === 'image_inpaint' ? '描述涂抹区域需要替换成什么内容' : '可补充需要消除的杂物类型或边缘处理要求'}
            />
          </section>
          <Modal
            open={inpaintOpen}
            title={toolId === 'image_erase' ? '局部消除涂抹画布' : '局部重绘涂抹画布'}
            className="inpaint-modal"
            onClose={() => setInpaintOpen(false)}
            footer={
              <>
                <span className="help-text" style={{ marginRight: 'auto' }}>
                  关闭画布后可继续填写修改要求
                </span>
                <button type="button" className="btn btn-outline" onClick={() => setInpaintOpen(false)}>
                  取消
                </button>
                <button type="button" className="btn btn-accent" onClick={() => setInpaintOpen(false)}>
                  完成涂抹
                </button>
              </>
            }
          >
            <InpaintCanvas erase={toolId === 'image_erase'} src={sourceSlot?.url} />
          </Modal>
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ComparisonCard
          tool={toolId}
          index={comparisonIndex[toolId] || 0}
          onIndexChange={(index) => setComparisonIndex((current) => ({ ...current, [toolId]: index }))}
          onUse={() => useExample(toolId)}
        />
      </div>
    )
  }

  return (
    <section id="view-studio" className="view-section active" aria-label="AI 创作工坊">
      <div className="page-head">
        <div>
          <h1 className="page-title">AI 创作工坊</h1>
          <p className="page-sub">集合内容创作、POD 电商素材与 AI 修图共 13 项能力；右侧自由切换平台积分接口或自有大模型。</p>
        </div>
        {SHOW_SKILLS ? <div className="page-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setSkillsOpen(true)}>
            管理 @技能库 ({skills.length})
          </button>
        </div> : null}
      </div>

      <div className="studio-grid">
        <aside className="studio-tools-panel" aria-label="13项创作工具目录">
          {[
            ['base', '基础内容创作'],
            ['pod', 'POD 电商素材'],
            ['retouch', 'AI 商业修图'],
          ].map(([group, groupName]) => (
            <div key={group}>
              <div className="tool-group-title">
                <span>{groupName}</span>
                <span className="tabular">{STUDIO_TOOLS.filter((tool) => tool.group === group).length}</span>
              </div>
              <div>
                {STUDIO_TOOLS.filter((tool) => tool.group === group).map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className={`tool-btn ${toolId === tool.id ? 'active' : ''}`}
                    onClick={() => {
                      setToolId(tool.id)
                      setInpaintOpen(false)
                      setNotice(null)
                      if (!prompts[tool.id] && DEFAULT_PROMPTS[tool.id]) setPrompts((current) => ({ ...current, [tool.id]: DEFAULT_PROMPTS[tool.id] }))
                    }}
                    title={tool.desc}
                  >
                    <span>{tool.name}</span>
                    <span className="tool-btn-tag">{tool.tag}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <div className="studio-stage">
          <div className="stage-header">
            <div className="stage-title-row">
              <strong style={{ fontSize: 16 }}>{currentTool.name}</strong>
              <span className="stage-ai-tag">AI 生成 · {currentTool.desc}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="dark-btn" onClick={openTasks}>
                查看任务进度
              </button>
              <button type="button" className="dark-btn" onClick={() => navigate('/library', { state: { tab: 'assets' } })}>
                个人资产库 →
              </button>
            </div>
          </div>
          {notice ? (
            <aside className="studio-submission-notice" role="status" aria-live="polite">
              <div className="studio-submission-notice-icon" aria-hidden="true">
                <CheckIcon size={20} />
              </div>
              <div className="studio-submission-notice-body">
                <strong>{notice.title}</strong>
                <p>{notice.detail}</p>
                <div className="studio-submission-notice-links">
                  <button type="button" className="btn btn-sm btn-accent" onClick={() => navigate('/library', { state: { tab: 'assets' } })}>
                    前往个人资产库 →
                  </button>
                  <button type="button" className="btn btn-sm btn-outline" onClick={openTasks}>
                    查看任务进度
                  </button>
                </div>
              </div>
              <button type="button" className="studio-submission-notice-close" aria-label="关闭创作提示" onClick={() => setNotice(null)}>
                ×
              </button>
            </aside>
          ) : null}
          {renderStage()}
        </div>

        <aside className="studio-params-panel" aria-label={paramsTitle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 14.5 }}>{paramsTitle}</strong>
            <span className="badge badge-accent tabular">{displayEstimated > 0 ? `预计 ${displayEstimated} 积分` : '0 积分（自有）'}</span>
          </div>
          <div className="field">
            <span className="field-label">{modelFieldLabel}</span>
            <Select className="select" value={modelValue} onChange={(event) => setSelectedModels((current) => ({ ...current, [toolId]: event.target.value }))}>
              {catalog.platform.filter((model) => model.capability === capability).length ? (
                <optgroup label="轨道 A · 平台统一接口（按共用积分池扣费）">
                  {catalog.platform
                    .filter((model) => model.capability === capability)
                    .map((model) => (
                      <option key={model.value} value={model.value}>
                        平台接口 · {model.providerName} {model.displayName}（{model.credits} 积分/{model.unit}）
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {catalog.custom.filter((model) => model.capability === capability).length ? (
                <optgroup label="轨道 B · 我的自定义大模型（0 积分直连）">
                  {catalog.custom
                    .filter((model) => model.capability === capability)
                    .map((model) => (
                      <option key={model.value} value={model.value}>
                        自有接口 (0 积分) · {model.providerName}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </Select>
            <span className="help-text">
              {currentModel?.source === 'custom'
                ? '当前使用个人绑定密钥直连模型，不消耗平台积分。'
                : toolId === 'product' && !productStoryboard
                  ? '生成结构化分镜脚本约 4 积分（成片按实际秒数另计）。'
                  : `轨道 A 平台接口 · 单价 ${unitCredits} 积分/${currentModel?.unit || '次'}${
                      toolId === 'image'
                        ? ` × ${count} 张`
                        : toolId === 'video'
                          ? ` × ${videoDuration}s`
                          : toolId === 'product'
                            ? ` × 15s`
                            : ''
                    }`}
            </span>
          </div>

          {renderRightForm()}

          {!isComparisonTool && !isInpaint && toolId !== 'video' && toolId !== 'image' ? null : null}

          {isComparisonTool || isInpaint ? (
            <div className="field">
              <span className="field-label">
                {toolId === 'virtual_try_on'
                  ? 'AI 穿衣提示词（选填）'
                  : toolId === 'apparel_set'
                    ? '创作提示词 / 套图要求（选填）'
                    : '创作提示词 / 需求描述（选填）'}
              </span>
              <textarea
                className="textarea"
                style={{ minHeight: 82 }}
                maxLength={2000}
                value={prompts[toolId] || ''}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  toolId === 'virtual_try_on'
                    ? '补充试穿姿态、背景光影或穿搭风格要求（选填）...'
                    : toolId === 'apparel_set'
                      ? '描述套图拍摄场景、季节调性与重点细节镜头（选填）...'
                      : '说明精修方向，如去除高光反光、强化金属质感、商业棚拍打光等（选填）...'
                }
              />
            </div>
          ) : null}

          {SHOW_SKILLS && toolId !== 'image' && toolId !== 'video' ? (
            <div className="field">
              <span className="field-label">
                <span>调用 @技能规范 (.md)</span>
                <button type="button" className="text-button" onClick={() => setSkillsOpen(true)}>
                  新建/编辑
                </button>
              </span>
              <Select className="select" value={skillId} onChange={(event) => setSkillId(event.target.value)}>
                <option value="">不追加个人技能（自动使用对应内置规范）</option>
                {skills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    /@{skill.name}（{skill.builtin ? '内置' : '个人'}）
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <button
            type="button"
            className="btn btn-accent btn-lg"
            style={{ width: '100%', marginTop: 4 }}
            onClick={toolId === 'product' && !productStoryboard ? generateProductStoryboard : primary}
            disabled={busy}
            title={toolId === 'product' && !productStoryboard ? '生成分镜脚本' : '提交生成'}
          >
            {busy ? '正在提交…' : primaryLabel}
          </button>
        </aside>
      </div>

      <Modal
        open={pickerOpen}
        title="选择参考内容"
        wide
        className="asset-picker-modal"
        onClose={closeAssetPicker}
        footer={
          <>
            <span className="asset-picker-selection-count">
              {pickerMultiSelect
                ? `已选 ${pickerSelectedIds.length} · 还可添加 ${pickerRemaining} 个`
                : pickerRemaining
                  ? `还可添加 ${pickerRemaining} 个`
                  : '已达到添加上限'}
            </span>
            <button type="button" className="btn btn-outline" onClick={closeAssetPicker}>
              取消
            </button>
            {pickerMultiSelect ? (
              <button
                type="button"
                className="btn btn-accent"
                onClick={addSelectedPickerAssets}
                disabled={!pickerSelectedIds.length}
              >
                添加所选{pickerSelectedIds.length ? ` (${pickerSelectedIds.length})` : ''}
              </button>
            ) : null}
          </>
        }
      >
        <div className="asset-picker-toolbar">
          {pickerMode === 'any' ? (
            <div className="asset-picker-tabs" role="tablist" aria-label="参考内容类型">
              {pickerTabOptions.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={pickerMediaTab === tab.id}
                  className={`asset-picker-tab ${pickerMediaTab === tab.id ? 'active' : ''}`}
                  onClick={() => setPickerMediaTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="asset-picker-kicker">个人资产库</div>
          )}
          <button
            type="button"
            className="asset-picker-clear"
            onClick={clearCurrentReferences}
            disabled={!currentSlots.length}
          >
            清空全部参考
          </button>
        </div>
        <div className="asset-picker-note">
          {pickerMode === 'any'
            ? '图片与视频可混合多选；视频参考会通过对象存储临时签名链接提供给模型。'
            : '从个人资产库多选，或直接上传新文件转存至统一对象存储。'}
        </div>
        <div className="grid-4 asset-picker-grid">
          {filteredAssets.map((asset) => {
            const assetId = String(asset.id)
            const alreadyAdded = currentSlots.some((slot) => slot.id === assetId)
            const selectedIndex = pickerSelectedIds.indexOf(assetId)
            const assetIsVideo = asset.kind === 'video'
            const assetRemaining = assetIsVideo ? pickerVideoRemaining : pickerImageRemaining
            const assetSelectedCount = assetIsVideo ? pickerSelectedVideoCount : pickerSelectedImageCount
            const selectionBlocked =
              pickerMultiSelect &&
              selectedIndex < 0 &&
              !alreadyAdded &&
              assetSelectedCount >= assetRemaining
            return (
              <button
                type="button"
                className={`aligned-card asset-picker-card${selectedIndex >= 0 ? ' is-selected' : ''}${alreadyAdded ? ' is-added' : ''}`}
                key={asset.id}
                aria-pressed={pickerMultiSelect ? selectedIndex >= 0 : undefined}
                aria-label={`${asset.name}，${asset.kind.toUpperCase()}，${asset.size}${alreadyAdded ? '，已添加' : selectedIndex >= 0 ? `，已选择，顺序 ${selectedIndex + 1}` : ''}`}
                disabled={alreadyAdded || assetRemaining <= 0 || selectionBlocked}
                style={{ textAlign: 'left' }}
                onClick={() => {
                  if (pickerMultiSelect) {
                    setPickerSelectedIds((current) =>
                      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
                    )
                    return
                  }
                  addSlot(assetToUploadSlot(asset))
                  closeAssetPicker()
                }}
              >
                <span className="asset-picker-select-dot" aria-hidden="true">
                  {alreadyAdded ? '已添加' : selectedIndex >= 0 ? selectedIndex + 1 : '+'}
                </span>
                <div className="art-thumb">
                  <Artwork
                    seed={asset.seed}
                    label={asset.name}
                    sublabel={`${asset.source} · ${asset.size}`}
                    url={asset.url}
                    kind={asset.kind}
                  />
                </div>
                <div className="card-body-flex">
                  <strong style={{ fontSize: 13, wordBreak: 'break-all' }}>{asset.name}</strong>
                  <span className="help-text">{asset.kind.toUpperCase()} · {asset.size}</span>
                </div>
              </button>
            )
          })}
          <label className={`asset-picker-upload-tile ${pickerRemaining > 0 ? '' : 'is-disabled'}`}>
            <input
              type="file"
              className="file-input-hidden"
              accept={pickerMode === 'image' ? 'image/*' : pickerMode === 'video' ? 'video/*' : 'image/*,video/*'}
              disabled={pickerRemaining <= 0}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadFile(file)
              }}
            />
            <span className="asset-picker-upload-plus">
              <PlusIcon size={20} />
            </span>
            <span>上传新文件</span>
          </label>
        </div>
        {!filteredAssets.length && pickerRemaining <= 0 ? (
          <div className="asset-picker-empty-note">当前类型已达到添加上限。</div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(referencePreview)}
        title="参考内容预览"
        wide
        className="reference-preview-modal"
        onClose={() => setReferencePreview(null)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setReferencePreview(null)}>
              关闭
            </button>
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => {
                const target = referencePreview
                setReferencePreview(null)
                if (target) removeSlot(target.id)
              }}
            >
              移除该参考
            </button>
          </>
        }
      >
        {referencePreview ? (
          <>
            <div className="reference-preview-stage">
              <Artwork
                seed={referencePreview.seed}
                label=""
                sublabel={referencePreview.name}
                url={referencePreview.url}
                kind={isVideoUpload(referencePreview) ? 'video' : 'image'}
                fit="contain"
              />
            </div>
            <div className="reference-preview-meta">
              <strong>{referencePreview.name}</strong>
              <span>{isVideoUpload(referencePreview) ? '参考视频' : '参考图片'}</span>
            </div>
          </>
        ) : null}
      </Modal>

      {SHOW_SKILLS ? (
        <Modal
          open={skillsOpen}
          title="管理个人 @技能库"
          wide
          onClose={() => setSkillsOpen(false)}
          footer={
            <>
              <button type="button" className="btn btn-outline" onClick={() => setSkillsOpen(false)}>
                关闭
              </button>
              <button type="button" className="btn btn-accent" onClick={() => openSkillEditor()}>
                + 新建个人技能
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {skills.map((skill) => (
              <div className="card" key={skill.id} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>/{skill.name}</strong>
                    <span className={`badge ${skill.builtin ? '' : 'badge-accent'}`}>{skill.builtin ? '内置' : '个人'}</span>
                  </div>
                  <div className="help-text">{skill.description}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {!skill.builtin ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openSkillEditor(skill)}>
                      编辑
                    </button>
                  ) : null}
                  {!skill.builtin ? (
                    <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => removeSkill(skill)}>
                      删除
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {skillEdit || skillForm.name ? (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong>{skillEdit ? `编辑 /${skillEdit.name}` : '新建个人技能'}</strong>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => {
                  setSkillEdit(null)
                  setSkillForm({ name: '', description: '', content: '' })
                }}>
                  取消
                </button>
              </div>
              <div className="field">
                <span className="field-label">技能名称</span>
                <input className="input" value={skillForm.name} onChange={(event) => setSkillForm((current) => ({ ...current, name: event.target.value }))} placeholder="如：xiaohongshu-hook" />
              </div>
              <div className="field">
                <span className="field-label">简介</span>
                <input className="input" value={skillForm.description} onChange={(event) => setSkillForm((current) => ({ ...current, description: event.target.value }))} placeholder="技能用途说明" />
              </div>
              <div className="field">
                <span className="field-label">Markdown 内容</span>
                <textarea className="textarea" value={skillForm.content} onChange={(event) => setSkillForm((current) => ({ ...current, content: event.target.value }))} placeholder="# 技能规范..." />
              </div>
              <button type="button" className="btn btn-accent" onClick={saveSkill}>
                保存技能规范
              </button>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </section>
  )
}
