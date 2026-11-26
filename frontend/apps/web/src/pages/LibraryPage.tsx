import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, del, getToken, post, put } from '../api'
import { useApp } from '../AppContext'
import { Artwork } from '../Artwork'
import { ConfirmModal, EmptyState, Modal } from '../components'
import { EyeIcon, UploadIcon } from '../icons'
import { Select } from '../Select'
import type { Asset, Product, ProductImage, Workflow } from '../types'

type LibraryTab = 'assets' | 'products' | 'workflows'
type AssetFilter = 'all' | 'image' | 'video' | 'markdown'

const KIND_LABELS: Record<string, string> = {
  all: '全部类型',
  image: '图片',
  video: '视频',
  markdown: 'Markdown',
}

const SCHEDULE_OPTIONS = [
  { value: 'manual', label: '仅手动运行' },
  { value: 'daily', label: '每天 09:00' },
  { value: 'weekly', label: '每周一 09:00' },
  { value: 'hourly', label: '每 6 小时' },
]

function ymd(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function relativeTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.round(diffHours / 24)
  return `${diffDays} 天前`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function productToRequest(product: Product) {
  return {
    name: product.name,
    description: product.description,
    seed: product.seed,
    images: product.images.map((image) => ({ name: image.name, url: image.url || '', seed: image.seed })),
  }
}

export default function LibraryPage() {
  const { toast, refreshUser } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const initialTab = ((location.state as { tab?: LibraryTab } | null)?.tab || 'assets') as LibraryTab
  const [tab, setTab] = useState<LibraryTab>(initialTab)
  const [assets, setAssets] = useState<Asset[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [filter, setFilter] = useState<AssetFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [assetDetail, setAssetDetail] = useState<Asset | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const [productOpen, setProductOpen] = useState(false)
  const [productEdit, setProductEdit] = useState<Product | null>(null)
  const [productForm, setProductForm] = useState({ name: '', description: '', seed: 0 })
  const [productImages, setProductImages] = useState<ProductImage[]>([])
  const [productImageUrl, setProductImageUrl] = useState('')
  const productUploadRef = useRef<HTMLInputElement>(null)

  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [workflowEdit, setWorkflowEdit] = useState<Workflow | null>(null)
  const [workflowForm, setWorkflowForm] = useState({
    name: '',
    schedule: 'manual',
    enabled: true,
    estimatedCredits: 0,
    nodes: '["trigger","collect","generate","archive"]',
  })

  const [confirmDelete, setConfirmDelete] = useState<{ type: 'asset' | 'batch' | 'product' | 'workflow'; id?: number; label: string } | null>(null)

  const loadAssets = useCallback(async () => {
    const query = new URLSearchParams()
    if (filter !== 'all') query.set('kind', filter)
    if (search.trim()) query.set('q', search.trim())
    const data = await api<Asset[]>(`/assets?${query.toString()}`)
    setAssets(data)
    setSelected((current) => current.filter((id) => data.some((asset) => asset.id === id)))
  }, [filter, search])

  const loadAll = useCallback(async () => {
    try {
      const [productList, workflowList] = await Promise.all([api<Product[]>('/products'), api<Workflow[]>('/workflows')])
      setProducts(productList)
      setWorkflows(workflowList)
      await loadAssets()
    } catch (error) {
      toast(error instanceof Error ? error.message : '资产数据加载失败', 'error')
    }
  }, [loadAssets, toast])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    void loadAssets().catch((error) => toast(error instanceof Error ? error.message : '资产筛选失败', 'error'))
  }, [loadAssets, toast])

  const uploadAsset = async () => {
    if (!uploadFile) return toast('请选择需要上传的文件', 'error')
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', uploadFile)
      if (uploadName.trim()) form.append('name', uploadName.trim())
      const row = await api<Asset>('/assets/upload', { method: 'POST', body: form })
      setAssets((current) => [row, ...current])
      setUploadOpen(false)
      setUploadName('')
      setUploadFile(null)
      toast('素材已上传并转存云端对象存储', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '上传失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const chooseUploadFile = (file: File | null) => {
    setUploadFile(file)
    if (file && (!uploadName.trim() || uploadName === uploadFile?.name)) {
      setUploadName(file.name)
    }
  }

  const deleteAsset = async (id: number) => {
    try {
      await del(`/assets/${id}`)
      setAssets((current) => current.filter((asset) => asset.id !== id))
      setSelected((current) => current.filter((item) => item !== id))
      setAssetDetail(null)
      setConfirmDelete(null)
      toast('素材已删除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }

  const batchDelete = async () => {
    try {
      await post('/assets/batch-delete', { ids: selected })
      setAssets((current) => current.filter((asset) => !selected.includes(asset.id)))
      setSelected([])
      setConfirmDelete(null)
      toast('已批量删除所选素材')
    } catch (error) {
      toast(error instanceof Error ? error.message : '批量删除失败', 'error')
    }
  }

  const downloadZip = async () => {
    if (!selected.length) return toast('请先选择要打包的素材', 'error')
    try {
      const res = await fetch(`/api/v1/assets/zip?ids=${selected.join(',')}`, {
        headers: { Authorization: `Bearer ${getToken() || ''}` },
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.message || 'ZIP 打包失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `sparkstudio-assets-${Date.now()}.zip`
      anchor.click()
      URL.revokeObjectURL(url)
      toast('ZIP 已开始下载', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'ZIP 下载失败', 'error')
    }
  }

  const openProduct = (product?: Product) => {
    setProductEdit(product || null)
    setProductForm({
      name: product?.name || '',
      description: product?.description || '',
      seed: product?.seed || 0,
    })
    setProductImages(product?.images.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) || [])
    setProductOpen(true)
  }

  const addProductImageByUrl = () => {
    if (!productImageUrl.trim()) return
    setProductImages((current) => [
      ...current,
      { name: `参考图_${String(current.length + 1).padStart(2, '0')}.png`, url: productImageUrl.trim(), seed: current.length % 6 },
    ])
    setProductImageUrl('')
  }

  const uploadProductImages = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const uploaded: ProductImage[] = []
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        const row = await api<Asset>('/assets/upload', { method: 'POST', body: form })
        uploaded.push({ name: row.name, url: row.url, seed: row.seed })
      }
      setProductImages((current) => [...current, ...uploaded])
      toast(`已上传 ${uploaded.length} 张商品参考图`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '参考图上传失败', 'error')
    } finally {
      setBusy(false)
      if (productUploadRef.current) productUploadRef.current.value = ''
    }
  }

  const moveProductImage = (index: number, direction: -1 | 1) => {
    setProductImages((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = current.slice()
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return next
    })
  }

  const saveProduct = async () => {
    if (!productForm.name.trim()) return toast('商品名称不能为空', 'error')
    setBusy(true)
    try {
      const body = {
        ...productForm,
        name: productForm.name.trim(),
        images: productImages.map((image) => ({ name: image.name, url: image.url || '', seed: image.seed })),
      }
      const row = productEdit ? await put<Product>(`/products/${productEdit.id}`, body) : await post<Product>('/products', body)
      setProducts((current) => (productEdit ? current.map((item) => (item.id === row.id ? row : item)) : [row, ...current]))
      setProductOpen(false)
      toast(productEdit ? '商品已更新' : '商品已创建', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '商品保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeProduct = async (id: number) => {
    try {
      await del(`/products/${id}`)
      setProducts((current) => current.filter((item) => item.id !== id))
      setConfirmDelete(null)
      toast('商品已删除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '商品删除失败', 'error')
    }
  }

  const openWorkflow = (workflow?: Workflow) => {
    setWorkflowEdit(workflow || null)
    setWorkflowForm({
      name: workflow?.name || '',
      schedule: workflow?.schedule || 'manual',
      enabled: workflow?.enabled ?? true,
      estimatedCredits: workflow?.estimatedCredits || 0,
      nodes: workflow?.nodes || '["trigger","collect","generate","archive"]',
    })
    setWorkflowOpen(true)
  }

  const saveWorkflow = async () => {
    if (!workflowForm.name.trim()) return toast('流水线名称不能为空', 'error')
    let nodes: unknown
    try {
      nodes = JSON.parse(workflowForm.nodes || '[]')
    } catch {
      return toast('DAG 节点必须是合法的 JSON 数组', 'error')
    }
    setBusy(true)
    try {
      const body = { ...workflowForm, name: workflowForm.name.trim(), nodes }
      const row = workflowEdit ? await put<Workflow>(`/workflows/${workflowEdit.id}`, body) : await post<Workflow>('/workflows', body)
      setWorkflows((current) => (workflowEdit ? current.map((item) => (item.id === row.id ? row : item)) : [row, ...current]))
      setWorkflowOpen(false)
      toast(workflowEdit ? '流水线已更新' : '流水线已创建', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '流水线保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleWorkflow = async (workflow: Workflow) => {
    try {
      const row = await put<Workflow>(`/workflows/${workflow.id}`, { ...workflow, enabled: !workflow.enabled, nodes: workflow.nodes })
      setWorkflows((current) => current.map((item) => (item.id === row.id ? row : item)))
    } catch (error) {
      toast(error instanceof Error ? error.message : '流水线状态切换失败', 'error')
    }
  }

  const runWorkflow = async (workflow: Workflow) => {
    setBusy(true)
    try {
      const data = await post<{ job: { id: number }; user: { credits: number } }>(`/workflows/${workflow.id}/run`)
      await refreshUser()
      setWorkflows((current) =>
        current.map((item) =>
          item.id === workflow.id ? { ...item, lastRun: `${new Date().toLocaleString()} · 已提交，等待生成` } : item,
        ),
      )
      toast(`流水线已提交，任务 #${data.job.id} 完成后自动写入资产库`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '流水线运行失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeWorkflow = async (id: number) => {
    try {
      await del(`/workflows/${id}`)
      setWorkflows((current) => current.filter((item) => item.id !== id))
      setConfirmDelete(null)
      toast('流水线已删除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }

  const reuseAsset = (asset: Asset) => {
    const tool = asset.kind === 'video' ? 'video' : asset.kind === 'markdown' ? 'article' : 'image'
    navigate('/studio', {
      state: {
        tool,
        asset,
        prompt:
          asset.kind === 'video'
            ? `参考资产「${asset.name}」的节奏与主体，重新生成一条短视频。`
            : asset.kind === 'markdown'
              ? `参考资产「${asset.name}」的内容结构，重新创作一篇公众号长文。`
              : `参考资产「${asset.name}」的商品主体、构图与风格，再次创作一张商业图片。`,
      },
    })
  }

  return (
    <section id="view-library" className="view-section active" aria-label="个人资产商品与计划">
      <div className="page-head">
        <div>
          <h1 className="page-title">资产 · 商品 · 自动化计划</h1>
          <p className="page-sub">管理个人云端对象存储素材、多图商品资料及自动化流水线，支持完整增删改查。</p>
        </div>
        <div className="tabs-bar">
          {[
            ['assets', '个人资产库'],
            ['products', '我的商品库'],
            ['workflows', '自动化流水线'],
          ].map(([key, label]) => (
            <button key={key} type="button" className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key as LibraryTab)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'assets' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="chip-row" style={{ flex: 1 }}>
              {(['all', 'image', 'video', 'markdown'] as AssetFilter[]).map((kind) => (
                <button key={kind} type="button" className={`chip ${filter === kind ? 'active' : ''}`} onClick={() => setFilter(kind)}>
                  {KIND_LABELS[kind] === '全部类型' ? '全部' : KIND_LABELS[kind]}
                </button>
              ))}
              <input
                className="input"
                style={{ height: 34, maxWidth: 240, fontSize: 12.5 }}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索素材文件名..."
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void downloadZip()} disabled={!selected.length}>
                批量 ZIP 下载 ({selected.length})
              </button>
              <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setConfirmDelete({ type: 'batch', label: `所选 ${selected.length} 项素材` })} disabled={!selected.length}>
                批量删除
              </button>
              <button type="button" className="btn btn-accent btn-sm" onClick={() => setUploadOpen(true)}>
                + 上传素材至云存储
              </button>
            </div>
          </div>

          {assets.length ? (
            <div className="grid-5">
              {assets.map((asset) => {
                const checked = selected.includes(asset.id)
                const previewable = asset.kind === 'image' && Boolean(asset.url)
                return (
                  <article key={asset.id} className="aligned-card" style={{ borderColor: checked ? 'var(--accent)' : undefined, background: checked ? 'var(--accent-soft)' : undefined }}>
                    <div
                      className={`art-thumb${previewable ? ' is-previewable' : ''}`}
                      role={previewable ? 'button' : undefined}
                      tabIndex={previewable ? 0 : undefined}
                      aria-label={previewable ? `查看「${asset.name}」大图` : undefined}
                      onClick={previewable ? () => setAssetDetail(asset) : undefined}
                      onKeyDown={
                        previewable
                          ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setAssetDetail(asset)
                              }
                            }
                          : undefined
                      }
                    >
                      <Artwork seed={asset.seed} label={asset.name} sublabel={`${asset.source} · ${asset.size}`} url={asset.url} kind={asset.kind} fit="contain" />
                      <div className="thumb-overlay-top">
                        <span className="thumb-pill">{(asset.kind || 'file').toUpperCase()}</span>
                        <button
                          type="button"
                          className="thumb-pill"
                          style={{ pointerEvents: 'auto', cursor: 'pointer', background: checked ? '#DB2777' : 'rgba(9,9,11,0.72)' }}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelected((current) =>
                              checked ? current.filter((id) => id !== asset.id) : [...new Set([...current, asset.id])],
                            )
                          }}
                        >
                          {checked ? '已选' : '多选'}
                        </button>
                      </div>
                      {/* {previewable ? (
                        <span className="asset-thumb-hover-hint">
                          <EyeIcon size={14} />
                          点击查看
                        </span>
                      ) : null} */}
                    </div>
                    <div className="card-body-flex">
                      <strong style={{ fontSize: 14, lineHeight: 1.45, wordBreak: 'break-all' }}>{asset.name}</strong>
                      <div className="help-text">
                        {asset.source} · {asset.size} · {relativeTime(asset.createdAt)}
                      </div>
                    </div>
                    <div className="card-footer-stick">
                      <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setConfirmDelete({ type: 'asset', id: asset.id, label: asset.name })}>
                        删除
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => reuseAsset(asset)}>
                        再次创作
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <EmptyState>当前筛选下暂无素材。上传商品图或完成一次 AI 创作后，产物会自动归档到这里。</EmptyState>
          )}
        </>
      ) : null}

      {tab === 'products' ? (
        <>
          <div className="page-head">
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>我的商品资料库</h2>
              <p className="page-sub">支持商品多图上传、顺序调整和完整编辑，复刻与套图任务会优先使用这些参考图。</p>
            </div>
            <button type="button" className="btn btn-accent" onClick={() => openProduct()}>
              + 新增商品
            </button>
          </div>
          {products.length ? (
            <div className="grid-4">
              {products.map((product) => (
                <article key={product.id} className="aligned-card">
                  <div className="art-thumb" style={{ margin: 0 }}>
                    <Artwork seed={product.seed} label={product.name} sublabel={product.description || '商品资料'} url={product.images[0]?.url} fit="contain" />
                  </div>
                  <div className="card-body-flex">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ fontSize: 15 }}>{product.name}</strong>
                      <span className="badge tabular">{product.images.length} 图</span>
                    </div>
                    <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>{product.description || '暂无商品描述'}</p>
                  </div>
                  <div className="card-footer-stick">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openProduct(product)}>
                      编辑多图
                    </button>
                    <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setConfirmDelete({ type: 'product', id: product.id, label: product.name })}>
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>还没有商品资料。新建商品并上传多张参考图后，可用于复刻、POD 套图与 AI 穿衣。</EmptyState>
          )}
        </>
      ) : null}

      {tab === 'workflows' ? (
        <>
          <div className="page-head">
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>自动化流水线</h2>
              <p className="page-sub">用一句话描述计划，组合采集、生成与归档节点；任务运行前会按预估积分校验余额并留痕。</p>
            </div>
            <button type="button" className="btn btn-accent" onClick={() => openWorkflow()}>
              + 新建流水线
            </button>
          </div>
          {workflows.length ? (
            <div className="grid-2">
              {workflows.map((workflow) => {
                let nodes: string[] = []
                try {
                  nodes = JSON.parse(workflow.nodes)
                } catch {
                  nodes = [workflow.nodes]
                }
                return (
                  <article key={workflow.id} className="aligned-card">
                    <div className="card-body-flex">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <strong style={{ fontSize: 16 }}>{workflow.name}</strong>
                        <button
                          type="button"
                          className={`toggle-pill ${workflow.enabled ? 'on' : ''}`}
                          onClick={() => void toggleWorkflow(workflow)}
                          aria-label={`切换 ${workflow.name} 启停`}
                        />
                      </div>
                      <div className="chip-row">
                        <span className="badge">{SCHEDULE_OPTIONS.find((item) => item.value === workflow.schedule)?.label || workflow.schedule}</span>
                        <span className="badge tabular">预估 {workflow.estimatedCredits} 积分</span>
                        <span className={`badge ${workflow.enabled ? 'badge-success' : ''}`}>{workflow.enabled ? '已启用' : '已暂停'}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {nodes.map((node, index) => (
                          <span key={`${node}-${index}`} className="badge">
                            {index + 1}. {node}
                          </span>
                        ))}
                      </div>
                      <div className="help-text">上次运行：{workflow.lastRun || '尚未运行'}</div>
                    </div>
                    <div className="card-footer-stick">
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => openWorkflow(workflow)}>
                          编辑
                        </button>
                        <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setConfirmDelete({ type: 'workflow', id: workflow.id, label: workflow.name })}>
                          删除
                        </button>
                      </div>
                      <button type="button" className="btn btn-accent btn-sm" onClick={() => void runWorkflow(workflow)} disabled={busy || !workflow.enabled}>
                        立即试跑
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <EmptyState>暂无自动化计划。新建计划后可定时采集选品并批量生成素材。</EmptyState>
          )}
        </>
      ) : null}

      <Modal
        open={uploadOpen}
        title="上传素材到个人资产库"
        onClose={() => setUploadOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setUploadOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-accent" onClick={() => void uploadAsset()} disabled={busy || !uploadFile}>
              {busy ? '上传中…' : '上传'}
            </button>
          </>
        }
      >
        <div className="field">
          <span className="field-label">素材文件</span>
          <label
            className={`asset-upload-dropzone${uploadFile ? ' has-file' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              chooseUploadFile(event.dataTransfer.files?.[0] || null)
            }}
          >
            <input
              className="asset-upload-input"
              type="file"
              accept="image/*,video/*,.md,.txt"
              onClick={(event) => {
                event.currentTarget.value = ''
              }}
              onChange={(event) => chooseUploadFile(event.target.files?.[0] || null)}
            />
            <span className="asset-upload-icon" aria-hidden="true">
              <UploadIcon size={22} />
            </span>
            <span className="asset-upload-copy">
              <strong>{uploadFile ? uploadFile.name : '点击选择文件或拖拽到这里'}</strong>
              <small>
                {uploadFile
                  ? `${formatFileSize(uploadFile.size)} · 点击可重新选择`
                  : '图片 / 视频 / Markdown，单文件不超过 200MB'}
              </small>
            </span>
            <span className="asset-upload-action">{uploadFile ? '重新选择' : '浏览文件'}</span>
          </label>
        </div>
        <div className="field">
          <span className="field-label">资产显示名称</span>
          <input className="input" value={uploadName} onChange={(event) => setUploadName(event.target.value)} placeholder="例如：夏季防晒衣主图-01" />
        </div>
        <div className="help-text">文件会由后端写入已启用的 OSS / TOS / COS；未配置对象存储的开发环境会落到本地临时目录。</div>
      </Modal>

      <Modal wide className="asset-detail-modal" open={Boolean(assetDetail)} title="素材详情" onClose={() => setAssetDetail(null)} footer={
        assetDetail ? (
          <>
            <button type="button" className="btn btn-danger-outline" onClick={() => void deleteAsset(assetDetail.id)}>
              删除素材
            </button>
            {assetDetail.url ? (
              <a className="btn btn-accent" href={assetDetail.url} target="_blank" rel="noreferrer">
                打开原文件
              </a>
            ) : null}
          </>
        ) : null
      }>
        {assetDetail ? (
          <>
            <div className="art-thumb asset-detail-stage" style={{ margin: 0 }}>
              <Artwork seed={assetDetail.seed} label={assetDetail.name} sublabel={`${assetDetail.source} · ${assetDetail.size}`} url={assetDetail.url} kind={assetDetail.kind} fit="contain" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
              <div className="card" style={{ padding: 10 }}>
                <div className="help-text">类型</div>
                <strong>{KIND_LABELS[assetDetail.kind] || assetDetail.kind}</strong>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div className="help-text">来源</div>
                <strong>{assetDetail.source}</strong>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div className="help-text">生成时间</div>
                <strong>{ymd(assetDetail.createdAt)}</strong>
              </div>
            </div>
            <div className="help-text">关联任务：{assetDetail.jobId ? `#${assetDetail.jobId}` : '手动上传'} · 资产仅当前账号可见。</div>
          </>
        ) : null}
      </Modal>

      <Modal
        open={productOpen}
        title={productEdit ? '编辑商品资料' : '新增商品资料'}
        onClose={() => setProductOpen(false)}
        wide
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setProductOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-accent" onClick={() => void saveProduct()} disabled={busy}>
              {busy ? '保存中…' : '保存商品'}
            </button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field">
            <span className="field-label">商品名称</span>
            <input className="input" value={productForm.name} onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))} placeholder="如：冰感原纱防晒衣" />
          </div>
          <div className="field">
            <span className="field-label">展示风格种子（0–5）</span>
            <input className="input tabular" type="number" min={0} max={5} value={productForm.seed} onChange={(event) => setProductForm((current) => ({ ...current, seed: Number(event.target.value) }))} />
          </div>
        </div>
        <div className="field">
          <span className="field-label">商品描述与核心卖点</span>
          <textarea className="textarea" value={productForm.description} onChange={(event) => setProductForm((current) => ({ ...current, description: event.target.value }))} placeholder="版型、面料、使用场景与差异化卖点..." />
        </div>
        <div className="field">
          <span className="field-label">
            <span>商品参考图（最多 8 张，排序会影响生成优先级）</span>
            <button type="button" className="text-button" onClick={() => productUploadRef.current?.click()}>
              + 上传本地图片
            </button>
          </span>
          <input ref={productUploadRef} type="file" accept="image/*" multiple className="file-input-hidden" onChange={(event) => void uploadProductImages(event.target.files)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={productImageUrl} onChange={(event) => setProductImageUrl(event.target.value)} placeholder="也可粘贴图片 URL" />
            <button type="button" className="btn btn-outline" onClick={addProductImageByUrl}>
              添加 URL
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {productImages.length ? (
              productImages.map((image, index) => (
                <div key={`${image.url}-${index}`} style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: 8, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)' }}>
                  <div className="art-thumb square" style={{ margin: 0 }}>
                    <Artwork seed={image.seed} label="" sublabel="" url={image.url} fit="contain" />
                  </div>
                  <input
                    className="input"
                    value={image.name}
                    onChange={(event) =>
                      setProductImages((current) => current.map((row, idx) => (idx === index ? { ...row, name: event.target.value } : row)))
                    }
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => moveProductImage(index, -1)} disabled={index === 0}>
                      ↑
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => moveProductImage(index, 1)} disabled={index === productImages.length - 1}>
                      ↓
                    </button>
                    <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setProductImages((current) => current.filter((_, idx) => idx !== index))}>
                      删除
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState>尚未添加参考图。可上传本地图片或粘贴已转存到对象存储的图片 URL。</EmptyState>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={workflowOpen}
        title={workflowEdit ? '编辑自动化流水线' : '新建自动化流水线'}
        onClose={() => setWorkflowOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setWorkflowOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-accent" onClick={() => void saveWorkflow()} disabled={busy}>
              {busy ? '保存中…' : '保存流水线'}
            </button>
          </>
        }
      >
        <div className="field">
          <span className="field-label">流水线名称</span>
          <input className="input" value={workflowForm.name} onChange={(event) => setWorkflowForm((current) => ({ ...current, name: event.target.value }))} placeholder="如：每日防晒衣采集 + 场景套图生成" />
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">运行计划</span>
            <Select className="select" value={workflowForm.schedule} onChange={(event) => setWorkflowForm((current) => ({ ...current, schedule: event.target.value }))}>
              {SCHEDULE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <span className="field-label">单次预估积分</span>
            <input className="input tabular" type="number" min={0} value={workflowForm.estimatedCredits} onChange={(event) => setWorkflowForm((current) => ({ ...current, estimatedCredits: Number(event.target.value) }))} />
          </div>
        </div>
        <div className="field">
          <span className="field-label">DAG 节点（JSON 数组）</span>
          <textarea className="textarea" value={workflowForm.nodes} onChange={(event) => setWorkflowForm((current) => ({ ...current, nodes: event.target.value }))} />
          <span className="help-text">可用节点：trigger、collect、select-product、generate、archive。运行时会校验预估积分并生成异步任务。</span>
        </div>
        <div className="switch-row">
          <div>
            <strong>启用流水线</strong>
            <div className="help-text">暂停后不参与定时调度，也不能手动试跑</div>
          </div>
          <button type="button" className={`toggle-pill ${workflowForm.enabled ? 'on' : ''}`} onClick={() => setWorkflowForm((current) => ({ ...current, enabled: !current.enabled }))} aria-label="切换流水线启用" />
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(confirmDelete)}
        title="确认删除"
        description={
          confirmDelete?.type === 'batch'
            ? `将永久删除 ${confirmDelete.label}，此操作不可恢复。`
            : `将永久删除「${confirmDelete?.label || ''}」，此操作不可恢复。`
        }
        confirmText="确认删除"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return
          if (confirmDelete.type === 'asset' && confirmDelete.id) void deleteAsset(confirmDelete.id)
          if (confirmDelete.type === 'batch') void batchDelete()
          if (confirmDelete.type === 'product' && confirmDelete.id) void removeProduct(confirmDelete.id)
          if (confirmDelete.type === 'workflow' && confirmDelete.id) void removeWorkflow(confirmDelete.id)
        }}
      />
    </section>
  )
}
