import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'
import type { PublicConfig, User } from './types'

type Toast = { id: number; message: string; type: 'default' | 'success' | 'error' }

type AppContextValue = {
  user: User | null
  config: PublicConfig | null
  booting: boolean
  login: (token: string, user: User) => void
  logout: () => void
  refreshUser: () => Promise<User | null>
  refreshConfig: () => Promise<void>
  toast: (message: string, type?: Toast['type']) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [booting, setBooting] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const toast = useCallback((message: string, type: Toast['type'] = 'default') => {
    const id = ++seq.current
    setToasts((current) => [...current.slice(-2), { id, message, type }])
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200)
  }, [])

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      return null
    }
    try {
      const fresh = await api<User>('/me')
      setUser(fresh)
      return fresh
    } catch {
      setToken(null)
      setUser(null)
      return null
    }
  }, [])

  const refreshConfig = useCallback(async () => {
    try {
      const fresh = await api<PublicConfig>('/public/config')
      setConfig(fresh)
    } catch {
      // The login screen remains usable with safe defaults if the API is restarting.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      await refreshConfig()
      if (getToken()) await refreshUser()
      if (!cancelled) setBooting(false)
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [refreshConfig, refreshUser])

  const login = useCallback((token: string, nextUser: User) => {
    setToken(token)
    setUser(nextUser)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      config,
      booting,
      login,
      logout,
      refreshUser,
      refreshConfig,
      toast,
      toasts,
      dismissToast: (id: number) => setToasts((current) => current.filter((t) => t.id !== id)),
    }),
    [booting, config, login, logout, refreshConfig, refreshUser, toast, toasts, user],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
