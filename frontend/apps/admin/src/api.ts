const TOKEN_KEY = 'sparkstudio_admin_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const res = await fetch(`/api/v1${path}`, { ...options, headers })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    if (res.status === 401) {
      setToken(null)
      if (!window.location.pathname.endsWith('/login')) window.location.href = '/admin/login'
    }
    throw new ApiError(payload?.message || `请求失败（${res.status}）`, res.status)
  }
  return payload.data as T
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) })
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })
