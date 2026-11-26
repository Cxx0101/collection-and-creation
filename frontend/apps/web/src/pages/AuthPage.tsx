import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { post } from '../api'
import { useApp } from '../AppContext'
import { ProofMarkIcon } from '../icons'
import { ProofSheet } from '../ProofSheet'
import type { User } from '../types'

type AuthMode = 'login' | 'register'

const AUTH_PROOFS = [
  {
    src: '/pod-demos/virtual-try-on-after.jpg',
    alt: '服装上身生成样张',
    label: 'AI 穿衣',
    meta: '双图 / 上身',
  },
  {
    src: '/pod-demos/print-extract-after.jpg',
    alt: '印花提取样张',
    label: '印花提取',
    meta: '白底 / 透明',
  },
  {
    src: '/pod-demos/pose-variation-after.jpg',
    alt: '人物姿势裂变样张',
    label: '姿势裂变',
    meta: '多姿势 / 套图',
  },
]

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
  const contactAdmin = registration?.contactAdmin || '忘记密码请联系管理员在后台重置。'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const data = await post<{ token: string; user: User }>('/auth/login', { phone: phone.trim(), password })
        login(data.token, data.user)
        toast('登录成功', 'success')
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
        <aside className="auth-visual" aria-label="工作台介绍">
          <div className="auth-brand">
            <span className="brand-mark" aria-hidden="true">
              <ProofMarkIcon size={17} />
            </span>
            <span>
              <strong>星芒创作</strong>
              <small>SparkStudio</small>
            </span>
          </div>

          <div className="auth-visual-copy">
            <span className="home-kicker">POD 与电商创作工作台</span>
            <h1>把参考素材、商品图和视频放进同一套工作流</h1>
            <p>采集爆款、生成商品图、复刻视频，每次产物都自动进入个人资产库。</p>
          </div>

          <ProofSheet items={AUTH_PROOFS} compact label="产物示例" />

          {giftCredits > 0 ? (
            <div className="auth-register-note">
              新用户注册赠送 <strong className="tabular">{giftCredits}</strong> 积分
            </div>
          ) : null}
        </aside>

        <div className="auth-form-pane">
          <div className="auth-form-top">
            <div className="tabs-bar auth-mode-switch" aria-label="登录与注册切换">
              <Link className={`tab-btn ${mode === 'login' ? 'active' : ''}`} to="/login">
                登录
              </Link>
              <Link className={`tab-btn ${mode === 'register' ? 'active' : ''}`} to="/register">
                注册
              </Link>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/')}>
              返回工作台
            </button>
          </div>

          <div className="auth-form-heading">
            <h2>{mode === 'login' ? '登录' : '创建账号'}</h2>
            <p>{mode === 'login' ? '使用手机号和密码进入工作台' : '注册后直接进入创作工作台'}</p>
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
                <input className="input" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="用于工作台显示" autoComplete="nickname" />
              </label>
            ) : null}

            <label className="field">
              <span className="field-label">密码</span>
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
              <div className="auth-form-note">当前未启用短信验证码，填写手机号、昵称和密码即可注册。</div>
            ) : null}

            <button type="submit" className="btn btn-accent btn-lg auth-submit" disabled={loading}>
              {loading ? '正在处理…' : mode === 'login' ? '登录' : '注册并进入工作台'}
            </button>
          </form>

          <div className="auth-switch-copy">
            {mode === 'login' ? (
              <>
                还没有账号？
                <Link to="/register">注册</Link>
              </>
            ) : (
              <>
                已有账号？
                <Link to="/login">登录</Link>
              </>
            )}
          </div>

          <div className="auth-footnote">{mode === 'login' ? contactAdmin : '管理后台账号请使用独立后台地址登录。'}</div>
        </div>
      </div>
    </div>
  )
}
