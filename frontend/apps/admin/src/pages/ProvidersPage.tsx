import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, del, post, put } from '../api'
import { useAdmin } from '../AppContext'
import { Confirm, Empty, Modal } from '../components'
import { Select } from '../Select'
import type { Provider, ProviderModel } from '../types'

type SettingsPayload = { settings: Record<string, string> }
type RemoteModelOption = {
  id: string
  displayName?: string
  ownedBy?: string
  capability?: string
}

const PROVIDER_OPTIONS = [
  { value: 'ark', label: '火山方舟（Ark）' },
  { value: 'openai', label: 'OpenAI / 兼容协议' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'kling', label: '可灵 Kling' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'midjourney', label: 'Midjourney 中转' },
  { value: 'minimax', label: 'MiniMax 海螺' },
  { value: 'qwen', label: '通义万相 / DashScope' },
  { value: 'aliyun', label: '阿里云百炼' },
  { value: 'custom', label: '自定义 OpenAI 兼容协议' },
]

const EMPTY_PROVIDER = {
  provider: 'ark',
  displayName: '',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: '',
  secretKey: '',
  enabled: true,
  sortOrder: 0,
}

const EMPTY_MODEL = {
  modelId: '',
  displayName: '',
  capability: 'image',
  unit: '张',
  credits: 12,
  credits480p: 0,
  credits720p: 0,
  credits1080p: 0,
  enabled: true,
  supportsVideoRef: false,
  maxRefImages: 4,
}

const VIDEO_MODEL_HINTS = ['seedance', 'video', 't2v', 'i2v', 'sora', 'veo', 'kling', 'hailuo', 'runway', 'pika', 'luma', 'wan2', 'wanx2']
const IMAGE_MODEL_HINTS = ['seedream', 'image', 't2i', 'imagen', 'flux', 'dall-e', 'midjourney', 'sdxl', 'stable-diffusion', 'kolors', 'recraft', 'ideogram', 'banana', 'wanx', 'qwen-image']
const TEXT_MODEL_HINTS = ['gpt', 'claude', 'gemini', 'deepseek', 'qwen', 'glm', 'doubao', 'llama', 'mistral', 'moonshot', 'kimi', 'grok', 'chat', 'vision', 'vlm', 'omni', 'text']

function inferRemoteCapability(modelId: string, declared?: string) {
  const declaredCapability = (declared || '').toLowerCase()
  if (declaredCapability.includes('video')) return { capability: 'video', unit: '秒', label: '生视频' }
  if (declaredCapability.includes('image')) return { capability: 'image', unit: '张', label: '生图' }
  if (['llm', 'vlm', 'chat', 'text', 'audio', 'embedding', 'understanding'].includes(declaredCapability)) {
    return { capability: 'understanding', unit: '次', label: '理解 / 文案' }
  }
  const normalized = modelId.toLowerCase()
  if (VIDEO_MODEL_HINTS.some((hint) => normalized.includes(hint))) return { capability: 'video', unit: '秒', label: '生视频' }
  if (IMAGE_MODEL_HINTS.some((hint) => normalized.includes(hint))) return { capability: 'image', unit: '张', label: '生图' }
  if (TEXT_MODEL_HINTS.some((hint) => normalized.includes(hint))) return { capability: 'understanding', unit: '次', label: '理解 / 文案' }
  return null
}

function modelResolutionCredits(model: ProviderModel, resolution: string) {
  const configured =
    resolution === '480p' ? model.credits480p
      : resolution === '720p' ? model.credits720p
        : model.credits1080p
  return configured && configured > 0 ? configured : model.credits
}

export default function ProvidersPage() {
  const { toast } = useAdmin()
  const [providers, setProviders] = useState<Provider[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [providerOpen, setProviderOpen] = useState(false)
  const [providerEdit, setProviderEdit] = useState<Provider | null>(null)
  const [providerForm, setProviderForm] = useState(EMPTY_PROVIDER)
  const [modelOpen, setModelOpen] = useState(false)
  const [modelProvider, setModelProvider] = useState<Provider | null>(null)
  const [modelEdit, setModelEdit] = useState<ProviderModel | null>(null)
  const [modelForm, setModelForm] = useState(EMPTY_MODEL)
  const [remoteModels, setRemoteModels] = useState<RemoteModelOption[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remotePanelOpen, setRemotePanelOpen] = useState(false)
  const [remoteQuery, setRemoteQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'provider' | 'model'; provider: Provider; model?: ProviderModel } | null>(null)
  const [busy, setBusy] = useState(false)
  const [defaults, setDefaults] = useState({ understanding: '', image: '' })

  const load = useCallback(async () => {
    try {
      const [providerList, settingsData] = await Promise.all([
        api<Provider[]>('/admin/providers'),
        api<SettingsPayload>('/admin/settings'),
      ])
      setProviders(providerList)
      setSettings(settingsData.settings)
      const defaultUnderstanding = providerList
        .filter((provider) => provider.enabled)
        .flatMap((provider) => provider.models)
        .find((model) => model.capability === 'understanding' && model.enabled)
      const defaultImage = providerList
        .filter((provider) => provider.enabled)
        .flatMap((provider) => provider.models)
        .find((model) => model.capability === 'image' && model.enabled)
      setDefaults({
        understanding: settingsData.settings['models.defaultUnderstanding'] || defaultUnderstanding?.modelId || '',
        image: settingsData.settings['models.defaultImage'] || defaultImage?.modelId || '',
      })
    } catch (error) {
      toast(error instanceof Error ? error.message : '供应商数据加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const allModels = useMemo(() => providers.flatMap((provider) => provider.models.map((model) => ({ provider, model }))), [providers])
  const visibleRemoteModels = useMemo(() => {
    const query = remoteQuery.trim().toLowerCase()
    if (!query) return remoteModels
    return remoteModels.filter((model) => `${model.id} ${model.displayName || ''} ${model.ownedBy || ''}`.toLowerCase().includes(query))
  }, [remoteModels, remoteQuery])

  const openProvider = (provider?: Provider) => {
    setProviderEdit(provider || null)
    setProviderForm(
      provider
        ? {
            provider: provider.provider,
            displayName: provider.displayName,
            baseUrl: provider.baseUrl,
            apiKey: '',
            secretKey: '',
            enabled: provider.enabled,
            sortOrder: provider.sortOrder,
          }
        : EMPTY_PROVIDER,
    )
    setProviderOpen(true)
  }

  const saveProvider = async () => {
    if (!providerForm.displayName.trim() || !providerForm.baseUrl.trim()) return toast('请填写供应商名称与 Base URL', 'error')
    setBusy(true)
    try {
      const body = { ...providerForm, displayName: providerForm.displayName.trim(), baseUrl: providerForm.baseUrl.trim() }
      if (providerEdit) await put(`/admin/providers/${providerEdit.id}`, body)
      else await post('/admin/providers', body)
      await load()
      setProviderOpen(false)
      toast(providerEdit ? '供应商已更新' : '供应商已创建', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '供应商保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleProvider = async (provider: Provider) => {
    try {
      await put(`/admin/providers/${provider.id}`, {
        provider: provider.provider,
        displayName: provider.displayName,
        baseUrl: provider.baseUrl,
        apiKey: '',
        secretKey: '',
        enabled: !provider.enabled,
        sortOrder: provider.sortOrder,
      })
      await load()
      toast(provider.enabled ? '供应商已停用' : '供应商已启用', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '供应商状态切换失败', 'error')
    }
  }

  const openModel = (provider: Provider, model?: ProviderModel) => {
    setModelProvider(provider)
    setModelEdit(model || null)
    setRemoteModels([])
    setRemoteLoading(false)
    setRemotePanelOpen(false)
    setRemoteQuery('')
    setModelForm(
      model
        ? {
            modelId: model.modelId,
            displayName: model.displayName,
            capability: model.capability,
            unit: model.unit,
            credits: model.credits,
            credits480p: model.credits480p || 0,
            credits720p: model.credits720p || 0,
            credits1080p: model.credits1080p || 0,
            enabled: model.enabled,
            supportsVideoRef: model.supportsVideoRef,
            maxRefImages: model.maxRefImages,
          }
        : EMPTY_MODEL,
    )
    setModelOpen(true)
  }

  const pullRemoteModels = async () => {
    if (!modelProvider) return
    if (!modelProvider.hasApiKey) return toast('该供应商尚未保存 API Key，请先在供应商配置中补齐密钥', 'error')
    setRemoteLoading(true)
    try {
      const data = await api<{ models: RemoteModelOption[]; count: number }>(`/admin/providers/${modelProvider.id}/remote-models`)
      setRemoteModels(data.models || [])
      setRemoteQuery('')
      setRemotePanelOpen(true)
      toast(`已拉取 ${data.models?.length || 0} 个模型，点击列表即可填入`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '模型列表拉取失败', 'error')
    } finally {
      setRemoteLoading(false)
    }
  }

  const selectRemoteModel = (model: RemoteModelOption) => {
    const inferred = inferRemoteCapability(model.id, model.capability)
    setModelForm((current) => ({
      ...current,
      modelId: model.id,
      displayName: model.displayName?.trim() || model.id,
      ...(inferred ? { capability: inferred.capability, unit: inferred.unit } : {}),
    }))
    setRemotePanelOpen(false)
    toast(`已填入「${model.displayName || model.id}」${inferred ? ` · 已识别为${inferred.label}` : '，请确认能力类型'}`, 'success')
  }

  const saveModel = async () => {
    if (!modelProvider || !modelForm.modelId.trim()) return toast('模型 ID 不能为空', 'error')
    setBusy(true)
    try {
      const body = { ...modelForm, modelId: modelForm.modelId.trim(), displayName: modelForm.displayName.trim() || modelForm.modelId.trim() }
      if (modelEdit) await put(`/admin/providers/${modelProvider.id}/models/${modelEdit.id}`, body)
      else await post(`/admin/providers/${modelProvider.id}/models`, body)
      await load()
      setModelOpen(false)
      toast(modelEdit ? '模型定价已更新' : '模型已添加', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '模型保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleModel = async (provider: Provider, model: ProviderModel) => {
    try {
      await put(`/admin/providers/${provider.id}/models/${model.id}`, {
        modelId: model.modelId,
        displayName: model.displayName,
        capability: model.capability,
        unit: model.unit,
        credits: model.credits,
        credits480p: model.credits480p || 0,
        credits720p: model.credits720p || 0,
        credits1080p: model.credits1080p || 0,
        enabled: !model.enabled,
        supportsVideoRef: model.supportsVideoRef,
        maxRefImages: model.maxRefImages,
      })
      await load()
      toast(model.enabled ? '模型已停用' : '模型已启用', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '模型状态切换失败', 'error')
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.type === 'provider') {
        await del(`/admin/providers/${deleteTarget.provider.id}`)
      } else if (deleteTarget.model) {
        await del(`/admin/providers/${deleteTarget.provider.id}/models/${deleteTarget.model.id}`)
      }
      await load()
      setDeleteTarget(null)
      toast(deleteTarget.type === 'provider' ? '供应商及旗下模型已删除' : '模型已删除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }

  const saveDefaults = async () => {
    setBusy(true)
    try {
      const next = {
        ...settings,
        'models.defaultUnderstanding': defaults.understanding,
        'models.defaultImage': defaults.image,
      }
      await put('/admin/settings', { settings: next })
      setSettings(next)
      toast('全局默认平台模型路由已保存', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '默认模型保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const understandingModels = allModels.filter(({ model }) => model.capability === 'understanding' && model.enabled)
  const imageModels = allModels.filter(({ model }) => model.capability === 'image' && model.enabled)

  return (
    <section className="view-section active">
      <div className="page-head">
        <div>
          <h1 className="page-title">多供应商大模型接入与积分定价</h1>
          <p className="page-sub">借鉴原项目配置并升级为多实例自由新增/编辑（支持同协议多中转源、拉取模型、能力打标），彻底移除 ComfyUI。</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={() => { if (providers[0]) openModel(providers[0]) }}>
            + 新增定价规则
          </button>
          <button type="button" className="btn btn-accent" onClick={() => openProvider()}>
            + 新增平台大模型供应商
          </button>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16, alignItems: 'end' }}>
        <div className="field">
          <span className="field-label">全局默认理解 / 分镜 / 文案模型</span>
          <Select className="select" value={defaults.understanding} onChange={(event) => setDefaults((current) => ({ ...current, understanding: event.target.value }))}>
            <option value="">按后台排序自动选择</option>
            {understandingModels.map(({ provider, model }) => (
              <option key={model.id} value={model.modelId}>
                {provider.displayName} · {model.displayName}（{model.credits} 积分/{model.unit}）
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <span className="field-label">全局默认生图模型</span>
          <Select className="select" value={defaults.image} onChange={(event) => setDefaults((current) => ({ ...current, image: event.target.value }))}>
            <option value="">按后台排序自动选择</option>
            {imageModels.map(({ provider, model }) => (
              <option key={model.id} value={model.modelId}>
                {provider.displayName} · {model.displayName}（{model.credits} 积分/{model.unit}）
              </option>
            ))}
          </Select>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void saveDefaults()} disabled={busy}>
          保存全局默认
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>平台供应商实例列表（可任意新增多个账号 / 中转节点）</h2>
        {providers.length ? (
          <div className="grid-4">
            {providers.map((provider) => (
              <article key={provider.id} className="aligned-card">
                <div className="card-body-flex">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 15.5 }}>{provider.displayName}</strong>
                    <span className={`badge ${provider.enabled ? 'badge-success' : ''}`}>{provider.enabled ? '已启用' : '停用'}</span>
                  </div>
                  <div className="help-text">
                    协议：<code>{provider.provider}</code> · 密钥：
                    {provider.hasApiKey ? 'AES-GCM 已配置' : '未配置'}
                    {provider.provider === 'kling' && provider.hasSecretKey ? ' + Secret' : ''}
                  </div>
                  <div className="help-text" style={{ wordBreak: 'break-all' }}>{provider.baseUrl}</div>
                  <div className="chip-row" style={{ marginTop: 4 }}>
                    {provider.models.slice(0, 6).map((model) => (
                      <span key={model.id} className="badge">
                        {model.modelId} · {model.capability === 'image' ? '生图' : model.capability === 'video' ? '视频' : '理解'}
                      </span>
                    ))}
                    {!provider.models.length ? <span className="help-text">尚未添加模型</span> : null}
                  </div>
                </div>
                <div className="card-footer-stick" style={{ gap: 6 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => void toggleProvider(provider)}>
                      {provider.enabled ? '停用' : '启用'}
                    </button>
                    <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setDeleteTarget({ type: 'provider', provider })}>
                      删除
                    </button>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => openProvider(provider)}>
                    编辑 / 拉取模型
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>尚未接入任何模型供应商。</Empty>
        )}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>模型积分消费定价规则</h2>
            <p className="page-sub">支持按次、按张、按秒计费；视频模型可分别设置 480P / 720P / 1080P 每秒积分。任务提交时快照费率，调整价格不会追溯已创建任务。</p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (providers[0]) openModel(providers[0])
            }}
          >
            + 新增定价
          </button>
        </div>
        {allModels.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>供应商</th>
                  <th>模型</th>
                  <th>能力</th>
                  <th>计费单位</th>
                  <th>积分单价</th>
                  <th>视频参考</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {allModels.map(({ provider, model }) => (
                  <tr key={`${provider.id}-${model.id}`}>
                    <td>{provider.displayName}</td>
                    <td>
                      <strong>{model.displayName}</strong>
                      <div className="help-text tabular">{model.modelId}</div>
                    </td>
                    <td>{model.capability === 'image' ? '生图' : model.capability === 'video' ? '生视频' : '理解 / 文案'}</td>
                    <td>{model.unit || '次'}</td>
                    <td className="tabular">
                      <strong>{model.credits}</strong>
                      {model.capability === 'video' ? (
                        <div className="help-text tabular">
                          480P {modelResolutionCredits(model, '480p')} · 720P {modelResolutionCredits(model, '720p')} · 1080P {modelResolutionCredits(model, '1080p')}
                        </div>
                      ) : null}
                    </td>
                    <td>{model.supportsVideoRef ? '支持' : '—'}</td>
                    <td><span className={`badge ${model.enabled ? 'badge-success' : ''}`}>{model.enabled ? '启用' : '停用'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => openModel(provider, model)}>编辑</button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => void toggleModel(provider, model)}>
                          {model.enabled ? '停用' : '启用'}
                        </button>
                        <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setDeleteTarget({ type: 'model', provider, model })}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>暂无定价规则。</Empty>}
      </div>

      <Modal
        open={providerOpen}
        title={providerEdit ? '编辑平台模型供应商' : '新增平台模型供应商'}
        onClose={() => setProviderOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setProviderOpen(false)}>取消</button>
            <button type="button" className="btn btn-accent" onClick={() => void saveProvider()} disabled={busy}>{busy ? '保存中…' : '保存供应商'}</button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field">
            <span className="field-label">协议类型</span>
            <Select className="select" value={providerForm.provider} onChange={(event) => setProviderForm((current) => ({ ...current, provider: event.target.value }))}>
              {PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </div>
          <div className="field">
            <span className="field-label">显示名称</span>
            <input className="input" value={providerForm.displayName} onChange={(event) => setProviderForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="如：火山方舟 · 主账号" />
          </div>
        </div>
        <div className="field">
          <span className="field-label">API Base URL</span>
          <input className="input" value={providerForm.baseUrl} onChange={(event) => setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://..." />
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">API Key（AES-GCM 加密 · 留空不改）</span>
            <input className="input" type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder={providerEdit?.hasApiKey ? '********（已配置）' : '请输入 API Key'} />
          </div>
          <div className="field">
            <span className="field-label">Secret Key（可选）</span>
            <input className="input" type="password" value={providerForm.secretKey} onChange={(event) => setProviderForm((current) => ({ ...current, secretKey: event.target.value }))} placeholder={providerEdit?.hasSecretKey ? '********（已配置）' : '可选'} />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">排序</span>
            <input className="input tabular" type="number" value={providerForm.sortOrder} onChange={(event) => setProviderForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
          </div>
          <div className="switch-row" style={{ alignSelf: 'end' }}>
            <div>
              <strong>启用供应商</strong>
              <div className="help-text">关闭后模型不会对前台开放</div>
            </div>
            <button type="button" className={`toggle-pill ${providerForm.enabled ? 'on' : ''}`} onClick={() => setProviderForm((current) => ({ ...current, enabled: !current.enabled }))} aria-label="切换供应商启用" />
          </div>
        </div>
      </Modal>

      <Modal
        open={modelOpen}
        title={modelEdit ? '编辑模型定价' : `新增模型 · ${modelProvider?.displayName || ''}`}
        onClose={() => {
          setModelOpen(false)
          setRemotePanelOpen(false)
        }}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setModelOpen(false)}>取消</button>
            <button type="button" className="btn btn-accent" onClick={() => void saveModel()} disabled={busy}>{busy ? '保存中…' : '保存模型'}</button>
          </>
        }
      >
        <div className="field">
          <span className="field-label">供应商</span>
          <Select
            className="select"
            value={modelProvider?.id || ''}
            onChange={(event) => {
              const nextProvider = providers.find((provider) => provider.id === Number(event.target.value)) || null
              if (nextProvider?.id !== modelProvider?.id) {
                setModelForm((current) => ({
                  ...current,
                  modelId: '',
                  displayName: '',
                  capability: 'image',
                  unit: '张',
                  supportsVideoRef: false,
                  maxRefImages: 4,
                }))
              }
              setModelProvider(nextProvider)
              setRemoteModels([])
              setRemotePanelOpen(false)
              setRemoteQuery('')
            }}
          >
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
          </Select>
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">
              <span>模型 ID</span>
              <button type="button" className="field-link-button" onClick={() => void pullRemoteModels()} disabled={remoteLoading || !modelProvider}>
                {remoteLoading ? '拉取中…' : remoteModels.length ? '重新拉取' : '拉取模型列表'}
              </button>
            </span>
            <input
              className="input tabular"
              value={modelForm.modelId}
              onChange={(event) => {
                setModelForm((current) => ({ ...current, modelId: event.target.value }))
                setRemotePanelOpen(false)
              }}
              placeholder="doubao-seedream-3-0-t2i"
            />
            <span className="help-text">使用已保存的供应商密钥读取；也支持手动填写模型 ID。</span>
          </div>
          <div className="field">
            <span className="field-label">显示名称</span>
            <input className="input" value={modelForm.displayName} onChange={(event) => setModelForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Seedream 3.0" />
          </div>
        </div>
        {remotePanelOpen ? (
          <div className="remote-model-panel">
            <div className="remote-model-toolbar">
              <div>
                <strong>供应商可用模型</strong>
                <span className="help-text">已读取 {remoteModels.length} 个，选择后自动带入名称与能力类型</span>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setRemotePanelOpen(false)}>收起</button>
            </div>
            <input
              className="input"
              value={remoteQuery}
              onChange={(event) => setRemoteQuery(event.target.value)}
              placeholder="搜索模型 ID 或名称"
              aria-label="搜索供应商模型"
            />
            <div className="remote-model-list">
              {visibleRemoteModels.length ? visibleRemoteModels.map((model) => {
                const selected = modelForm.modelId === model.id
                return (
                  <button key={model.id} type="button" className={`remote-model-option ${selected ? 'selected' : ''}`} onClick={() => selectRemoteModel(model)}>
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
        <div className="grid-3">
          <div className="field">
            <span className="field-label">能力类型</span>
            <Select className="select" value={modelForm.capability} onChange={(event) => {
              const capability = event.target.value
              const unit = capability === 'video' ? '秒' : capability === 'understanding' ? '次' : '张'
              setModelForm((current) => ({ ...current, capability, unit }))
            }}>
              <option value="image">生图</option>
              <option value="video">生视频</option>
              <option value="understanding">理解 / 文案</option>
            </Select>
          </div>
          <div className="field">
            <span className="field-label">计费单位</span>
            <Select className="select" value={modelForm.unit} onChange={(event) => setModelForm((current) => ({ ...current, unit: event.target.value }))}>
              <option value="张">张</option>
              <option value="秒">秒</option>
              <option value="次">次</option>
            </Select>
          </div>
          <div className="field">
            <span className="field-label">基础积分单价</span>
            <input className="input tabular" type="number" min={0} value={modelForm.credits} onChange={(event) => setModelForm((current) => ({ ...current, credits: Number(event.target.value) }))} />
          </div>
        </div>
        {modelForm.capability === 'video' ? (
          <div className="field">
            <span className="field-label">视频分辨率定价（积分 / 秒）</span>
            <div className="grid-3">
              {([
                ['480p', '480P', 'credits480p'],
                ['720p', '720P', 'credits720p'],
                ['1080p', '1080P', 'credits1080p'],
              ] as const).map(([, label, key]) => (
                <label key={key} className="field" style={{ gap: 6 }}>
                  <span className="help-text">{label}</span>
                  <input
                    className="input tabular"
                    type="number"
                    min={0}
                    value={modelForm[key]}
                    onChange={(event) => setModelForm((current) => ({ ...current, [key]: Number(event.target.value) }))}
                    placeholder={`留 0 使用基础价 ${modelForm.credits}`}
                  />
                </label>
              ))}
            </div>
            <span className="help-text">留 0 时回退到基础积分单价。火山方舟按输出视频 token 计费；同画幅、同帧率下，480P 约为 720P 的 0.44 倍，1080P 约为 720P 的 2.25 倍。建议按该比例分别配置三档积分价。</span>
          </div>
        ) : null}
        <div className="grid-2">
          <div className="field">
            <span className="field-label">最大参考图片数</span>
            <input className="input tabular" type="number" min={1} value={modelForm.maxRefImages} onChange={(event) => setModelForm((current) => ({ ...current, maxRefImages: Number(event.target.value) }))} />
          </div>
          <div className="switch-row" style={{ alignSelf: 'end' }}>
            <div>
              <strong>支持视频参考</strong>
              <div className="help-text">复刻时可参考原视频路径</div>
            </div>
            <button type="button" className={`toggle-pill ${modelForm.supportsVideoRef ? 'on' : ''}`} onClick={() => setModelForm((current) => ({ ...current, supportsVideoRef: !current.supportsVideoRef }))} aria-label="切换视频参考" />
          </div>
        </div>
        <div className="switch-row">
          <div>
            <strong>启用该模型</strong>
            <div className="help-text">关闭后前台模型下拉框立即隐藏</div>
          </div>
          <button type="button" className={`toggle-pill ${modelForm.enabled ? 'on' : ''}`} onClick={() => setModelForm((current) => ({ ...current, enabled: !current.enabled }))} aria-label="切换模型启用" />
        </div>
      </Modal>

      <Confirm
        open={Boolean(deleteTarget)}
        title={deleteTarget?.type === 'provider' ? '确认删除供应商' : '确认删除模型'}
        description={
          deleteTarget?.type === 'provider'
            ? `将删除供应商「${deleteTarget.provider.displayName}」及旗下全部模型配置，前台将无法继续使用这些模型。`
            : `将删除模型「${deleteTarget?.model?.displayName || ''}」，此操作不可恢复。`
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
      />
    </section>
  )
}
