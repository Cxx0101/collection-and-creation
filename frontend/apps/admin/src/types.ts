export type AdminUser = {
  id: number
  phone: string
  nickname: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  credits: number
  frozenCredits: number
  totalRecharged: number
  totalConsumed: number
  tokenVersion: number
  createdAt: string
  lastLoginAt?: string
}

export type CreditPackage = {
  id: number
  name: string
  badgeText: string
  description: string
  priceCents: number
  credits: number
  bonusCredits: number
  sortOrder: number
  enabled: boolean
  createdAt?: string
  updatedAt?: string
}

export type PaymentOrder = {
  id: number
  orderNo: string
  userId: number
  packageName: string
  amountCents: number
  credits: number
  bonusCredits: number
  channel: 'alipay' | 'wechat'
  gateway?: 'direct' | 'fyepay' | 'mock' | string
  status: string
  payUrl?: string
  paidAt?: string
  createdAt: string
}

export type ProviderModel = {
  id: number
  providerId: number
  modelId: string
  displayName: string
  capability: 'image' | 'video' | 'understanding' | string
  unit: string
  credits: number
  credits480p?: number
  credits720p?: number
  credits1080p?: number
  enabled: boolean
  supportsVideoRef: boolean
  maxRefImages: number
}

export type Provider = {
  id: number
  provider: string
  displayName: string
  baseUrl: string
  enabled: boolean
  sortOrder: number
  hasApiKey: boolean
  hasSecretKey: boolean
  models: ProviderModel[]
}

export type StorageConfig = {
  id: number
  provider: 'oss' | 'tos' | 'cos' | string
  endpoint: string
  region: string
  bucket: string
  accessKey: string
  publicBaseUrl: string
  enabled: boolean
  hasSecretKey: boolean
  updatedAt: string
}

export type TikhubConfig = {
  id: number
  baseUrl: string
  creditsPerPage: number
  proxyUrl: string
  videoLinkCredits: number
  platformPricing: Record<string, number> | null
  heatWeights: Record<string, number> | null
  enabled: boolean
  hasApiKey: boolean
}

export type StudioJob = {
  id: number
  ownerUserId: number
  tool: string
  toolName: string
  modelSource: string
  modelId: string
  modelLabel: string
  prompt: string
  params: string
  status: string
  creditsCharged: number
  creditsSettled: boolean
  resultCount: number
  errorMessage?: string
  createdAt: string
}

export type JobRow = { job: StudioJob; user: AdminUserBrief | null }
export type OrderRow = { order: PaymentOrder; user: AdminUserBrief | null }
export type LedgerRow = {
  transaction: {
    id: number
    userId: number
    kind: string
    bizType: string
    bizId: string
    deltaAvailable: number
    deltaFrozen: number
    deltaConsumed: number
    balanceAfter: number
    note: string
    createdAt: string
  }
  user: AdminUserBrief | null
}

export type AdminUserBrief = {
  id: number
  phone: string
  nickname: string
  role: string
  status: string
  credits: number
}

export type AdminStats = {
  totalUsers: number
  activeUsers: number
  todayNewUsers: number
  revenueCents: number
  todayConsumed: number
  activeJobs: number
  pendingOrders: number
  collectionPagesToday: number
  storage: { provider: string; bucket: string; enabled: boolean }
  tikhub: { enabled: boolean; baseUrl: string }
  payments: {
    alipayEnabled: boolean
    wechatEnabled: boolean
    alipayDirectEnabled?: boolean
    wechatDirectEnabled?: boolean
    fyepayEnabled?: boolean
    mockMode: boolean
    provider?: 'direct' | 'fyepay' | string
  }
}

export type TrendPoint = {
  date: string
  label: string
  rechargeCents: number
  consumedCredits: number
}
