import { useCallback, useEffect, useState } from 'react'
import { api, post, put } from '../api'
import { useAdmin } from '../AppContext'
import type { TikhubConfig } from '../types'

const PLATFORMS = [
  ['douyin', '抖音（Douyin）', '支持短视频搜索，时间范围通常不限'],
  ['xiaohongshu', '小红书（Xiaohongshu）', '支持图文与视频，时间可选 0/1/7/180 天'],
  ['tiktok', 'TikTok（国际版）', '支持视频与图文笔记'],
] as const

export default function CollectionPage() {
  const { toast } = useAdmin()
  const [baseUrl, setBaseUrl] = useState('https://api.tikhub.io')
  const [apiKey, setApiKey] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [proxyUrl, setProxyUrl] = useState('')
  const [creditsPerPage, setCreditsPerPage] = useState(10)
  const [videoLinkCredits, setVideoLinkCredits] = useState(0)
  const [enabled, setEnabled] = useState(false)
  const [pricing, setPricing] = useState<Record<string, number>>({ douyin: 10, xiaohongshu: 10, tiktok: 12 })
  const [weights, setWeights] = useState({ likes: 1, comments: 2, saves: 2.5, shares: 2 })
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api<TikhubConfig>('/admin/tikhub')
      setBaseUrl(data.baseUrl || 'https://api.tikhub.io')
      setProxyUrl(data.proxyUrl || '')
      setCreditsPerPage(data.creditsPerPage ?? 10)
      setVideoLinkCredits(data.videoLinkCredits ?? 0)
      setEnabled(data.enabled)
      setHasApiKey(data.hasApiKey)
      if (data.platformPricing) {
        setPricing({
          douyin: Number(data.platformPricing.douyin || data.creditsPerPage || 10),
          xiaohongshu: Number(data.platformPricing.xiaohongshu || data.creditsPerPage || 10),
          tiktok: Number(data.platformPricing.tiktok || data.creditsPerPage || 12),
        })
      }
      if (data.heatWeights) {
        setWeights({
          likes: Number(data.heatWeights.likes || 1),
          comments: Number(data.heatWeights.comments || 2),
          saves: Number(data.heatWeights.saves || 2.5),
          shares: Number(data.heatWeights.shares || 2),
        })
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'TikHub 配置加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!baseUrl.trim()) return toast('TikHub Base URL 不能为空', 'error')
    setBusy(true)
    try {
      await put('/admin/tikhub', {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        creditsPerPage,
        proxyUrl: proxyUrl.trim(),
        videoLinkCredits,
        platformPricing: pricing,
        heatWeights: weights,
        enabled,
      })
      await load()
      setApiKey('')
      toast('TikHub 与热度权重配置已生效', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '配置保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const data = await api<{ ok: boolean; message: string; latencyMs?: number; statusCode?: number }>('/admin/tikhub/test', { method: 'POST', body: JSON.stringify({}) })
      toast(`${data.message}${data.statusCode ? ` · HTTP ${data.statusCode}` : ''}${data.latencyMs ? ` · ${data.latencyMs}ms` : ''}`, data.ok ? 'success' : 'error')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'TikHub 连通测试失败', 'error')
    } finally {
      setTesting(false)
    }
  }

  const score =
    30000 * weights.likes + 1200 * weights.comments + 10000 * weights.saves + 3500 * weights.shares
  const preview = 100 * (1 - Math.exp(-score / 160000))

  return (
    <section className="view-section active">
      <div className="page-head">
        <div>
          <h1 className="page-title">TikHub 采集配置与热度算法权重</h1>
          <p className="page-sub">统一托管 TikHub 上游密钥与可选代理，按采集页数配置前台扣费单价，上限锁定 30 页。</p>
        </div>
        <button type="button" className="btn btn-accent" onClick={() => void save()} disabled={busy}>
          {busy ? '正在保存…' : '保存全部采集配置'}
        </button>
      </div>

      <div className="grid-2">
        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>TikHub 上游网关与代理</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge ${enabled ? 'badge-success' : 'badge-warning'}`}>{enabled ? '已启用' : '未启用'}</span>
                <button type="button" className={`toggle-pill ${enabled ? 'on' : ''}`} onClick={() => setEnabled((current) => !current)} aria-label="切换 TikHub 启用" />
              </div>
            </div>
            <div className="field">
              <span className="field-label">TikHub API Base URL</span>
              <input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
            </div>
            <div className="field">
              <span className="field-label">TikHub API Key（AES-GCM 加密 · 不回显）</span>
              <input className="input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasApiKey ? '********（已配置）' : '请输入 TikHub API Key'} />
            </div>
            <div className="field">
              <span className="field-label">可选出站代理 Proxy（留空直连）</span>
              <input className="input" value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} placeholder="http://127.0.0.1:7890 或 socks5://..." />
            </div>
            <div className="grid-2">
              <div className="field">
                <span className="field-label">默认单页积分（平台未单独配置时使用）</span>
                <input className="input tabular" type="number" min={1} value={creditsPerPage} onChange={(event) => setCreditsPerPage(Number(event.target.value))} />
              </div>
              <div className="field">
                <span className="field-label">单视频直链刷新兜底积分</span>
                <input className="input tabular" type="number" min={0} value={videoLinkCredits} onChange={(event) => setVideoLinkCredits(Number(event.target.value))} />
              </div>
            </div>
          </div>
          <div className="card-footer-stick">
            <span className="help-text">单页最大上限锁定：30 页</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void test()} disabled={testing}>
              {testing ? '测试中…' : '测试 TikHub 连通性'}
            </button>
          </div>
        </div>

        <div className="aligned-card">
          <div className="card-body-flex">
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>各平台每页积分与扣费结算规则</h2>
            {PLATFORMS.map(([key, label, hint]) => (
              <div key={key} className="switch-row">
                <div>
                  <strong>{label}</strong>
                  <div className="help-text">{hint}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="input tabular" style={{ width: 90, height: 34 }} type="number" min={1} value={pricing[key] ?? 10} onChange={(event) => setPricing((current) => ({ ...current, [key]: Number(event.target.value) }))} />
                  <span className="help-text">积分/页</span>
                </div>
              </div>
            ))}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              结算准则：提交按「最大页数 × 单页积分」预冻结，结束按实际成功发起的 TikHub 页数结算，未拉取页数即时退回。采集内容仅会员本人可见。
            </div>
          </div>
          <div className="card-footer-stick">
            <span className="help-text">采集封面与素材自动转存至当前激活对象存储</span>
            <span className="badge badge-success">防超额熔断：≤ 30 页</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>爆款热度评分模型权重（0–100 饱和分）</h2>
        <div className="grid-4">
          {[
            ['likes', '点赞权重 (likes)'],
            ['comments', '评论权重 (comments)'],
            ['saves', '收藏权重 (saves)'],
            ['shares', '分享权重 (shares)'],
          ].map(([key, label]) => (
            <div className="field" key={key}>
              <span className="field-label">{label}</span>
              <input
                className="input tabular"
                type="number"
                step="0.1"
                value={weights[key as keyof typeof weights]}
                onChange={(event) => setWeights((current) => ({ ...current, [key]: Number(event.target.value) }))}
              />
            </div>
          ))}
        </div>
        <div className="help-text">
          样本测试（赞 30,000 / 评 1,200 / 藏 10,000 / 转 3,500）：综合热度分 <strong className="tabular" style={{ color: 'var(--accent)' }}>{preview.toFixed(1)}</strong> / 100
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>接入说明</h2>
        <div className="grid-3">
          <div className="switch-row">
            <div>
              <strong>真实上游调用</strong>
              <div className="help-text">后台启用且密钥完整时，服务端调用 TikHub 搜索接口并落库。</div>
            </div>
          </div>
          <div className="switch-row">
            <div>
              <strong>开发环境兜底</strong>
              <div className="help-text">未启用时可返回演示数据，便于本地联调；生产环境应强制启用。</div>
            </div>
          </div>
          <div className="switch-row">
            <div>
              <strong>数据隔离</strong>
              <div className="help-text">批次、条目与关键词全部带 owner_user_id，只允许本人查询和删除。</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
