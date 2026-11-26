import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { post } from '../api'
import { useAdmin } from '../AppContext'
import { ShieldIcon } from '../icons'
import type { AdminUser } from '../types'

export default function LoginPage() {
  const { login, toast } = useAdmin()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await post<{ token: string; user: AdminUser }>('/auth/login', { phone: phone.trim(), password })
      if (data.user.role !== 'admin') throw new Error('该账号没有管理后台访问权限')
      login(data.token, data.user)
      toast('管理员登录成功', 'success')
      navigate('/overview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-login">
      <div className="admin-login-visual">
        <span className="badge" style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', color: '#fff' }}>
          独立管理后台 · Admin only
        </span>
        <h1>一处管理全站用户、积分、模型与媒体基础设施</h1>
        <p>管理注册策略、支付宝/微信支付、TikHub 采集、多供应商模型定价与 OSS/TOS/COS 存储。</p>
        <div className="admin-login-grid">
          {[
            ['统一积分池', '采集与平台模型共用，可随时调整定价'],
            ['多供应商模型', '按能力打标，支持多实例与中转源'],
            ['媒体对象存储', '全站素材统一转存 OSS / TOS / COS'],
            ['全站任务审计', '冻结、结算、退费流水完整留痕'],
          ].map(([title, desc]) => (
            <div key={title}>
              <strong>{title}</strong>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="admin-login-pane">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="brand-mark" aria-hidden="true">
            <ShieldIcon size={19} />
          </span>
          <div>
            <h2>管理员登录</h2>
            <p>仅 role=admin 的账号可以进入此控制台</p>
          </div>
        </div>
        {error ? <div className="admin-login-error">{error}</div> : null}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="field">
            <span className="field-label">管理员手机号</span>
            <input className="input tabular" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="请输入管理员手机号" maxLength={11} autoComplete="username" />
          </label>
          <label className="field">
            <span className="field-label">登录密码</span>
            <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" autoComplete="current-password" />
          </label>
          <button className="btn btn-accent btn-lg" type="submit" disabled={busy}>
            {busy ? '正在验证权限…' : '进入管理后台'}
          </button>
        </form>
        <div className="help-text" style={{ lineHeight: 1.7 }}>
          C 端用户账号无法进入此后台。管理后台与前台分属不同入口、不同构建产物，但共用同一套 Go API 与 MySQL 数据。
        </div>
      </div>
    </div>
  )
}
