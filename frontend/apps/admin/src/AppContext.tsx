import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'
import type { AdminUser } from './types'

type Toast = { id: number; message: string; type: 'default' | 'success' | 'error' }

type ContextValue = {
  user: AdminUser | null
  booting: boolean
  login: (token: string, user: AdminUser) => void
  logout: () => void
  refreshUser: () => Promise<AdminUser | null>
  toast: (message: string, type?: Toast['type']) => void
  toasts: Toast[]
  dismiss: (id: number) => void
}

const Context = createContext<ContextValue | null>(null)

export function AdminProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [booting, setBooting] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const toast = useCallback((message: string, type: Toast['type'] = 'default') => {
    const id = ++seq.current
    setToasts((current) => [...current.slice(-2), { id, message, type }])
    window.setTimeout(() => setToasts((current) => current.filter((row) => row.id !== id)), 3200)
  }, [])

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      return null
    }
    try {
      const fresh = await api<AdminUser>('/me')
      if (fresh.role !== 'admin') {
        setToken(null)
        setUser(null)
        return null
      }
      setUser(fresh)
      return fresh
    } catch {
      setToken(null)
      setUser(null)
      return null
    }
  }, [])

  useEffect(() => {
    void refreshUser().finally(() => setBooting(false))
  }, [refreshUser])

  const login = useCallback((token: string, nextUser: AdminUser) => {
    setToken(token)
    setUser(nextUser)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, booting, login, logout, refreshUser, toast, toasts, dismiss: (id: number) => setToasts((current) => current.filter((row) => row.id !== id)) }),
    [booting, login, logout, refreshUser, toast, toasts, user],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useAdmin() {
  const value = useContext(Context)
  if (!value) throw new Error('useAdmin must be used inside AdminProvider')
  return value
}
