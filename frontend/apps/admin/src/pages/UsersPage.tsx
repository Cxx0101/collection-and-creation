import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, del, patch, post, put } from '../api'
import { useAdmin } from '../AppContext'
import { Confirm, Empty, Modal } from '../components'
import { Select } from '../Select'
import type { AdminUser } from '../types'

type SettingsPayload = { settings: Record<string, string>; secretsConfigured: Record<string, boolean> }

const EMPTY_USER = {
  phone: '',
  password: '',
  nickname: '',
  role: 'user',
  status: 'active',
  credits: 0,
}

export default function UsersPage() {
  const { toast } = useAdmin()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [search, setSearch] = useState('')
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [policy, setPolicy] = useState({
    enabled: true,
    smsRequired: false,
    giftCredits: 0,
    contactAdmin: '',
    smsSignName: '',
    smsTemplateCode: '',
  })
  const [userOpen, setUserOpen] = useState(false)
  const [userEdit, setUserEdit] = useState<AdminUser | null>(null)
  const [userForm, setUserForm] = useState(EMPTY_USER)
  const [creditTarget, setCreditTarget] = useState<AdminUser | null>(null)
  const [creditForm, setCreditForm] = useState({ delta: 0, note: '' })
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [tempPassword, setTempPassword] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [busy, setBusy] = useState(false)

  const loadUsers = useCallback(async () => {
    try {
      const query = new URLSearchParams({ page: '1', pageSize: '100' })
      const data = await api<{ list: AdminUser[]; total: number }>(`/admin/users?${query.toString()}`)
      setUsers(data.list)
    } catch (error) {
      toast(error instanceof Error ? error.message : '用户列表加载失败', 'error')
    }
  }, [toast])

  const loadSettings = useCallback(async () => {
    try {
      const data = await api<SettingsPayload>('/admin/settings')
      setSettings(data.settings)
      setPolicy({
        enabled: data.settings['registration.enabled'] === 'true',
        smsRequired: data.settings['registration.smsRequired'] === 'true',
        giftCredits: Number(data.settings['registration.giftCredits'] || 0),
        contactAdmin:
          data.settings['registration.contactAdmin'] ||
          '当前已关闭短信验证码，忘记密码请联系管理员在后台重置。',
        smsSignName: data.settings['sms.signName'] || '',
        smsTemplateCode: data.settings['sms.templateCode'] || '',
      })
    } catch (error) {
      toast(error instanceof Error ? error.message : '注册策略加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((user) => user.phone.includes(q) || user.nickname.toLowerCase().includes(q))
  }, [search, users])

  const savePolicy = async () => {
    setBusy(true)
    try {
      const next = {
        ...settings,
        'registration.enabled': String(policy.enabled),
        'registration.smsRequired': String(policy.smsRequired),
        'registration.giftCredits': String(policy.giftCredits),
        'registration.contactAdmin': policy.contactAdmin,
        'sms.signName': policy.smsSignName,
        'sms.templateCode': policy.smsTemplateCode,
      }
      await put('/admin/settings', { settings: next })
      setSettings(next)
      toast('注册策略与短信网关参数已保存并即时生效', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '策略保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const openUser = (user?: AdminUser) => {
    setUserEdit(user || null)
    setUserForm(
      user
        ? { phone: user.phone, password: '', nickname: user.nickname, role: user.role, status: user.status, credits: 0 }
        : EMPTY_USER,
    )
    setUserOpen(true)
  }

  const saveUser = async () => {
    setBusy(true)
    try {
      if (userEdit) {
        const row = await patch<AdminUser>(`/admin/users/${userEdit.id}`, {
          nickname: userForm.nickname,
          role: userForm.role,
        })
        setUsers((current) => current.map((user) => (user.id === row.id ? row : user)))
        toast('用户资料已更新', 'success')
      } else {
        const row = await post<AdminUser>('/admin/users', userForm)
        setUsers((current) => [row, ...current])
        toast('管理员已创建新用户', 'success')
      }
      setUserOpen(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : '用户保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const adjustCredits = async () => {
    if (!creditTarget || !creditForm.delta) return toast('请输入非零积分调整值', 'error')
    setBusy(true)
    try {
      const row = await post<AdminUser>(`/admin/users/${creditTarget.id}/credits`, creditForm)
      setUsers((current) => current.map((user) => (user.id === row.id ? row : user)))
      setCreditTarget(null)
      setCreditForm({ delta: 0, note: '' })
      toast('用户积分已调整并记录账本', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '积分调整失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const resetUserPassword = async () => {
    if (!resetTarget) return
    setBusy(true)
    try {
      const data = await post<{ temporaryPassword: string }>(`/admin/users/${resetTarget.id}/reset-password`, {
        newPassword: resetPassword.trim(),
      })
      setTempPassword(data.temporaryPassword)
      await loadUsers()
      toast('密码已重置，旧设备登录态立即失效', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '密码重置失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleUserStatus = async (target: AdminUser) => {
    const nextStatus = target.status === 'active' ? 'disabled' : 'active'
    setBusy(true)
    try {
      const row = await patch<AdminUser>(`/admin/users/${target.id}`, {
        nickname: target.nickname,
        role: target.role,
        status: nextStatus,
      })
      setUsers((current) => current.map((user) => (user.id === row.id ? row : user)))
      toast(nextStatus === 'active' ? '用户已启用，会话版本已刷新' : '用户已禁用，旧端已强制下线')
    } catch (error) {
      toast(error instanceof Error ? error.message : '用户状态切换失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeUser = async () => {
    if (!deleteTarget) return
    try {
      await del(`/admin/users/${deleteTarget.id}`)
      setUsers((current) => current.filter((user) => user.id !== deleteTarget.id))
      setDeleteTarget(null)
      toast('用户及其私有数据已删除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除用户失败', 'error')
    }
  }

  return (
    <section className="view-section active">
      <div className="page-head">
        <div>
          <h1 className="page-title">用户管理与注册安全策略</h1>
          <p className="page-sub">
            控制自主注册开关、短信验证码网关、新人赠分，以及关闭短信后管理员后台重置密码（立即递增 token_version）。
          </p>
        </div>
        <button type="button" className="btn btn-accent" onClick={() => openUser()}>
          + 新增用户
        </button>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>注册与短信验证码策略</h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void savePolicy()} disabled={busy}>
            保存策略配置
          </button>
        </div>
        <div className="grid-3">
          <div className="switch-row">
            <div>
              <strong>开放用户自主注册</strong>
              <div className="help-text">手机号注册，无需审核即刻激活</div>
            </div>
            <button
              type="button"
              className={`toggle-pill ${policy.enabled ? 'on' : ''}`}
              onClick={() => setPolicy((current) => ({ ...current, enabled: !current.enabled }))}
              aria-label="切换开放注册"
            />
          </div>
          <div className="switch-row">
            <div>
              <strong>开启短信验证码校验</strong>
              <div className="help-text">关闭后隐藏验证码，由管理员重置</div>
            </div>
            <button
              type="button"
              className={`toggle-pill ${policy.smsRequired ? 'on' : ''}`}
              onClick={() => setPolicy((current) => ({ ...current, smsRequired: !current.smsRequired }))}
              aria-label="切换短信验证码"
            />
          </div>
          <div className="switch-row">
            <div>
              <strong>新用户注册赠送积分</strong>
              <div className="help-text">注册完成即自动写入共享积分池</div>
            </div>
            <input
              className="input tabular"
              style={{ width: 96, height: 36, textAlign: 'right', fontWeight: 700 }}
              type="number"
              min={0}
              value={policy.giftCredits}
              onChange={(event) => setPolicy((current) => ({ ...current, giftCredits: Number(event.target.value) }))}
              aria-label="新用户注册赠送积分"
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">关闭短信时「忘记密码」联系管理员指引文案</span>
            <input
              className="input"
              value={policy.contactAdmin}
              onChange={(event) => setPolicy((current) => ({ ...current, contactAdmin: event.target.value }))}
            />
          </div>
          <div className="field">
            <span className="field-label">短信网关参数（仅开启短信时生效）</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input
                className="input"
                placeholder="签名：星芒创作"
                value={policy.smsSignName}
                onChange={(event) => setPolicy((current) => ({ ...current, smsSignName: event.target.value }))}
              />
              <input
                className="input"
                placeholder="模板 ID：SMS_465201"
                value={policy.smsTemplateCode}
                onChange={(event) => setPolicy((current) => ({ ...current, smsTemplateCode: event.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ maxWidth: 300 }}
            placeholder="搜索手机号或昵称..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="help-text">
            注意：管理员重置密码或禁用账号会立即递增 <code>token_version</code>，服务端校验到版本变化后强制旧端下线。
          </span>
        </div>

        {visibleUsers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>手机号</th>
                  <th>昵称</th>
                  <th>角色</th>
                  <th>可用积分</th>
                  <th>会话版本</th>
                  <th>状态</th>
                  <th>操作 (CRUD)</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => (
                  <tr key={user.id}>
                    <td className="tabular"><strong>{user.phone}</strong></td>
                    <td>{user.nickname}</td>
                    <td><span className={`badge ${user.role === 'admin' ? 'badge-dark' : ''}`}>{user.role}</span></td>
                    <td className="tabular"><strong>{user.credits.toLocaleString()}</strong></td>
                    <td className="tabular"><code>v{user.tokenVersion || 1}</code></td>
                    <td>
                      <span className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                        {user.status === 'active' ? '正常' : '已禁用'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => openUser(user)}>编辑</button>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => {
                            setCreditTarget(user)
                            setCreditForm({ delta: 0, note: '' })
                          }}
                        >
                          调账
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => {
                            setResetTarget(user)
                            setResetPassword('')
                            setTempPassword('')
                          }}
                        >
                          重置密码
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => void toggleUserStatus(user)} disabled={busy}>
                          {user.status === 'active' ? '禁用' : '启用'}
                        </button>
                        {user.role !== 'admin' ? (
                          <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setDeleteTarget(user)}>
                            删除
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>没有匹配的用户。</Empty>
        )}
      </div>

      <Modal
        open={userOpen}
        title={userEdit ? '编辑用户资料' : '后台新增用户'}
        onClose={() => setUserOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setUserOpen(false)}>取消</button>
            <button type="button" className="btn btn-accent" onClick={() => void saveUser()} disabled={busy}>
              {busy ? '保存中…' : '保存用户'}
            </button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field">
            <span className="field-label">手机号</span>
            <input
              className="input tabular"
              value={userForm.phone}
              onChange={(event) => setUserForm((current) => ({ ...current, phone: event.target.value }))}
              disabled={Boolean(userEdit)}
              maxLength={11}
            />
          </div>
          <div className="field">
            <span className="field-label">昵称</span>
            <input
              className="input"
              value={userForm.nickname}
              onChange={(event) => setUserForm((current) => ({ ...current, nickname: event.target.value }))}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">角色</span>
            <Select
              className="select"
              value={userForm.role}
              onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}
            >
              <option value="user">普通用户 (user)</option>
              <option value="admin">管理员 (admin)</option>
            </Select>
          </div>
          {!userEdit ? (
            <div className="field">
              <span className="field-label">初始积分</span>
              <input
                className="input tabular"
                type="number"
                min={0}
                value={userForm.credits}
                onChange={(event) => setUserForm((current) => ({ ...current, credits: Number(event.target.value) }))}
              />
            </div>
          ) : (
            <div className="field">
              <span className="field-label">当前状态</span>
              <input className="input" value={userEdit.status === 'active' ? '正常' : '已禁用'} disabled />
            </div>
          )}
        </div>
        {!userEdit ? (
          <div className="field">
            <span className="field-label">初始密码（至少 8 位）</span>
            <input
              className="input"
              type="password"
              value={userForm.password}
              onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(creditTarget)}
        title={`人工积分调账 · ${creditTarget?.nickname || ''}`}
        onClose={() => setCreditTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setCreditTarget(null)}>取消</button>
            <button type="button" className="btn btn-accent" onClick={() => void adjustCredits()} disabled={busy}>确认调账</button>
          </>
        }
      >
        <div className="help-text">
          当前余额：<strong className="tabular">{creditTarget?.credits || 0}</strong> 积分（调账将写入 <code>admin_adjust</code> 不可篡改流水）
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">调账方向</span>
            <Select
              className="select"
              value={creditForm.delta < 0 ? 'sub' : 'add'}
              onChange={(event) =>
                setCreditForm((current) => ({
                  ...current,
                  delta: (event.target.value === 'sub' ? -1 : 1) * Math.max(1, Math.abs(current.delta || 200)),
                }))
              }
            >
              <option value="add">增加积分 (+)</option>
              <option value="sub">扣减积分 (-)</option>
            </Select>
          </div>
          <div className="field">
            <span className="field-label">变动积分数量</span>
            <input
              className="input tabular"
              type="number"
              min={1}
              value={Math.abs(creditForm.delta) || ''}
              onChange={(event) => {
                const amount = Math.max(0, Number(event.target.value) || 0)
                setCreditForm((current) => ({ ...current, delta: (current.delta < 0 ? -1 : 1) * amount }))
              }}
            />
          </div>
        </div>
        <div className="field">
          <span className="field-label">操作备注</span>
          <input
            className="input"
            value={creditForm.note}
            onChange={(event) => setCreditForm((current) => ({ ...current, note: event.target.value }))}
            placeholder="如：客服补偿 / 异常退费"
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        title={`重置密码 · ${resetTarget?.phone || ''}`}
        onClose={() => {
          setResetTarget(null)
          setTempPassword('')
        }}
        footer={
          tempPassword ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setResetTarget(null)
                setTempPassword('')
              }}
            >
              完成
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-outline" onClick={() => setResetTarget(null)}>取消</button>
              <button type="button" className="btn btn-accent" onClick={() => void resetUserPassword()} disabled={busy}>
                确认重置并踢出旧会话
              </button>
            </>
          )
        }
      >
        {tempPassword ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="badge badge-success" style={{ alignSelf: 'flex-start' }}>重置成功</div>
            <div>请将以下临时密码安全地交给用户，页面关闭后不再展示：</div>
            <div className="card tabular" style={{ padding: 14, fontSize: 20, fontWeight: 800, textAlign: 'center', letterSpacing: '0.08em' }}>
              {tempPassword}
            </div>
            <div className="help-text">旧设备的登录状态已经失效，用户需使用新密码重新登录。</div>
          </div>
        ) : (
          <>
            <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: 'var(--warning)' }}>
              安全联动：重置密码后系统将立即把该用户的 <code>token_version</code> 从 v{resetTarget?.tokenVersion || 1} 递增至 v{(resetTarget?.tokenVersion || 1) + 1}，旧 JWT 随之下线。
            </div>
            <div className="field">
              <span className="field-label">设置新登录密码（留空自动生成 10 位随机密码）</span>
              <input
                className="input"
                type="text"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                placeholder="至少 8 位，留空自动生成"
              />
            </div>
          </>
        )}
      </Modal>

      <Confirm
        open={Boolean(deleteTarget)}
        title="确认删除用户"
        description={`将永久删除「${deleteTarget?.nickname || ''}」（${deleteTarget?.phone || ''}）及该用户的商品、素材、采集、任务与模型配置，此操作不可恢复。`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void removeUser()}
      />
    </section>
  )
}
