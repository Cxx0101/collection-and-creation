import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { post } from '../api'
import { useApp } from '../AppContext'
import type { User } from '../types'
import { SparkIcon } from '../icons'

type AuthMode = 'login' | 'register'

export default function AuthPage({ mode }: { mode: AuthMode }) {
  const { config, login, toast } = useApp()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [codeHint, setCodeHint] = useState('')

  const registration = config?.registration
  const smsRequired = Boolean(registration?.smsRequired)
  const giftCredits = registration?.giftCredits ?? 100
  const contactAdmin = registration?.contactAdmin || '当前已关闭短信验证码，忘记密码请联系管理员在后台重置。'

  const title = useMemo(() => (mode === 'login' ? '欢迎回来，继续创作' : '注册即刻开始创作'), [mode])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const data = await post<{ token: string; user: User }>('/auth/login', { phone: phone.trim(), password })
        login(data.token, data.user)
        toast('登录成功，欢迎回来', 'success')
        navigate('/')
      } else {
        if (!registration?.enabled) throw new Error('当前暂未开放注册，请联系管理员')
        const data = await post<{ token: string; user: User }>('/auth/register', {
          phone: phone.trim(),
          password,
          nickname: nickname.trim(),
          code: code.trim(),
        })
        login(data.token, data.user)
        toast(`注册成功${giftCredits > 0 ? `，已赠送 ${giftCredits} 积分` : ''}`, 'success')
        navigate('/')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const sendCode = async () => {
    setError('')
    try {
      const data = await post<{ sent: boolean; devCode?: string; note?: string }>('/auth/send-code', { phone: phone.trim(), scene: 'register' })
      setCodeHint(data.devCode ? `开发环境验证码：${data.devCode}` : data.note || '验证码已发送')
      toast('验证码已发送', 'success')
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证码发送失败')
    }
  }

  return (
    <div className="auth-route">
      <div className="auth-split">
        <div className="auth-visual">
          <div>
         
            <h2 style={{ margin: '18px 0 10px', fontSize: 26, fontWeight: 800, lineHeight: 1.25 }}>把爆款采集、AI 创作与复刻浓缩到同一个创作台</h2>
            <p style={{ margin: 0, color: '#D4D4D8', fontSize: 14, lineHeight: 1.65 }}>
              手机号注册无需人工审核直接激活，共用单一积分池，支持支付宝与微信支付即时充值。
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(0,0,0,0.25)', padding: 16, borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)' }}>
            <div style={{ fontSize: 12, color: '#D4D4D8' }}>新用户注册赠送：<strong>{giftCredits}</strong> 积分</div>
          </div>
        </div>

        <div className="auth-form-pane">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="tabs-bar auth-mode-switch" aria-label="登录与注册切换">
              <Link className={`tab-btn ${mode === 'login' ? 'active' : ''}`} to="/login">
                登录
              </Link>
              <Link className={`tab-btn ${mode === 'register' ? 'active' : ''}`} to="/register">
                快速注册
              </Link>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/')}>
              返回工作台
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span className="brand-mark" aria-hidden="true" style={{ width: 38, height: 38 }}>
              <SparkIcon size={18} />
            </span>
            <div>
              <h2>{title}</h2>
              <p>{mode === 'login' ? '使用手机号与密码登录你的创作空间' : '无需审核，完成后立即进入创作台'}</p>
            </div>
          </div>

          {error ? <div className="auth-error">{error}</div> : null}

          <form onSubmit={submit}>
            <label className="field">
              <span className="field-label">手机号</span>
              <input className="input tabular" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="请输入 11 位手机号" maxLength={11} autoComplete="tel" />
            </label>

            {mode === 'register' ? (
              <label className="field">
                <span className="field-label">昵称（选填）</span>
                <input className="input" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="如：陈小星" autoComplete="nickname" />
              </label>
            ) : null}

            <label className="field">
              <span className="field-label">登录密码</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>

            {mode === 'register' && smsRequired ? (
              <label className="field">
                <span className="field-label">
                  <span>短信验证码</span>
                  <button type="button" className="text-button" onClick={sendCode}>
                    获取验证码
                  </button>
                </span>
                <input className="input tabular" value={code} onChange={(event) => setCode(event.target.value)} placeholder="6 位验证码" maxLength={6} />
                {codeHint ? <span className="help-text" style={{ color: 'var(--success)' }}>{codeHint}</span> : null}
              </label>
            ) : null}

            {mode === 'register' && !smsRequired ? (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                当前未启用短信验证码，无需填写验证码即可注册。忘记密码请联系管理员在后台重置。
              </div>
            ) : null}

            <button type="submit" className="btn btn-accent btn-lg auth-submit" disabled={loading}>
              {loading ? '正在处理…' : mode === 'login' ? '登录创作台' : `注册并开始创作${giftCredits > 0 ? `（赠 ${giftCredits} 积分）` : ''}`}
            </button>
          </form>

          <div className="help-text" style={{ textAlign: 'center', lineHeight: 1.65 }}>
            {mode === 'login' ? (
              <>
                还没有账号？
                <Link to="/register" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                  立即注册
                </Link>
              </>
            ) : (
              <>
                已有账号？
                <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                  去登录
                </Link>
              </>
            )}
          </div>

          {mode === 'login' ? (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
              {smsRequired ? '忘记密码请联系管理员重置。' : contactAdmin}
              <br />
              管理后台账号请使用独立后台地址登录。
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
