import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, del, post } from '../api'
import { useApp } from '../AppContext'
import { Artwork } from '../Artwork'
import { ConfirmModal, EmptyState, Modal } from '../components'
import { Select } from '../Select'
import { socialMetricsLine } from '../socialMetrics'
import type { CollectionBatch, CollectionItem, User } from '../types'

const platforms = [
  { id: 'douyin', label: '抖音' },
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'tiktok', label: 'TikTok' },
]

type Keyword = { id: number; keyword: string }

const batchStatusLabels: Record<string, string> = {
  queued: '排队中',
  running: '采集中',
  succeeded: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
}

function batchStatusClass(status: string) {
  if (status === 'succeeded') return 'badge-success'
  if (status === 'failed' || status === 'cancelled') return 'badge-danger'
  if (status === 'running') return 'badge-accent'
  return 'badge-warning'
}

export default function CollectPage() {
  const { toast, refreshUser, user, config } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const incoming = (location.state || {}) as { keyword?: string }
  const [platform, setPlatform] = useState('douyin')
  const [contentType, setContentType] = useState('video')
  const [days, setDays] = useState('0')
  const [limit, setLimit] = useState(40)
  const [keyword, setKeyword] = useState(incoming.keyword || '防晒衣显瘦穿搭')
  const [pages, setPages] = useState(3)
  const [batches, setBatches] = useState<CollectionBatch[]>([])
  const [items, setItems] = useState<CollectionItem[]>([])
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [batchFilter, setBatchFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [sort, setSort] = useState('score')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<CollectionItem | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiProduct, setAiProduct] = useState('')
  const [aiResults, setAiResults] = useState<string[]>([])
  const [newKeyword, setNewKeyword] = useState('')
  const [deleteBatchOpen, setDeleteBatchOpen] = useState(false)

  const unit = config?.collection.creditsPerPage ?? 10
  const frozen = pages * unit

  const load = useCallback(async () => {
    try {
      const [nextBatches, nextItems, nextKeywords] = await Promise.all([
        api<CollectionBatch[]>('/collection/batches'),
        api<CollectionItem[]>('/collection/items'),
        api<Keyword[]>('/collection/keywords'),
      ])
      setBatches(nextBatches)
      setItems(nextItems)
      setKeywords(nextKeywords)
    } catch (e) {
      toast(e instanceof Error ? e.message : '采集数据加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!batches.some((batch) => ['queued', 'running'].includes(batch.status))) return
    const timer = window.setInterval(() => {
      void load().then(() => refreshUser())
    }, 4000)
    return () => window.clearInterval(timer)
  }, [batches, load, refreshUser])

  const filtered = useMemo(() => {
    const list = items.filter(
      (item) =>
        (batchFilter === 'all' || String(item.batchId) === batchFilter) &&
        (platformFilter === 'all' || item.platform === platformFilter),
    )
    if (sort === 'score') return [...list].sort((a, b) => b.heat - a.heat)
    return [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  }, [batchFilter, items, platformFilter, sort])

  const visibleBatches = useMemo(() => {
    if (batchFilter === 'all') return batches.slice(0, 3)
    return batches.filter((batch) => String(batch.id) === batchFilter)
  }, [batchFilter, batches])
  const selectedBatch = batches.find((batch) => String(batch.id) === batchFilter)

  const submit = async () => {
    if (!keyword.trim()) return toast('请输入采集关键词', 'error')
    setBusy(true)
    try {
      const data = await post<{ batch: CollectionBatch; user: User }>('/collection/batches', {
        platform,
        keyword: keyword.trim(),
        pages,
        limit,
        contentType,
        days: Number(days),
      })
      await load()
      await refreshUser()
      toast(`采集任务 #${data.batch.id} 已提交，预冻结 ${data.batch.creditsCharged} 积分`, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '采集任务提交失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const requestRemoveBatch = () => {
    if (batchFilter === 'all') return toast('请先选择一个具体批次再删除', 'error')
    setDeleteBatchOpen(true)
  }

  const removeBatch = async () => {
    if (!selectedBatch) return
    try {
      await del(`/collection/batches/${selectedBatch.id}`)
      setBatchFilter('all')
      await load()
      await refreshUser()
      toast('已删除采集批次')
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败', 'error')
    } finally {
      setDeleteBatchOpen(false)
    }
  }

  const removeItem = async (item: CollectionItem) => {
    if (!window.confirm(`删除采集作品「${item.title}」？`)) return
    try {
      await del(`/collection/items/${item.id}`)
      setItems((current) => current.filter((row) => row.id !== item.id))
      setDetail(null)
      toast('已删除该采集作品')
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败', 'error')
    }
  }

  const addKeyword = async () => {
    if (!newKeyword.trim()) return
    try {
      const row = await post<Keyword>('/collection/keywords', { keyword: newKeyword.trim() })
      setKeywords((current) => [row, ...current])
      setNewKeyword('')
      toast('关键词已添加', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '添加失败', 'error')
    }
  }

  const removeKeyword = async (row: Keyword) => {
    try {
      await del(`/collection/keywords/${row.id}`)
      setKeywords((current) => current.filter((item) => item.id !== row.id))
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败', 'error')
    }
  }

  const aiExtract = async () => {
    try {
      const data = await post<{ keywords: string[]; creditsCharged: number }>('/collection/ai-keywords', { product: aiProduct, topic: keyword })
      setAiResults(data.keywords)
      await refreshUser()
      if (data.creditsCharged > 0) toast(`已消耗 ${data.creditsCharged} 积分完成关键词提炼`, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '关键词提炼失败', 'error')
    }
  }

  return (
    <section id="view-collect" className="view-section active" aria-label="爆款采集中心">
      <div className="page-head">
        <div>
          <h1 className="page-title">爆款采集中心</h1>
          <p className="page-sub">统一由后台 TikHub 通道抓取并转存云端对象存储；所有采集内容严格隔离，仅当前账号可见。</p>
        </div>
        <div className="page-actions">
          <span className="badge badge-success">数据仅本人可见</span>
          <span className="badge tabular">当前采集单价：{unit} 积分 / 页（最多 30 页）</span>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, alignItems: 'end' }}>
          <div className="field">
            <span className="field-label">目标平台</span>
            <div className="chip-row" style={{ minHeight: 40 }}>
              {platforms.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`chip ${platform === item.id ? 'active' : ''}`}
                  style={{ height: 40, padding: '0 15px', borderRadius: 10 }}
                  onClick={() => {
                    setPlatform(item.id)
                    setDays('0')
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">作品形态</span>
            <Select className="select" value={contentType} onChange={(event) => setContentType(event.target.value)}>
              <option value="video">短视频（Video）</option>
              <option value="image">图文笔记（Photo）</option>
            </Select>
          </div>
          <div className="field">
            <span className="field-label">
              发布时间范围 <span style={{ fontWeight: 500, color: 'var(--muted)' }}>{platform === 'xiaohongshu' ? '（支持 0/1/7/180 天）' : '（当前平台建议不限时间）'}</span>
            </span>
            <Select className="select" value={days} onChange={(event) => setDays(event.target.value)}>
              <option value="0">不限时间</option>
              {platform === 'xiaohongshu' ? (
                <>
                  <option value="1">近 1 天</option>
                  <option value="7">近 7 天</option>
                  <option value="180">近 180 天</option>
                </>
              ) : null}
            </Select>
          </div>
          <div className="field">
            <span className="field-label">目标条数 (1–500)</span>
            <input className="input tabular" type="number" min={1} max={500} value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(240px,1fr) auto', gap: 14, alignItems: 'end' }}>
          <div className="field">
            <span className="field-label">
              <span>搜索关键词</span>
              <button type="button" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 12 }} onClick={() => setAiOpen(true)}>
                + AI 从商品/资产提炼关键词
              </button>
            </span>
            <input className="input" type="text" placeholder="输入关键词，或点击下方常用关键词快速填入" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          </div>
          <div className="field">
            <span className="field-label">
              <span>最大翻页上限</span>
              <strong className="tabular" style={{ color: 'var(--accent)' }}>
                最多预冻结 {frozen} 积分（{pages} 页）
              </strong>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 40 }}>
              <input
                type="range"
                min={1}
                max={30}
                value={pages}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
                onChange={(event) => setPages(Number(event.target.value))}
              />
              <span className="badge tabular">{pages} 页</span>
            </div>
          </div>
          <button type="button" className="btn btn-accent btn-lg" onClick={submit} disabled={busy}>
            {busy ? '采集中…' : '开始采集'}
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div className="chip-row" style={{ flex: 1 }}>
            {keywords.map((row) => (
              <span key={row.id} className="chip">
                {row.keyword}
                <button type="button" onClick={() => removeKeyword(row)} aria-label={`删除 ${row.keyword}`} style={{ color: 'var(--muted)', marginLeft: 2 }}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input className="input" style={{ height: 34, width: 160, fontSize: 12.5 }} placeholder="新增关键词..." value={newKeyword} onChange={(event) => setNewKeyword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addKeyword()} />
            <button type="button" className="btn btn-outline btn-sm" onClick={addKeyword}>
              添加
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Select className="select" style={{ width: 220, height: 36 }} value={batchFilter} onChange={(event) => setBatchFilter(event.target.value)}>
            <option value="all">全部采集批次（{batches.length}）</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.keyword}（{platforms.find((item) => item.id === batch.platform)?.label || batch.platform} · {batch.pagesFetched}页）
              </option>
            ))}
          </Select>
          <Select className="select" style={{ width: 130, height: 36 }} value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
            <option value="all">全部平台</option>
            {platforms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
          <Select className="select" style={{ width: 140, height: 36 }} value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="score">按热度分降序</option>
            <option value="newest">按采集时间</option>
          </Select>
        </div>
        <button type="button" className="btn btn-danger-outline btn-sm" onClick={requestRemoveBatch}>
          删除当前批次
        </button>
      </div>

      {visibleBatches.length ? (
        <div className="collection-task-stack">
          {visibleBatches.map((batch) => (
            <article key={batch.id} className={`collection-task-card is-${batch.status}`}>
              <div className="collection-task-main">
                <div className="collection-task-title">
                  <strong>采集任务 #{batch.id}</strong>
                  <span className={`badge ${batchStatusClass(batch.status)}`}>{batchStatusLabels[batch.status] || batch.status}</span>
                </div>
                <div className="collection-task-meta">
                  {batch.keyword} · {platforms.find((item) => item.id === batch.platform)?.label || batch.platform}
                  {' · '}{batch.pagesFetched}/{batch.pages} 页 · {batch.itemCount} 条
                </div>
                {batch.status === 'failed' && batch.errorMessage ? (
                  <div className="collection-task-error">{batch.errorMessage}</div>
                ) : null}
              </div>
              {batchFilter === 'all' ? (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setBatchFilter(String(batch.id))}>
                  查看批次
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {filtered.length ? (
        <div className="grid-5">
          {filtered.map((item) => {
            const platformLabel = platforms.find((row) => row.id === item.platform)?.label || item.platform
            const itemMode = item.contentType === 'image' || (!item.contentType && item.platform === 'xiaohongshu') ? 'photo' : 'video'
            return (
              <article className="aligned-card" key={item.id}>
                <div className="art-thumb">
                  <Artwork
                    seed={item.seed}
                    label={item.author ? `@${item.author.replace(/^@/, '')}` : '@热门创作者'}
                    sublabel={`${platformLabel} · ${itemMode === 'photo' ? '图文笔记' : `${item.duration || 15}s 视频`}`}
                    url={item.coverUrl}
                  />
                  <div className="thumb-overlay-top">
                    <span className="thumb-pill">{platformLabel} · 仅本人可见</span>
                    <span className="thumb-pill score tabular">热度 {item.heat}</span>
                  </div>
                </div>
                <div className="card-body-flex">
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>{item.title}</h3>
                  <div className="social-metrics-line tabular">
                    {socialMetricsLine(item.metrics)}
                  </div>
                </div>
                <div className="card-footer-stick">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setDetail(item)}>
                      详情
                    </button>
                    <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => removeItem(item)}>
                      删除
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-accent btn-sm"
                    onClick={() => navigate('/clone', { state: { sourceUrl: item.url, sourceItemId: item.id, mode: itemMode } })}
                  >
                    {itemMode === 'photo' ? '图文复刻' : '视频复刻'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState>当前筛选下暂无采集作品，请在上方输入关键词发起采集。</EmptyState>
      )}

      <Modal open={Boolean(detail)} title="爆款作品详情（私有采集库）" onClose={() => setDetail(null)} footer={
        detail ? (
          <>
            <button type="button" className="btn btn-outline" onClick={() => {
              void navigator.clipboard.writeText(detail.url || '')
              toast('已复制源链接', 'success')
            }}>
              复制链接
            </button>
            <button type="button" className="btn btn-accent" onClick={() => navigate('/clone', { state: { sourceUrl: detail.url, sourceItemId: detail.id } })}>
              立即去复刻
            </button>
          </>
        ) : null
      }>
        {detail ? (
          <>
            <div className="art-thumb" style={{ marginBottom: 0 }}>
              <Artwork seed={detail.seed} label={detail.title} sublabel={detail.author} url={detail.coverUrl} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }} className="tabular">
              {[
                ['平台', platforms.find((row) => row.id === detail.platform)?.label || detail.platform],
                ['热度', String(detail.heat)],
                ['批次', `#${detail.batchId}`],
                ['采集时间', new Date(detail.createdAt).toLocaleDateString()],
              ].map(([label, value]) => (
                <div key={label} className="card" style={{ padding: 10, textAlign: 'center' }}>
                  <div className="help-text">{label}</div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="social-metrics-detail tabular">{socialMetricsLine(detail.metrics)}</div>
            <div className="help-text">数据仅当前账号可见；封面与素材已由服务端统一转存对象存储，来源链接：{detail.url || '—'}</div>
          </>
        ) : null}
      </Modal>

      <Modal
        open={aiOpen}
        title="AI 从商品或资产提炼关键词"
        onClose={() => setAiOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setAiOpen(false)}>
              关闭
            </button>
            <button type="button" className="btn btn-accent" onClick={aiExtract}>
              提炼关键词
            </button>
          </>
        }
      >
        <div className="field">
          <span className="field-label">商品名称 / 卖点描述</span>
          <textarea className="textarea" value={aiProduct} onChange={(event) => setAiProduct(event.target.value)} placeholder="如：冰感原纱防晒衣，UPF100+，轻薄透气，适合夏日通勤..." />
        </div>
        {aiResults.length ? (
          <div className="chip-row">
            {aiResults.map((item) => (
              <button
                key={item}
                type="button"
                className="chip"
                onClick={() => {
                  setKeyword(item)
                  setAiOpen(false)
                }}
              >
                {item}
              </button>
            ))}
          </div>
        ) : (
          <div className="help-text">系统会从商品主体、使用场景、内容形式三个维度生成可采集关键词。</div>
        )}
      </Modal>

      <ConfirmModal
        open={deleteBatchOpen}
        title="确认删除"
        description={
          selectedBatch
            ? `将永久删除采集批次「${selectedBatch.keyword}」及其名下全部作品，此操作不可恢复。`
            : '此操作将会永久删除当前采集批次及其名下全部作品，且不可恢复。'
        }
        confirmText="确认删除"
        danger
        onCancel={() => setDeleteBatchOpen(false)}
        onConfirm={() => void removeBatch()}
      />
    </section>
  )
}
