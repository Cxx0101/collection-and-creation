import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, del } from '../api'
import { useApp } from '../AppContext'
import { ConfirmModal } from '../components'
import type { StudioJob } from '../types'
import {
  CloneIcon,
  DownloadIcon,
  FolderIcon,
  GridIcon,
  ProofMarkIcon,
  SearchIcon,
  StudioIcon,
  UserIcon,
  WalletIcon,
  CloseIcon,
} from '../icons'

const NAV_ITEMS = [
  { id: 'home', label: '广场', to: '/', icon: GridIcon },
  { id: 'collect', label: '采集', to: '/collect', icon: DownloadIcon },
  { id: 'studio', label: '创作', to: '/studio', icon: StudioIcon },
  { id: 'clone', label: '复刻', to: '/clone', icon: CloneIcon },
  { id: 'library', label: '资产', to: '/library', icon: FolderIcon },
  { id: 'credits', label: '积分', to: '/credits', icon: WalletIcon },
]

const MOBILE_ITEMS = [
  { id: 'home', label: '广场', to: '/', icon: GridIcon },
  { id: 'collect', label: '采集', to: '/collect', icon: DownloadIcon },
  { id: 'studio', label: '创作', to: '/studio', icon: StudioIcon },
  { id: 'clone', label: '复刻', to: '/clone', icon: CloneIcon },
  { id: 'credits', label: '积分', to: '/credits', icon: WalletIcon },
]

function navClass({ isActive }: { isActive: boolean }, base: string) {
  return `${base} ${isActive ? 'active' : ''}`
}

function activeRoot(pathname: string) {
  if (pathname.startsWith('/collect')) return 'collect'
  if (pathname.startsWith('/studio')) return 'studio'
  if (pathname.startsWith('/clone')) return 'clone'
  if (pathname.startsWith('/library')) return 'library'
  if (pathname.startsWith('/credits')) return 'credits'
  if (pathname.startsWith('/profile')) return 'profile'
  return 'home'
}

function statusLabel(status: string) {
  return (
    {
      running: '运行中',
      queued: '排队中',
      waiting_for_user: '待确认',
      succeeded: '已成功',
      failed: '已失败',
      cancelled: '已取消',
    }[status] || status
  )
}

function canDeleteJob(status: string) {
  return ['succeeded', 'failed', 'cancelled'].includes(status)
}

export default function AppLayout({ children }: { children?: ReactNode }) {
  const { user, logout, refreshUser, toast } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const current = activeRoot(location.pathname)
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [jobs, setJobs] = useState<StudioJob[]>([])
  const [deleteJob, setDeleteJob] = useState<StudioJob | null>(null)
  const [deletingJob, setDeletingJob] = useState(false)
  const completedRef = useRef<Set<number>>(new Set())

  const loadJobs = useCallback(async () => {
    try {
      const next = await api<StudioJob[]>('/studio/jobs')
      setJobs(next)
      const newlyCompleted = next.some(
        (job) => ['succeeded', 'failed', 'cancelled'].includes(job.status) && !completedRef.current.has(job.id),
      )
      next.forEach((job) => {
        if (['succeeded', 'failed', 'cancelled'].includes(job.status)) completedRef.current.add(job.id)
      })
      if (newlyCompleted) void refreshUser()
    } catch {
      // Transient polling failures should not replace the last visible task state.
    }
  }, [refreshUser])

  useEffect(() => {
    void loadJobs()
    const timer = window.setInterval(() => void loadJobs(), 10_000)
    return () => window.clearInterval(timer)
  }, [loadJobs])

  const openTasks = () => setDrawerOpen(true)
  const submitSearch = () => {
    if (!search.trim()) return
    if (/^https?:\/\//i.test(search.trim())) {
      navigate('/clone', { state: { sourceUrl: search.trim() } })
    } else {
      navigate('/studio', { state: { prompt: search.trim() } })
    }
  }

  const activeJobs = jobs.filter((job) => ['running', 'queued', 'waiting_for_user'].includes(job.status)).length

  const removeJob = async () => {
    if (!deleteJob || deletingJob) return
    const target = deleteJob
    setDeletingJob(true)
    try {
      await del<{ deleted: boolean }>(`/studio/jobs/${target.id}`)
      setJobs((current) => current.filter((job) => job.id !== target.id))
      completedRef.current.delete(target.id)
      setDeleteJob(null)
      toast(`任务 #${target.id} 已删除，产物仍保留在个人资产库`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '任务删除失败', 'error')
    } finally {
      setDeletingJob(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button type="button" className="brand" onClick={() => navigate('/')} aria-label="返回灵感广场">
            <span className="brand-mark" aria-hidden="true">
              <ProofMarkIcon size={17} />
            </span>
            <span className="brand-text">
              星芒创作 <span className="brand-en">SparkStudio</span>
            </span>
          </button>
          <div className="topbar-search">
            <SearchIcon size={15} />
            <input
              type="search"
              placeholder="搜索作品或粘贴链接"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitSearch()}
            />
          </div>
        </div>

        <div className="topbar-right">
          <button type="button" className="pill-btn" onClick={openTasks} aria-label="查看后台任务进度">
            {activeJobs > 0 ? <span className="task-dot" aria-hidden="true" /> : null}
            <span>任务</span>
            <span className="badge tabular">{activeJobs}</span>
          </button>

          <button type="button" className="pill-btn credit-pill" onClick={() => navigate('/credits')} aria-label="查看并充值共用积分">
            <WalletIcon size={15} />
            <span className="tabular">
              可用 <strong>{(user?.credits ?? 0).toLocaleString()}</strong>
            </span>
            <span className="credit-recharge-lbl">充值</span>
          </button>

          <button type="button" className="user-chip" onClick={() => navigate('/profile')} aria-label="个人中心与自定义模型绑定">
            <span className="avatar-circle">{user?.nickname?.charAt(0) || '创'}</span>
            <span>{user?.nickname || '创作者'}</span>
          </button>
        </div>
      </header>

      <nav className="rail" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink key={item.id} to={item.to} end={item.to === '/'} className={(state) => navClass(state, 'rail-item')}>
              <Icon size={19} />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
        <div className="rail-spacer" />
        <NavLink to="/profile" className={({ isActive }) => navClass({ isActive }, 'rail-item')}>
          <UserIcon size={19} />
          <span>我的</span>
        </NavLink>
      </nav>

      <nav className="mobile-tabs" aria-label="移动端主导航">
        {MOBILE_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink key={item.id} to={item.to} end={item.to === '/'} className={(state) => navClass(state, 'mobile-tab-btn')}>
              <Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <main className="main-wrap">
        <div className="container">{children ?? <Outlet context={{ openTasks }} />}</div>
      </main>

      {drawerOpen ? (
        <div className="drawer-backdrop open" onClick={(event) => event.target === event.currentTarget && setDrawerOpen(false)} role="dialog" aria-modal="true">
          <div className="drawer-panel">
            <div className="modal-head">
              <h3>异步任务与积分冻结状态</h3>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setDrawerOpen(false)}>
                关闭
              </button>
            </div>
            <div className="modal-body" style={{ flex: 1 }}>
              {jobs.length ? (
                jobs.map((job) => (
                  <div key={job.id} className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ fontSize: 13.5 }}>{job.toolName}</strong>
                      <span className={`badge ${job.status === 'succeeded' ? 'badge-success' : job.status === 'failed' ? 'badge-danger' : 'badge-warning'}`}>
                        {statusLabel(job.status)}
                      </span>
                    </div>
                    <div className="help-text">模型：{job.modelLabel || job.modelId || '平台默认'} · 消耗 {job.creditsCharged} 积分</div>
                    <div className="help-text tabular">任务 #{job.id} · {new Date(job.createdAt).toLocaleString()}</div>
                    {job.status === 'failed' && job.errorMessage ? (
                      <div className="help-text" style={{ color: 'var(--danger)' }}>失败原因：{job.errorMessage}</div>
                    ) : null}
                    {job.status === 'cancelled' ? (
                      <div className="help-text">任务已取消，冻结积分已原路退回。</div>
                    ) : null}
                    {canDeleteJob(job.status) ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        {job.status === 'succeeded' && job.resultCount > 0 ? (
                          <button
                            type="button"
                            className="text-button"
                            style={{ padding: 0 }}
                            onClick={() => {
                              setDrawerOpen(false)
                              navigate('/library', { state: { tab: 'assets' } })
                            }}
                          >
                            查看 {job.resultCount} 个产物 →
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-danger-outline btn-sm"
                          style={{ marginLeft: 'auto' }}
                          onClick={() => setDeleteJob(job)}
                        >
                          删除
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="help-text" style={{ textAlign: 'center', padding: '40px 10px' }}>
                  暂无进行中的异步任务
                </div>
              )}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/library', { state: { tab: 'assets' } })} style={{ marginTop: 8 }}>
                前往个人资产库查看产物
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  logout()
                  navigate('/login')
                }}
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(deleteJob)}
        title="确认删除"
        description={
          deleteJob
            ? `将删除任务 #${deleteJob.id}「${deleteJob.toolName}」的记录，已生成的产物仍保留在个人资产库。此操作不可恢复。`
            : ''
        }
        confirmText={deletingJob ? '删除中…' : '确认删除'}
        danger
        onCancel={() => {
          if (!deletingJob) setDeleteJob(null)
        }}
        onConfirm={() => void removeJob()}
      />
    </div>
  )
}
