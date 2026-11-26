import { type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminProvider, useAdmin } from './AppContext'
import { ToastHost } from './components'
import AdminLayout from './layout/AdminLayout'
import CollectionPage from './pages/CollectionPage'
import CreditsAdminPage from './pages/CreditsAdminPage'
import JobsPage from './pages/JobsPage'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/OverviewPage'
import ProvidersPage from './pages/ProvidersPage'
import StoragePage from './pages/StoragePage'
import UsersPage from './pages/UsersPage'

function AdminGuard({ children }: { children: ReactNode }) {
  const { user, booting } = useAdmin()
  if (booting) return <div className="admin-loading">正在验证管理员权限…</div>
  if (!user || user.role !== 'admin') return <Navigate to="/login" replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, booting } = useAdmin()
  if (booting) return <div className="admin-loading">正在加载管理后台…</div>
  if (user?.role === 'admin') return <Navigate to="/overview" replace />
  return <>{children}</>
}

function NotFound() {
  return (
    <section className="view-section active" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <span className="badge badge-dark">404</span>
        <h1 className="page-title" style={{ marginTop: 12 }}>管理页面不存在</h1>
        <a className="btn btn-primary" href="/admin/overview" style={{ marginTop: 16 }}>返回全站概览</a>
      </div>
    </section>
  )
}

export default function App() {
  return (
    <AdminProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <LoginPage />
            </GuestOnly>
          }
        />
        <Route
          element={
            <AdminGuard>
              <AdminLayout />
            </AdminGuard>
          }
        >
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="credits" element={<CreditsAdminPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="collection" element={<CollectionPage />} />
          <Route path="storage" element={<StoragePage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <ToastHost />
    </AdminProvider>
  )
}
