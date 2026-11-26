import { useCallback, useEffect, useState } from 'react'
import { api, post, put } from '../api'
import { useAdmin } from '../AppContext'
import { Empty } from '../components'
import type { StorageConfig } from '../types'

const ENGINES = [
  { key: 'oss', name: '阿里云 OSS', desc: '对象存储 OSS，支持签名直传与 CDN 直链下载。', endpoint: 'oss-cn-hangzhou.aliyuncs.com', region: 'cn-hangzhou' },
  { key: 'tos', name: '火山引擎 TOS', desc: '与方舟大模型同区传输，适合生成产物统一归档。', endpoint: 'tos-cn-beijing.volces.com', region: 'cn-beijing' },
  { key: 'cos', name: '腾讯云 COS', desc: 'COS 对象存储，支持 CDN 加速与浏览器跨域直传。', endpoint: 'cos.ap-guangzhou.myqcloud.com', region: 'ap-guangzhou' },
] as const

const WEB_ORIGIN =
  import.meta.env.VITE_WEB_ORIGIN ||
  (window.location.port === '5184' ? 'http://127.0.0.1:5183' : window.location.origin)

type Form = {
  provider: string
  endpoint: string
  region: string
  bucket: string
  accessKey: string
  secretKey: string
  publicBaseUrl: string
  enabled: boolean
}

const emptyForm = (provider: string): Form => {
  const engine = ENGINES.find((item) => item.key === provider) || ENGINES[0]
  return { provider, endpoint: engine.endpoint, region: engine.region, bucket: '', accessKey: '', secretKey: '', publicBaseUrl: '', enabled: false }
}

export default function StoragePage() {
  const { toast } = useAdmin()
  const [configs, setConfigs] = useState<StorageConfig[]>([])
  const [selected, setSelected] = useState('oss')
  const [form, setForm] = useState<Form>(emptyForm('oss'))
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api<StorageConfig[]>('/admin/storage')
      setConfigs(data)
      const active = data.find((item) => item.enabled) || data[0]
      const engine = active?.provider || 'oss'
      setSelected(engine)
      const config = data.find((item) => item.provider === engine)
      setForm(
        config
          ? {
              provider: config.provider,
              endpoint: config.endpoint,
              region: config.region,
              bucket: config.bucket,
              accessKey: config.accessKey || '',
              secretKey: '',
              publicBaseUrl: config.publicBaseUrl || '',
              enabled: config.enabled,
            }
          : emptyForm(engine),
      )
    } catch (error) {
      toast(error instanceof Error ? error.message : '存储配置加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const selectEngine = (key: string) => {
    setSelected(key)
    const config = configs.find((item) => item.provider === key)
    setForm(
      config
        ? {
            provider: config.provider,
            endpoint: config.endpoint,
            region: config.region,
            bucket: config.bucket,
            accessKey: config.accessKey || '',
            secretKey: '',
            publicBaseUrl: config.publicBaseUrl || '',
            enabled: config.enabled,
          }
        : emptyForm(key),
    )
  }

  const save = async () => {
    if (!form.endpoint.trim() || !form.bucket.trim()) return toast('Endpoint 与 Bucket 不能为空', 'error')
    setBusy(true)
    try {
      await put('/admin/storage', { ...form, enabled: true })
      await load()
      toast('存储配置已保存，并切换为当前主存储引擎', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '存储配置保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const data = await api<{ ok: boolean; message: string; provider?: string; bucket?: string }>('/admin/storage/test', {
        method: 'POST',
        body: JSON.stringify({ provider: selected }),
      })
      toast(`${data.message}${data.bucket ? ` · ${data.provider?.toUpperCase()} / ${data.bucket}` : ''}`, data.ok ? 'success' : 'error')
    } catch (error) {
      toast(error instanceof Error ? error.message : '存储测试失败', 'error')
    } finally {
      setTesting(false)
    }
  }

  const activeConfig = configs.find((item) => item.enabled)

  return (
    <section className="view-section active">
      <div className="page-head">
        <div>
          <h1 className="page-title">统一媒体存储引擎（OSS / TOS / COS）</h1>
          <p className="page-sub">全站上传素材、采集封面图与 AI 生成产物统一转存云端对象存储；普通用户无需接触存储密钥。</p>
        </div>
        <button type="button" className="btn btn-accent" onClick={() => void save()} disabled={busy}>
          {busy ? '正在保存…' : '保存并切换主存储引擎'}
        </button>
      </div>

      <div className="grid-3">
        {ENGINES.map((engine) => {
          const config = configs.find((item) => item.provider === engine.key)
          const active = config?.enabled
          return (
            <button key={engine.key} type="button" className={`engine-card ${selected === engine.key ? 'selected' : ''}`} onClick={() => selectEngine(engine.key)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
                <strong style={{ fontSize: 16 }}>{engine.name}</strong>
                <span className={`badge ${active ? 'badge-accent' : ''}`}>{active ? '当前激活' : config ? '已配置' : '未配置'}</span>
              </div>
              <span className="help-text">{engine.desc}</span>
              {config ? <span className="help-text" style={{ marginTop: 6 }}>Bucket：{config.bucket || '—'}</span> : null}
            </button>
          )
        })}
      </div>

      <div className="grid-2">
        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{ENGINES.find((item) => item.key === selected)?.name} 配置</h2>
              <span className={`badge ${form.enabled ? 'badge-success' : ''}`}>{form.enabled ? '主存储' : '未启用'}</span>
            </div>
            <div className="grid-2">
              <div className="field">
                <span className="field-label">Endpoint</span>
                <input className="input" value={form.endpoint} onChange={(event) => setForm((current) => ({ ...current, endpoint: event.target.value }))} />
              </div>
              <div className="field">
                <span className="field-label">Region</span>
                <input className="input" value={form.region} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} />
              </div>
            </div>
            <div className="field">
              <span className="field-label">Bucket</span>
              <input className="input" value={form.bucket} onChange={(event) => setForm((current) => ({ ...current, bucket: event.target.value }))} placeholder="bucket-name" />
            </div>
            <div className="grid-2">
              <div className="field">
                <span className="field-label">AccessKey</span>
                <input className="input" value={form.accessKey} onChange={(event) => setForm((current) => ({ ...current, accessKey: event.target.value }))} />
              </div>
              <div className="field">
                <span className="field-label">SecretKey（留空不改）</span>
                <input className="input" type="password" value={form.secretKey} onChange={(event) => setForm((current) => ({ ...current, secretKey: event.target.value }))} placeholder={configs.find((item) => item.provider === selected)?.hasSecretKey ? '********（已配置）' : '请输入 SecretKey'} />
              </div>
            </div>
            <div className="field">
              <span className="field-label">公开访问 Base URL / CDN 域名（可选）</span>
              <input className="input" value={form.publicBaseUrl} onChange={(event) => setForm((current) => ({ ...current, publicBaseUrl: event.target.value }))} placeholder="https://cdn.example.com" />
            </div>
          </div>
          <div className="card-footer-stick">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void test()} disabled={testing}>
              {testing ? '测试中…' : '测试直传与签名'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={busy}>
              保存存储配置
            </button>
          </div>
        </div>

        <div className="aligned-card">
          <div className="card-body-flex">
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>CORS 跨域清单与对象存储联动</h2>
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div><strong>Bucket 必须放行以下浏览器跨域规则：</strong></div>
              <div>· 允许来源：<code>{WEB_ORIGIN}</code>（C 端前台域名）</div>
              <div>· 允许方法：<code>PUT</code>、<code>GET</code>、<code>HEAD</code></div>
              <div>· 允许头：<code>Content-Type</code>、<code>Authorization</code>、<code>*</code></div>
            </div>
            <div className="switch-row" style={{ marginTop: 6 }}>
              <div>
                <strong>当前主存储</strong>
                <div className="help-text">{activeConfig ? `${activeConfig.provider.toUpperCase()} · ${activeConfig.bucket}` : '尚未启用'}</div>
              </div>
              <span className={`badge ${activeConfig ? 'badge-success' : 'badge-warning'}`}>{activeConfig ? '在线托管' : '待配置'}</span>
            </div>
            <div className="switch-row">
              <div>
                <strong>对象存储删除联动</strong>
                <div className="help-text">删除资产时同步清理对象；本地临时文件由运维计划任务巡检</div>
              </div>
              <span className="badge tabular">即时</span>
            </div>
            <div className="help-text">存储密钥仅保存在后端配置中，前台用户无法读取。上传接口会自动识别图片、视频与 Markdown 类型。</div>
          </div>
          <div className="card-footer-stick">
            <span className="help-text">图片上传后可自动转存到对象存储</span>
            <span className="badge">OSS / TOS / COS</span>
          </div>
        </div>
      </div>

      {!configs.length ? <Empty>尚未创建任何存储配置。请选择引擎并填写 Bucket 参数后保存。</Empty> : null}
    </section>
  )
}
