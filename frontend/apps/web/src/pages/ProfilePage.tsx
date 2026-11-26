import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, del, patch, post, put, setToken } from '../api'
import { useApp } from '../AppContext'
import { ConfirmModal, Modal } from '../components'
import { Select } from '../Select'
import type { RemoteModelOption, UserProvider, WechatAccount } from '../types'

const PROVIDER_PRESETS = [
  { value: 'openai', label: 'OpenAI / 兼容协议' },
  { value: 'google', label: 'Google Gemini 兼容' },
  { value: 'volcengine', label: '火山方舟' },
  { value: 'aliyun', label: '阿里云百炼' },
  { value: 'custom', label: '自定义兼容接口' },
]

const CAPABILITY_LABELS: Record<string, string> = {
  image: '图片生成',
  video: '视频生成',
  understanding: '理解 / 文案',
}

const VIDEO_MODEL_HINTS = ['seedance', 'video', 't2v', 'i2v', 'sora', 'veo', 'kling', 'hailuo', 'runway', 'pika', 'luma', 'wan2', 'wanx2']
const IMAGE_MODEL_HINTS = ['seedream', 'image', 't2i', 'imagen', 'flux', 'dall-e', 'midjourney', 'sdxl', 'stable-diffusion', 'kolors', 'recraft', 'ideogram', 'banana', 'wanx', 'qwen-image']
const TEXT_MODEL_HINTS = ['gpt', 'claude', 'gemini', 'deepseek', 'qwen', 'glm', 'doubao', 'llama', 'mistral', 'moonshot', 'kimi', 'grok', 'chat', 'vision', 'vlm', 'omni', 'text']

function inferRemoteCapability(modelId: string, declared?: string) {
  const capability = (declared || '').toLowerCase()
  if (capability.includes('video')) return { capability: 'video', label: '视频生成' }
  if (capability.includes('image')) return { capability: 'image', label: '图片生成' }
  if (['llm', 'vlm', 'chat', 'text', 'audio', 'embedding', 'understanding'].includes(capability)) {
    return { capability: 'understanding', label: '理解 / 文案' }
  }
  const normalized = modelId.toLowerCase()
  if (VIDEO_MODEL_HINTS.some((hint) => normalized.includes(hint))) return { capability: 'video', label: '视频生成' }
  if (IMAGE_MODEL_HINTS.some((hint) => normalized.includes(hint))) return { capability: 'image', label: '图片生成' }
  if (TEXT_MODEL_HINTS.some((hint) => normalized.includes(hint))) return { capability: 'understanding', label: '理解 / 文案' }
  return null
}

const EMPTY_PROVIDER = {
  provider: 'openai',
  displayName: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  secretKey: '',
  models: '',
  capability: 'image',
  enabled: true,
}

const EMPTY_WECHAT = {
  accountName: '',
  appId: '',
  appSecret: '',
  enabled: true,
}

export default function ProfilePage() {
  const { user, config, toast, refreshUser, logout } = useApp()
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [egressIp, setEgressIp] = useState('')
  const [providers, setProviders] = useState<UserProvider[]>([])
  const [wechats, setWechats] = useState<WechatAccount[]>([])
  const [providerOpen, setProviderOpen] = useState(false)
  const [providerEdit, setProviderEdit] = useState<UserProvider | null>(null)
  const [providerForm, setProviderForm] = useState(EMPTY_PROVIDER)
  const [remoteProviderModels, setRemoteProviderModels] = useState<RemoteModelOption[]>([])
  const [remoteProviderQuery, setRemoteProviderQuery] = useState('')
  const [remoteProviderOpen, setRemoteProviderOpen] = useState(false)
  const [remoteProviderLoading, setRemoteProviderLoading] = useState(false)
  const [wechatOpen, setWechatOpen] = useState(false)
  const [wechatEdit, setWechatEdit] = useState<WechatAccount | null>(null)
  const [wechatForm, setWechatForm] = useState(EMPTY_WECHAT)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'provider' | 'wechat'; id: number; label: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [providerList, wechatList, ip] = await Promise.all([
        api<UserProvider[]>('/profile/providers'),
        api<WechatAccount[]>('/profile/wechats'),
        api<{ ip: string }>('/profile/egress-ip'),
      ])
      setProviders(providerList)
      setWechats(wechatList)
      setEgressIp(ip.ip || '')
    } catch (error) {
      toast(error instanceof Error ? error.message : '个人配置加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    setNickname(user?.nickname || '')
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  if (!user) return <Navigate to="/login" replace />

  const saveAccount = async () => {
    if (!nickname.trim()) return toast('昵称不能为空', 'error')
    if (oldPassword || newPassword) {
      if (!oldPassword || !newPassword) return toast('修改密码时请同时填写当前密码与新密码', 'error')
      if (newPassword.length < 8) return toast('新密码至少 8 位', 'error')
    }
    setBusy(true)
    try {
      await patch('/me', { nickname: nickname.trim() })
      if (oldPassword && newPassword) {
        const data = await post<{ token: string }>('/me/password', { oldPassword, newPassword })
        setToken(data.token)
        setOldPassword('')
        setNewPassword('')
      }
      await refreshUser()
      toast(oldPassword && newPassword ? '账号资料与登录密码已更新' : '账号资料已保存', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '账号保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const copyIp = async () => {
    if (!egressIp) return toast('管理员尚未配置服务器出口 IP', 'error')
    await navigator.clipboard.writeText(egressIp)
    toast('已复制服务器出口 IP', 'success')
  }

  const openProvider = (provider?: UserProvider) => {
    setProviderEdit(provider || null)
    setProviderForm(
      provider
        ? {
            provider: provider.provider,
            displayName: provider.displayName,
            baseUrl: provider.baseUrl,
            apiKey: '',
            secretKey: '',
            models: provider.models,
            capability: provider.capability || 'image',
            enabled: provider.enabled,
          }
        : EMPTY_PROVIDER,
    )
    setRemoteProviderModels([])
    setRemoteProviderQuery('')
    setRemoteProviderOpen(false)
    setRemoteProviderLoading(false)
    setProviderOpen(true)
  }

  const visibleRemoteProviderModels = useMemo(() => {
    const query = remoteProviderQuery.trim().toLowerCase()
    if (!query) return remoteProviderModels
    return remoteProviderModels.filter((model) =>
      `${model.id} ${model.displayName || ''} ${model.ownedBy || ''}`.toLowerCase().includes(query),
    )
  }, [remoteProviderModels, remoteProviderQuery])

  const pullProviderModels = async () => {
    if (!providerForm.baseUrl.trim()) return toast('请先填写 Base URL', 'error')
    if (!providerForm.apiKey.trim() && !providerEdit?.hasApiKey) {
      return toast('请先填写 API Key，或保存配置后再拉取已加密的模型列表', 'error')
    }
    setRemoteProviderLoading(true)
    try {
      const data = await post<{ models: RemoteModelOption[]; count: number }>('/profile/providers/remote-models', {
        providerId: providerEdit?.id || 0,
        provider: providerForm.provider,
        baseUrl: providerForm.baseUrl.trim(),
        apiKey: providerForm.apiKey.trim(),
      })
      setRemoteProviderModels(data.models || [])
      setRemoteProviderQuery('')
      setRemoteProviderOpen(true)
      toast(`已拉取 ${data.models?.length || 0} 个模型，点击即可填入`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '模型列表拉取失败', 'error')
    } finally {
      setRemoteProviderLoading(false)
    }
  }

  const selectRemoteProviderModel = (model: RemoteModelOption) => {
    const inferred = inferRemoteCapability(model.id, model.capability)
    setProviderForm((current) => ({
      ...current,
      models: model.id,
      displayName: current.displayName.trim() || model.displayName?.trim() || model.id,
      ...(inferred ? { capability: inferred.capability } : {}),
    }))
    setRemoteProviderOpen(false)
    toast(`已填入「${model.displayName || model.id}」${inferred ? ` · 已识别为${inferred.label}` : '，请确认能力类型'}`, 'success')
  }

  const saveProvider = async () => {
    if (!providerForm.displayName.trim()) return toast('供应商名称不能为空', 'error')
    if (!providerForm.baseUrl.trim()) return toast('Base URL 不能为空', 'error')
    if (!providerForm.models.trim()) return toast('请填写至少一个模型 ID', 'error')
    setBusy(true)
    try {
      const body = {
        ...providerForm,
        displayName: providerForm.displayName.trim(),
        baseUrl: providerForm.baseUrl.trim(),
        models: providerForm.models.trim(),
      }
      if (providerEdit) await put(`/profile/providers/${providerEdit.id}`, body)
      else await post('/profile/providers', body)
      await load()
      setProviderOpen(false)
      toast(providerEdit ? '自有模型配置已更新' : '自有模型已接入，密钥已加密保存', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '自有模型保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const openWechat = (wechat?: WechatAccount) => {
    setWechatEdit(wechat || null)
    setWechatForm({
      accountName: wechat?.accountName || '',
      appId: wechat?.appId || '',
      appSecret: '',
      enabled: wechat?.enabled ?? true,
    })
    setWechatOpen(true)
  }

  const saveWechat = async () => {
    if (!wechatForm.accountName.trim() || !wechatForm.appId.trim()) return toast('公众号名称与 AppID 不能为空', 'error')
    setBusy(true)
    try {
      const body = { ...wechatForm, accountName: wechatForm.accountName.trim(), appId: wechatForm.appId.trim() }
      if (wechatEdit) await put(`/profile/wechats/${wechatEdit.id}`, body)
      else await post('/profile/wechats', body)
      await load()
      setWechatOpen(false)
      toast(wechatEdit ? '公众号绑定已更新' : '公众号绑定成功', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '公众号绑定失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeProvider = async (id: number) => {
    try {
      await del(`/profile/providers/${id}`)
      setProviders((current) => current.filter((item) => item.id !== id))
      setConfirmDelete(null)
      toast('自有模型配置已删除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }

  const removeWechat = async (id: number) => {
    try {
      await del(`/profile/wechats/${id}`)
      setWechats((current) => current.filter((item) => item.id !== id))
      setConfirmDelete(null)
      toast('公众号绑定已解除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '解绑失败', 'error')
    }
  }

  const toggleProvider = async (provider: UserProvider) => {
    try {
      await put(`/profile/providers/${provider.id}`, {
        provider: provider.provider,
        displayName: provider.displayName,
        baseUrl: provider.baseUrl,
        apiKey: '',
        secretKey: '',
        models: provider.models,
        capability: provider.capability,
        enabled: !provider.enabled,
      })
      setProviders((current) =>
        current.map((item) => (item.id === provider.id ? { ...item, enabled: !provider.enabled } : item)),
      )
      toast(provider.enabled ? '自有模型配置已停用' : '自有模型配置已启用', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '切换模型状态失败', 'error')
    }
  }

  const maskedPhone = user ? user.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : ''

  return (
    <section id="view-profile" className="view-section active" aria-label="个人中心与绑定">
      <div className="page-head">
        <div>
          <h1 className="page-title">个人中心与第三方绑定</h1>
          <p className="page-sub">管理个人账号密码、自有大模型供应商（直连免积分）及微信公众号绑定配置。</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>账号与安全设置</h2>
              <span className="badge badge-success">已认证用户</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
              <div className="field">
                <span className="field-label">注册手机号</span>
                <input className="input tabular" value={maskedPhone} disabled />
              </div>
              <div className="field">
                <span className="field-label">昵称</span>
                <input className="input" value={nickname} onChange={(event) => setNickname(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <span className="field-label">修改登录密码</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input className="input" type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} placeholder="当前密码" />
                <input className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="新密码（至少 8 位）" />
              </div>
            </div>
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: 'var(--muted)' }}>
              {config?.registration.smsRequired
                ? '短信验证码已开启；如需找回密码，请联系管理员或使用后台重置。'
                : config?.registration.contactAdmin || '短信验证码关闭时，忘记密码请联系管理员在后台为您重置密码。'}
            </div>
          </div>
          <div className="card-footer-stick">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                logout()
                navigate('/login')
              }}
            >
              退出登录 / 切换登录页
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveAccount()} disabled={busy}>
              {busy ? '保存中…' : '保存账号设置'}
            </button>
          </div>
        </div>

        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>我的微信公众号绑定</h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openWechat()}>
                + 绑定公众号
              </button>
            </div>
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 12.5, color: '#1E40AF', flex: 1, minWidth: 0, lineHeight: 1.5 }}>
                <strong>服务器出口公网 IP：</strong>
                <code className="tabular">{egressIp || '未配置'}</code>
                （遇 40164 请加白名单；发布报 89506 请补全封面摘要）
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ flexShrink: 0 }} onClick={() => void copyIp()}>
                复制 IP
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {wechats.length ? (
                wechats.map((wechat) => (
                  <div key={wechat.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong>{wechat.accountName}</strong>
                        <span className={`badge ${wechat.enabled && wechat.hasSecret ? 'badge-success' : ''}`}>
                          {wechat.enabled ? (wechat.hasSecret ? '配置正常' : '待补全密钥') : '已停用'}
                        </span>
                      </div>
                      <div className="help-text tabular">AppID: {wechat.appId}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openWechat(wechat)}>
                        编辑
                      </button>
                      <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setConfirmDelete({ type: 'wechat', id: wechat.id, label: wechat.accountName })}>
                        解绑
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="help-text" style={{ padding: '18px 0', textAlign: 'center' }}>
                  尚未绑定公众号。绑定后可将生成的图文长文推送到草稿箱。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>我的自有大模型供应商（调用 0 积分）</h2>
            <p className="page-sub">可自由新增多套个人模型接口；密钥由服务端 AES-GCM 加密存储且不回显，Base URL 强制公网 HTTPS（防 SSRF）。</p>
          </div>
          <button type="button" className="btn btn-accent" onClick={() => openProvider()}>
            + 新增自有大模型
          </button>
        </div>
        <div className="grid-4">
          {providers.map((provider) => (
            <article key={provider.id} className="aligned-card">
              <div className="card-body-flex">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{provider.displayName}</strong>
                  <span className={`badge ${provider.enabled ? 'badge-success' : ''}`}>{provider.enabled ? '已启用' : '已停用'}</span>
                </div>
                <div className="help-text">
                  协议：<code>{provider.provider}</code> · 密钥：{provider.hasApiKey ? '已加密保存' : '未配置'}
                </div>
                <div className="help-text" style={{ wordBreak: 'break-all' }}>{provider.baseUrl}</div>
                <div className="chip-row" style={{ marginTop: 4 }}>
                  {provider.models
                    .split(',')
                    .map((model) => model.trim())
                    .filter(Boolean)
                    .map((model) => (
                      <span key={model} className="badge">
                        {model} ({CAPABILITY_LABELS[provider.capability] || provider.capability})
                      </span>
                    ))}
                </div>
              </div>
              <div className="card-footer-stick">
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => void toggleProvider(provider)}>
                    {provider.enabled ? '停用' : '启用'}
                  </button>
                  <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setConfirmDelete({ type: 'provider', id: provider.id, label: provider.displayName })}>
                    删除
                  </button>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => openProvider(provider)}>
                  编辑 / 拉取模型
                </button>
              </div>
            </article>
          ))}
          <button
            type="button"
            className="aligned-card"
            style={{ borderStyle: 'dashed', borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 200, background: 'var(--bg)', gap: 10 }}
            onClick={() => openProvider()}
          >
            <span style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
              +
            </span>
            <strong style={{ fontSize: 14.5 }}>新增个人大模型供应商</strong>
            <span className="help-text">支持 OpenAI / 火山方舟 / 可灵 / DeepSeek 等协议，直连免积分</span>
          </button>
        </div>
      </div>

      <Modal
        open={providerOpen}
        title={providerEdit ? '编辑自有大模型供应商' : '新增自有大模型供应商'}
        onClose={() => setProviderOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setProviderOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-accent" onClick={() => void saveProvider()} disabled={busy}>
              {busy ? '保存中…' : '保存配置'}
            </button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field">
            <span className="field-label">协议类型</span>
            <Select
              className="select"
              value={providerForm.provider}
              onChange={(event) => {
                setProviderForm((current) => ({ ...current, provider: event.target.value }))
                setRemoteProviderOpen(false)
              }}
            >
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <span className="field-label">显示名称</span>
            <input className="input" value={providerForm.displayName} onChange={(event) => setProviderForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="如：我的 OpenAI 主账号" />
          </div>
        </div>
        <div className="field">
          <span className="field-label">Base URL（必须公网 HTTPS）</span>
          <input
            className="input"
            value={providerForm.baseUrl}
            onChange={(event) => {
              setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))
              setRemoteProviderOpen(false)
            }}
            placeholder="https://api.openai.com/v1"
          />
        </div>
        <div className="field">
          <span className="field-label">
            <span>模型 ID（多个用英文逗号分隔）</span>
            <button
              type="button"
              className="field-link-button"
              onClick={() => void pullProviderModels()}
              disabled={remoteProviderLoading}
            >
              {remoteProviderLoading ? '拉取中…' : remoteProviderModels.length ? '重新拉取模型列表' : '拉取模型列表'}
            </button>
          </span>
          <input
            className="input tabular"
            value={providerForm.models}
            onChange={(event) => {
              setProviderForm((current) => ({ ...current, models: event.target.value }))
              setRemoteProviderOpen(false)
            }}
            placeholder="gpt-image-1, gpt-4.1-mini"
          />
          <span className="help-text">可直接读取当前接口的模型列表，也可手动填写模型 ID。</span>
        </div>
        {remoteProviderOpen ? (
          <div className="remote-model-panel">
            <div className="remote-model-toolbar">
              <div>
                <strong>接口可用模型</strong>
                <span className="help-text">已读取 {remoteProviderModels.length} 个，选择后自动带入名称与能力类型</span>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setRemoteProviderOpen(false)}>
                收起
              </button>
            </div>
            <input
              className="input"
              value={remoteProviderQuery}
              onChange={(event) => setRemoteProviderQuery(event.target.value)}
              placeholder="搜索模型 ID 或名称"
              aria-label="搜索接口模型"
            />
            <div className="remote-model-list">
              {visibleRemoteProviderModels.length ? visibleRemoteProviderModels.map((model) => {
                const selected = providerForm.models.split(',').map((item) => item.trim()).includes(model.id)
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`remote-model-option ${selected ? 'selected' : ''}`}
                    onClick={() => selectRemoteProviderModel(model)}
                  >
                    <span className="remote-model-copy">
                      <strong>{model.displayName || model.id}</strong>
                      <span>{model.id}{model.ownedBy ? ` · ${model.ownedBy}` : ''}</span>
                    </span>
                    <span className={`badge ${selected ? 'badge-accent' : ''}`}>{selected ? '已填入' : '选择'}</span>
                  </button>
                )
              }) : <div className="remote-model-empty">没有匹配的模型，请调整搜索词或手动填写模型 ID。</div>}
            </div>
          </div>
        ) : null}
        <div className="grid-2">
          <div className="field">
            <span className="field-label">API Key（留空不修改）</span>
            <input
              className="input"
              type="password"
              value={providerForm.apiKey}
              onChange={(event) => {
                setProviderForm((current) => ({ ...current, apiKey: event.target.value }))
                setRemoteProviderOpen(false)
              }}
              placeholder={providerEdit?.hasApiKey ? '********（已配置）' : 'sk-...'}
            />
          </div>
          <div className="field">
            <span className="field-label">Secret Key（可选）</span>
            <input className="input" type="password" value={providerForm.secretKey} onChange={(event) => setProviderForm((current) => ({ ...current, secretKey: event.target.value }))} placeholder={providerEdit?.hasSecretKey ? '********（已配置）' : '可选'} />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">模型能力</span>
            <Select className="select" value={providerForm.capability} onChange={(event) => setProviderForm((current) => ({ ...current, capability: event.target.value }))}>
              <option value="image">图片生成</option>
              <option value="video">视频生成</option>
              <option value="understanding">理解 / 文案</option>
            </Select>
          </div>
          <div className="switch-row" style={{ alignSelf: 'end' }}>
            <div>
              <strong>启用配置</strong>
              <div className="help-text">停用后不会出现在模型下拉框</div>
            </div>
            <button type="button" className={`toggle-pill ${providerForm.enabled ? 'on' : ''}`} onClick={() => setProviderForm((current) => ({ ...current, enabled: !current.enabled }))} aria-label="切换自有模型启用" />
          </div>
        </div>
        <div className="help-text">安全提示：Base URL 指向公网域名；服务端会拒绝回环、内网地址和 HTTP 协议（开发环境例外）。</div>
      </Modal>

      <Modal
        open={wechatOpen}
        title={wechatEdit ? '编辑公众号绑定' : '绑定微信公众号'}
        onClose={() => setWechatOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setWechatOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-accent" onClick={() => void saveWechat()} disabled={busy}>
              {busy ? '保存中…' : '保存绑定'}
            </button>
          </>
        }
      >
        <div className="field">
          <span className="field-label">公众号名称</span>
          <input className="input" value={wechatForm.accountName} onChange={(event) => setWechatForm((current) => ({ ...current, accountName: event.target.value }))} placeholder="如：星芒生活方式" />
        </div>
        <div className="field">
          <span className="field-label">AppID</span>
          <input className="input tabular" value={wechatForm.appId} onChange={(event) => setWechatForm((current) => ({ ...current, appId: event.target.value }))} placeholder="wx..." />
        </div>
        <div className="field">
          <span className="field-label">AppSecret（留空不修改）</span>
          <input className="input" type="password" value={wechatForm.appSecret} onChange={(event) => setWechatForm((current) => ({ ...current, appSecret: event.target.value }))} placeholder={wechatEdit?.hasSecret ? '********（已配置）' : '请输入 AppSecret'} />
        </div>
        <div className="switch-row">
          <div>
            <strong>启用该公众号</strong>
            <div className="help-text">停用后不会出现在文章推送列表</div>
          </div>
          <button type="button" className={`toggle-pill ${wechatForm.enabled ? 'on' : ''}`} onClick={() => setWechatForm((current) => ({ ...current, enabled: !current.enabled }))} aria-label="切换公众号启用" />
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(confirmDelete)}
        title={confirmDelete?.type === 'wechat' ? '解除公众号绑定' : '删除自有模型配置'}
        description={`确认操作「${confirmDelete?.label || ''}」？此操作不可撤销。`}
        confirmText="确认操作"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return
          if (confirmDelete.type === 'provider') void removeProvider(confirmDelete.id)
          if (confirmDelete.type === 'wechat') void removeWechat(confirmDelete.id)
        }}
      />
    </section>
  )
}
