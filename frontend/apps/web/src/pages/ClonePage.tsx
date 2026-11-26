import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, del, post, put } from '../api'
import { useApp } from '../AppContext'
import { Artwork } from '../Artwork'
import { EmptyState, Modal } from '../components'
import { Select } from '../Select'
import { socialMetricsLine } from '../socialMetrics'
import type { CollectionItem, CloneDraft, ModelCatalog, ModelOption, Product } from '../types'

type CloneMode = 'video' | 'photo'
type Scene = {
  index: number
  time: string
  title: string
  description: string
  prompt: string
  seconds: number
  voice: string
}

type AnalyzeResult = {
  title: string
  platform: string
  mode: CloneMode
  scenes: Scene[]
  copywriting: string[]
  modelNote: string
}

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  tiktok: 'TikTok',
}

function guessPlatform(url: string) {
  const value = url.toLowerCase()
  if (value.includes('xiaohongshu') || value.includes('xhslink')) return 'xiaohongshu'
  if (value.includes('tiktok')) return 'tiktok'
  return 'douyin'
}

function modelLabel(model: ModelOption) {
  if (model.source === 'custom') return `自有接口 · ${model.displayName}（0 积分）`
  return `${model.providerName} ${model.displayName}（${model.credits} 积分/${model.unit}）`
}

export default function ClonePage() {
  const { toast, refreshUser, user } = useApp()
  const location = useLocation()
  const incoming = (location.state || {}) as { sourceUrl?: string; sourceItemId?: number; mode?: CloneMode; prompt?: string }

  const [mode, setMode] = useState<CloneMode>(incoming.mode === 'photo' ? 'photo' : 'video')
  const [step, setStep] = useState(1)
  const [sourceUrl, setSourceUrl] = useState(incoming.sourceUrl || '')
  const [selectedItemId, setSelectedItemId] = useState<number | null>(incoming.sourceItemId ?? null)
  const [items, setItems] = useState<CollectionItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState<number | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog>({ platform: [], custom: [] })
  const [modelValue, setModelValue] = useState('')
  const [drafts, setDrafts] = useState<CloneDraft[]>([])
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [captionTitle, setCaptionTitle] = useState('')
  const [captionBody, setCaptionBody] = useState('')
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')

  const selectedItem = items.find((item) => item.id === selectedItemId) || null
  const selectedProduct = products.find((product) => product.id === productId) || products[0] || null
  const effectiveSourceUrl = sourceUrl.trim() || selectedItem?.url || selectedItem?.externalId || ''
  const capability = mode === 'video' ? 'video' : 'image'
  const candidates = useMemo(
    () => [...catalog.platform, ...catalog.custom].filter((model) => model.capability === capability),
    [catalog, capability],
  )
  const selectedModel = candidates.find((model) => model.value === modelValue) || candidates[0]

  const load = useCallback(async () => {
    try {
      const [collected, productList, catalogData, draftList] = await Promise.all([
        api<CollectionItem[]>('/collection/items'),
        api<Product[]>('/products'),
        api<ModelCatalog>('/models/catalog'),
        api<CloneDraft[]>('/clone/drafts'),
      ])
      setItems(collected)
      setProducts(productList)
      setCatalog(catalogData)
      setDrafts(draftList)
      if (!incoming.sourceItemId && !sourceUrl && collected[0]) {
        setSelectedItemId(collected[0].id)
      }
      if (!productList.some((row) => row.id === productId)) setProductId(productList[0]?.id ?? null)
      if (incoming.sourceItemId && !sourceUrl) {
        const item = collected.find((row) => row.id === incoming.sourceItemId)
        if (item) {
          setSourceUrl(item.url || item.externalId || `collect://${item.id}`)
          setStep(2)
        }
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '复刻数据加载失败', 'error')
    }
  }, [incoming.sourceItemId, productId, sourceUrl, toast])

  useEffect(() => {
    void load()
    // Load each module only once on entry. Selection is preserved locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!candidates.length) {
      setModelValue('')
      return
    }
    if (!candidates.some((model) => model.value === modelValue)) {
      setModelValue(candidates[0].value)
    }
  }, [candidates, modelValue])

  const sourceTitle = selectedItem?.title || (effectiveSourceUrl ? '已粘贴的爆款链接' : '尚未选择原爆款')
  const platform = selectedItem?.platform || guessPlatform(effectiveSourceUrl)

  const analyze = async () => {
    if (!effectiveSourceUrl) {
      toast('请先粘贴爆款链接或从采集库选用作品', 'error')
      return
    }
    setAnalyzing(true)
    try {
      const data = await post<AnalyzeResult>('/clone/analyze', {
        sourceUrl: effectiveSourceUrl,
        platform,
        mode,
        title: selectedItem?.title || '',
        summary: selectedItem?.description || '',
        product: selectedProduct?.name || '',
      })
      const normalized = data.scenes.map((scene, index) => ({
        ...scene,
        index: index + 1,
        seconds: mode === 'video' ? Math.max(1, Math.round(15 / Math.max(1, data.scenes.length))) : 3,
        voice: data.copywriting[index] || '',
      }))
      setScenes(normalized)
      setAnalysis(data)
      setCaptionTitle(
        data.copywriting[0] ||
          (selectedProduct ? `${selectedProduct.name}｜实测好物分享` : '这组图文，重新定义夏日高级感'),
      )
      setCaptionBody(
        data.copywriting.join('\n\n') ||
          `围绕「${selectedProduct?.name || sourceTitle}」生成的高完成度图文复刻文案，保留原内容节奏并植入目标商品卖点。`,
      )
      setDraftTitle(`${selectedProduct?.name || sourceTitle} · ${mode === 'video' ? '视频' : '图文'}复刻`)
      setStep(3)
      await refreshUser()
      toast('原爆款结构解析完成，请确认分镜与文案', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '解析失败', 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  const saveDraft = async () => {
    try {
      const row = await post<CloneDraft>('/clone/drafts', {
        title: draftTitle || `${selectedProduct?.name || sourceTitle} · 复刻草稿`,
        sourceUrl: effectiveSourceUrl,
        platform,
        status: 'draft',
        seed: (scenes.length || 1) % 6,
      })
      setDrafts((current) => [row, ...current])
      toast('已保存至复刻草稿箱', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '草稿保存失败', 'error')
    }
  }

  const removeDraft = async (draft: CloneDraft) => {
    if (!window.confirm(`删除草稿「${draft.title}」？`)) return
    try {
      await del(`/clone/drafts/${draft.id}`)
      setDrafts((current) => current.filter((row) => row.id !== draft.id))
      toast('草稿已删除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '草稿删除失败', 'error')
    }
  }

  const loadDraft = (draft: CloneDraft) => {
    setSourceUrl(draft.sourceUrl || '')
    setSelectedItemId(null)
    setDraftTitle(draft.title)
    setMode(draft.platform === 'xiaohongshu' ? 'photo' : mode)
    setDraftsOpen(false)
    setStep(2)
    toast('草稿已载入，请确认模型后继续解析')
  }

  const renameDraft = async (draft: CloneDraft) => {
    const title = window.prompt('修改草稿标题', draft.title)
    if (!title?.trim()) return
    try {
      const row = await put<CloneDraft>(`/clone/drafts/${draft.id}`, {
        title: title.trim(),
        sourceUrl: draft.sourceUrl,
        platform: draft.platform,
        status: draft.status,
        seed: draft.seed,
      })
      setDrafts((current) => current.map((item) => (item.id === row.id ? row : item)))
      toast('草稿标题已更新', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '草稿更新失败', 'error')
    }
  }

  const render = async () => {
    if (!selectedModel) {
      toast('后台尚未配置可用的生成模型，请联系管理员', 'error')
      return
    }
    setRendering(true)
    try {
      const data = await post<{ job: { id: number }; user: { credits: number } }>('/clone/render', {
        title: draftTitle || `${selectedProduct?.name || sourceTitle} · 复刻成片`,
        platform,
        mode,
        modelSource: selectedModel.source === 'custom' ? 'custom' : 'platform',
        modelId: selectedModel.source === 'custom' ? selectedModel.value : selectedModel.modelId,
        modelLabel: selectedModel.displayName,
        prompt:
          mode === 'video'
            ? scenes.map((scene) => `镜${scene.index} ${scene.description}：${scene.prompt}`).join('\n')
            : `${captionTitle}\n${captionBody}`,
        duration: scenes.reduce((sum, scene) => sum + Math.max(1, scene.seconds), 0),
        count: mode === 'video' ? 1 : 4,
        params: {
          sourceUrl: effectiveSourceUrl,
          productId: selectedProduct?.id,
          scenes,
          captionTitle,
          captionBody,
        },
      })
      await refreshUser()
      toast(`复刻任务 #${data.job.id} 已提交，完成后产物自动归档到个人资产库`, 'success')
      setPreviewOpen(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : '提交复刻失败', 'error')
    } finally {
      setRendering(false)
    }
  }

  return (
    <section id="view-clone" className="view-section active" aria-label="爆款复刻工作台">
      <div className="page-head">
        <div>
          <h1 className="page-title">爆款复刻工作台</h1>
          <p className="page-sub">
            极简 3 步复刻爆款；自由选用后台已配置的全部 10 类云端模型（无字幕烧录，由服务器 FFmpeg 无损合成）。
          </p>
        </div>
        <div className="page-actions">
          <div className="tabs-bar">
            <button type="button" className={`tab-btn ${mode === 'video' ? 'active' : ''}`} onClick={() => setMode('video')}>
              视频复刻
            </button>
            <button type="button" className={`tab-btn ${mode === 'photo' ? 'active' : ''}`} onClick={() => setMode('photo')}>
              图文复刻
            </button>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraftsOpen(true)}>
            草稿箱（{drafts.length}）
          </button>
        </div>
      </div>

      <div className="stepper">
        {[
          ['选爆款或贴链接', '从个人采集库选取或直接粘贴链接'],
          ['选商品与云端模型', '全云端多供应商自由选择与路径适配'],
          ['分镜脚本确认与生成', mode === 'video' ? '支持分镜微调、九宫格审核与存草稿' : '支持图文重算文案与存草稿'],
        ].map(([title, hint], index) => {
          const number = index + 1
          return (
            <button key={title} type="button" className={`step-card ${step === number ? 'active' : ''}`} onClick={() => setStep(number)}>
              <span className="step-num">{number}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{title}</div>
                <div className="help-text">{hint}</div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {step === 1 ? (
          <>
            <div className="field">
              <span className="field-label">方式 A · 直接粘贴爆款分享链接</span>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 260 }}
                  value={sourceUrl}
                  onChange={(event) => {
                    setSourceUrl(event.target.value)
                    setSelectedItemId(null)
                  }}
                  placeholder="粘贴抖音 / 小红书 / TikTok 分享链接，自动拉取原素材解析"
                />
                <button type="button" className="btn btn-primary" onClick={() => setStep(2)} disabled={!sourceUrl.trim()}>
                  解析链接并进入下一步
                </button>
              </div>
            </div>

            <div className="field">
              <span className="field-label">方式 B · 从您的个人采集库选择（共 {items.length} 条）</span>
              {items.length ? (
                <div className="grid-4">
                  {items.slice(0, 8).map((item) => {
                    const selected = item.id === selectedItemId
                    const author = item.author || PLATFORM_LABELS[item.platform] || item.platform
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`aligned-card clone-source-card ${selected ? 'selected' : ''}`}
                        onClick={() => {
                          if (selected) {
                            setStep(2)
                            return
                          }
                          setSelectedItemId(item.id)
                          setSourceUrl('')
                        }}
                      >
                        <div className="card-body-flex" style={{ gap: 9 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                            <span className="badge">{author.startsWith('@') ? author : `@${author}`}</span>
                            <span className="badge badge-accent tabular">热度 {item.heat}</span>
                          </div>
                          <strong style={{ fontSize: 13.5, lineHeight: 1.45, minHeight: 40 }}>{item.title}</strong>
                        </div>
                        <div className="clone-source-footer">
                          <span className="social-metrics-line tabular" style={{ margin: 0 }}>
                            {socialMetricsLine(item.metrics, 'engagement')}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                            {selected ? '已选中 · 下一步' : '选用并继续 →'}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <EmptyState>采集库还没有作品。可先到「采集中心」按关键词抓取，也可以直接粘贴链接继续复刻。</EmptyState>
              )}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="grid-2">
              <div className="field">
                <span className="field-label">1. 选择要植入的自有商品</span>
                <Select className="select" value={productId ?? ''} onChange={(event) => setProductId(Number(event.target.value) || null)}>
                  <option value="">不绑定商品，只复刻内容结构</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
                <span className="help-text">
                  {selectedProduct ? selectedProduct.description || `${selectedProduct.images.length} 张商品参考图` : '未绑定商品时将以原爆款主体为参考。'}
                </span>
              </div>
              <div className="field">
                <span className="field-label">2. 自由选择云端生成模型</span>
                <Select className="select" value={selectedModel?.value || ''} onChange={(event) => setModelValue(event.target.value)}>
                  {candidates.length ? null : <option value="">暂无可用的 {mode === 'video' ? '视频' : '图片'} 模型</option>}
                  {candidates.map((model) => (
                    <option key={model.value} value={model.value}>
                      {modelLabel(model)}
                    </option>
                  ))}
                </Select>
                <span className="help-text">
                  平台接口消耗共用积分池，自有模型接口 0 积分。当前可用余额 {user?.credits ?? 0} 积分。
                </span>
              </div>
            </div>

            <div
              style={{
                background: mode === 'video' && !selectedModel?.supportsVideoRef ? 'var(--warning-bg)' : 'var(--success-bg)',
                border: `1px solid ${mode === 'video' && !selectedModel?.supportsVideoRef ? 'var(--warning-border)' : 'var(--success-border)'}`,
                borderRadius: 12,
                padding: '12px 14px',
                fontSize: 13,
                color: mode === 'video' && !selectedModel?.supportsVideoRef ? 'var(--warning)' : 'var(--success)',
              }}
            >
              {mode === 'video'
                ? selectedModel?.supportsVideoRef
                  ? '当前模型支持视频参考，可直接参考原视频节奏生成，也可先生成分镜首帧审核；系统不做字幕烧录。'
                  : '当前模型不支持原视频直接参考，系统将自动使用「关键帧拆解 → 分镜首帧审核 → 图生视频无字幕合成」路径。'
                : '图文复刻会保留原帖的视觉节奏与内容结构，自动植入目标商品并重新生成标题、正文和配图。'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
              <div className="card" style={{ padding: 14 }}>
                <div className="help-text">原爆款</div>
                <strong style={{ display: 'block', marginTop: 4 }}>{sourceTitle}</strong>
                <div className="help-text" style={{ marginTop: 4 }}>
                  {PLATFORM_LABELS[platform] || platform}
                </div>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="help-text">植入商品</div>
                <strong style={{ display: 'block', marginTop: 4 }}>{selectedProduct?.name || '不绑定商品'}</strong>
                <div className="help-text" style={{ marginTop: 4 }}>
                  {selectedProduct?.images.length || 0} 张参考图
                </div>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="help-text">预计消耗</div>
                <strong className="tabular" style={{ display: 'block', marginTop: 4 }}>
                  {selectedModel?.source === 'custom' ? '0 积分' : `${(selectedModel?.credits || 0) * (mode === 'video' ? 15 : 4)} 积分`}
                </strong>
                <div className="help-text" style={{ marginTop: 4 }}>
                  {selectedModel?.unit || '按次'}计费
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setStep(1)}>
                上一步
              </button>
              <button type="button" className="btn btn-accent" onClick={analyze} disabled={analyzing}>
                {analyzing ? '正在拆解原爆款…' : '下一步：拆解并确认脚本'}
              </button>
            </div>
          </>
        ) : null}

        {step === 3 && mode === 'video' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>原视频拆解分镜脚本（可直接改词 / 调时长）</div>
                <div className="help-text">
                  来源：{sourceTitle} · 商品：{selectedProduct?.name || '未绑定'} · {analysis?.modelNote}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={saveDraft}>
                  保存为草稿
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setPreviewOpen(true)}>
                  生成九宫格审核
                </button>
              </div>
            </div>

            <div className="field">
              <span className="field-label">草稿标题</span>
              <input className="input" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="用于资产归档与草稿箱展示" />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {scenes.length ? (
                scenes.map((scene, index) => (
                  <div
                    key={scene.index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '52px 74px minmax(0,1fr) minmax(0,1fr)',
                      gap: 10,
                      alignItems: 'center',
                      background: 'var(--bg)',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                    }}
                  >
                    <strong className="tabular">镜 {scene.index}</strong>
                    <input
                      className="input tabular"
                      type="number"
                      min={1}
                      max={10}
                      value={scene.seconds}
                      onChange={(event) =>
                        setScenes((current) =>
                          current.map((item, idx) => (idx === index ? { ...item, seconds: Number(event.target.value) } : item)),
                        )
                      }
                    />
                    <input
                      className="input"
                      value={scene.description}
                      onChange={(event) =>
                        setScenes((current) =>
                          current.map((item, idx) => (idx === index ? { ...item, description: event.target.value } : item)),
                        )
                      }
                      placeholder="画面描述"
                    />
                    <input
                      className="input"
                      value={scene.voice}
                      onChange={(event) =>
                        setScenes((current) => current.map((item, idx) => (idx === index ? { ...item, voice: event.target.value } : item)))
                      }
                      placeholder="口播文案"
                    />
                  </div>
                ))
              ) : (
                <EmptyState>请先返回上一步解析原爆款，或点击「重新解析」生成分镜脚本。</EmptyState>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 12, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-outline" onClick={() => setStep(2)}>
                  上一步改模型
                </button>
                <button type="button" className="btn btn-outline" onClick={analyze} disabled={analyzing}>
                  重新解析
                </button>
              </div>
              <button type="button" className="btn btn-accent btn-lg" onClick={() => void render()} disabled={rendering || !scenes.length}>
                {rendering ? '正在提交…' : '提交生成复刻视频'}
              </button>
            </div>
          </>
        ) : null}

        {step === 3 && mode === 'photo' ? (
          <>
            <div className="grid-2">
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 600, marginBottom: 10 }}>原图文重绘组图预览（已自动植入商品）</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="art-thumb square" style={{ margin: 0 }}>
                    <Artwork seed={selectedProduct?.seed || 0} label="复刻主图 01" sublabel={selectedProduct?.name || '内容主体'} />
                  </div>
                  <div className="art-thumb square" style={{ margin: 0 }}>
                    <Artwork seed={(selectedProduct?.seed || 0) + 2} label="场景细节 02" sublabel="AI 场景迁移" />
                  </div>
                </div>
              </div>
              <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong>爆款图文标题与正文</strong>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      if (!analysis) return
                      setCaptionTitle(analysis.copywriting[1] || analysis.copywriting[0] || captionTitle)
                      setCaptionBody(`${analysis.copywriting.join('。')}。这套文案已重新组合并补入 ${selectedProduct?.name || '商品'} 的核心卖点。`)
                      toast('已重新组合图文文案', 'success')
                    }}
                  >
                    重新生成文案
                  </button>
                </div>
                <input className="input" value={captionTitle} onChange={(event) => setCaptionTitle(event.target.value)} placeholder="标题" />
                <textarea className="textarea" style={{ minHeight: 130 }} value={captionBody} onChange={(event) => setCaptionBody(event.target.value)} placeholder="正文" />
              </div>
            </div>

            <div className="field">
              <span className="field-label">草稿标题</span>
              <input className="input" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-outline" onClick={() => setStep(2)}>
                  上一步改模型
                </button>
                <button type="button" className="btn btn-outline" onClick={saveDraft}>
                  保存图文草稿
                </button>
              </div>
              <button type="button" className="btn btn-accent btn-lg" onClick={() => void render()} disabled={rendering}>
                {rendering ? '正在提交…' : '提交生成图文成片'}
              </button>
            </div>
          </>
        ) : null}
      </div>

      <Modal
        open={draftsOpen}
        title="复刻草稿箱管理"
        onClose={() => setDraftsOpen(false)}
        footer={
          <button type="button" className="btn btn-outline" onClick={() => setDraftsOpen(false)}>
            关闭
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {drafts.length ? (
            drafts.map((draft) => (
              <div key={draft.id} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{draft.title}</strong>
                    <span className="badge">{draft.status === 'rendered' ? '已生成' : '草稿'}</span>
                  </div>
                  <div className="help-text">
                    {PLATFORM_LABELS[draft.platform] || draft.platform || '未标注平台'} · {new Date(draft.createdAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => loadDraft(draft)}>
                    读取继续
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => void renameDraft(draft)}>
                    改名
                  </button>
                  <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => void removeDraft(draft)}>
                    删除
                  </button>
                </div>
              </div>
            ))
          ) : (
            <EmptyState>暂无复刻草稿。</EmptyState>
          )}
        </div>
      </Modal>

      <Modal
        open={previewOpen}
        title="分镜九宫格生图审核"
        onClose={() => setPreviewOpen(false)}
        wide
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setPreviewOpen(false)}>
              返回微调
            </button>
            <button type="button" className="btn btn-accent" onClick={() => void render()} disabled={rendering}>
              {rendering ? '正在提交…' : '批准并合成视频'}
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
          {(scenes.length ? scenes : Array.from({ length: 6 }, (_, index) => ({ index }))).slice(0, 6).map((scene, index) => (
            <div key={(scene.index || index) + index} className="art-thumb square" style={{ margin: 0 }}>
              <Artwork seed={index} label={`分镜关键帧 #${index + 1}`} sublabel="首帧审核通过" />
            </div>
          ))}
        </div>
        <p className="help-text" style={{ margin: 0 }}>
          确认首帧视觉风格一致后，点击「批准并合成视频」进入图生视频阶段。系统不会烧录字幕。
        </p>
      </Modal>
    </section>
  )
}
