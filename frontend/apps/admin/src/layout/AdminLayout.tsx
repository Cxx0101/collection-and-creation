import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAdmin } from '../AppContext'
import {
  CardIcon,
  CpuIcon,
  DatabaseIcon,
  LogoutIcon,
  OverviewIcon,
  PulseIcon,
  SearchIcon,
  ShieldIcon,
  UsersIcon,
} from '../icons'

const NAV = [
  { section: '运营总览', items: [{ to: '/overview', label: '全站概览与健康', Icon: OverviewIcon }] },
  {
    section: '用户与商业化',
    items: [
      { to: '/users', label: '用户与注册策略', Icon: UsersIcon },
      { to: '/credits', label: '积分套餐与支付通道', Icon: CardIcon },
    ],
  },
  {
    section: '核心基础设施配置',
    items: [
      { to: '/providers', label: '多供应商大模型与定价', Icon: CpuIcon },
      { to: '/collection', label: 'TikHub 采集与热度', Icon: SearchIcon },
      { to: '/storage', label: '媒体存储 (OSS/TOS/COS)', Icon: DatabaseIcon },
    ],
  },
  { section: '可观测与审计', items: [{ to: '/jobs', label: '全站任务与退费监控', Icon: PulseIcon }] },
]

const MOBILE = [
  ['/overview', '概览'],
  ['/users', '用户策略'],
  ['/credits', '套餐支付'],
  ['/providers', '模型定价'],
  ['/collection', 'TikHub'],
  ['/storage', '存储'],
  ['/jobs', '任务'],
]

export default function AdminLayout() {
  const { user, logout } = useAdmin()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  return (
    <div className="admin-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ShieldIcon size={18} />
          </span>
          <span>星芒创作 · 统一管理后台</span>
        </div>
        <div className="topbar-actions">
          <a className="btn btn-outline btn-sm" href="/" target="_blank" rel="noreferrer">
            打开前台
          </a>
          <div className="admin-user-menu" ref={userMenuRef}>
            <button
              type="button"
              className="user-chip"
              onClick={() => setMenuOpen((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="avatar-circle" style={{ width: 26, height: 26 }}>
                {user?.nickname?.charAt(0) || '管'}
              </span>
              <span>{user?.nickname || '管理员'}</span>
              <span className="user-menu-caret" aria-hidden="true">⌄</span>
            </button>
            {menuOpen ? (
              <div className="admin-user-dropdown" role="menu">
                <div className="admin-user-summary">
                  <strong>{user?.nickname || '管理员'}</strong>
                  <span className="tabular">{user?.phone}</span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="admin-user-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false)
                    logout()
                    navigate('/login')
                  }}
                >
                  <LogoutIcon size={15} />
                  退出管理后台
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <aside className="sidebar" aria-label="后台导航">
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="nav-section-label">{group.section}</div>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `side-btn ${isActive ? 'active' : ''}`}>
                <item.Icon size={17} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 18 }}>
         
        </div>
      </aside>

      <nav className="mobile-admin-bar" aria-label="移动端后台导航">
        {MOBILE.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline'}`}>
            {label}
          </NavLink>
        ))}
      </nav>

      <main className="main-wrap">
        <div className="container">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
