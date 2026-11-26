import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './AppContext'
import { LoadingScreen, ToastHost } from './components'
import AppLayout from './layout/AppLayout'
import AuthPage from './pages/AuthPage'
import ClonePage from './pages/ClonePage'
import CollectPage from './pages/CollectPage'
import CreditsPage from './pages/CreditsPage'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import ProfilePage from './pages/ProfilePage'
import StudioPage from './pages/StudioPage'

function AuthGuard({ children }: { children: ReactNode }) {
  const { user, booting } = useApp()
  const location = useLocation()

  if (booting) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, booting } = useApp()
  if (booting) return <LoadingScreen />
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

function NotFound() {
  return (
    <section className="view-section active" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
      <div>
        <span className="badge badge-accent">404</span>
        <h1 className="page-title" style={{ marginTop: 12 }}>
          页面不存在
        </h1>
        <p className="page-sub">你访问的页面可能已移动，返回灵感广场继续创作。</p>
        <a className="btn btn-primary" href="/" style={{ marginTop: 16 }}>
          返回灵感广场
        </a>
      </div>
    </section>
  )
}

function AppRoutes() {
  const { refreshConfig } = useApp()
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    void refreshConfig()
  }, [refreshConfig])

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <AuthPage mode="login" />
            </GuestOnly>
          }
        />
        <Route
          path="/register"
          element={
            <GuestOnly>
              <AuthPage mode="register" />
            </GuestOnly>
          }
        />

        <Route
          element={
            <AuthGuard>
              <AppLayout />
            </AuthGuard>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="collect" element={<CollectPage />} />
          <Route path="studio" element={<StudioPage />} />
          <Route path="clone" element={<ClonePage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="credits" element={<CreditsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <ToastHost />
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppRoutes />
    </AppProvider>
  )
}
