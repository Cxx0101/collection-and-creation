export type User = {
  id: number
  phone: string
  nickname: string
  role: 'admin' | 'user'
  status: string
  credits: number
  frozenCredits: number
  totalRecharged: number
  totalConsumed: number
  createdAt?: string
  lastLoginAt?: string
}

export type PublicConfig = {
  registration: { enabled: boolean; smsRequired: boolean; giftCredits: number; contactAdmin: string }
  site: { name: string }
  packages: CreditPackage[]
  models: ModelOption[]
  collection: { creditsPerPage: number; enabled: boolean }
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
}

export type ModelOption = {
  id: number | string
  providerId?: number
  provider: string
  providerName: string
  modelId: string
  displayName: string
  capability: 'image' | 'video' | 'understanding'
  unit: string
  credits: number
  credits480p?: number
  credits720p?: number
  credits1080p?: number
  supportsVideoRef?: boolean
  maxRefImages?: number
  value: string
  source?: 'platform' | 'custom'
}

export type ModelCatalog = { platform: ModelOption[]; custom: ModelOption[] }

export type Asset = {
  id: number
  jobId: number
  name: string
  kind: 'image' | 'video' | 'markdown' | string
  source: string
  size: string
  url: string
  seed: number
  createdAt: string
}

export type ProductImage = { id?: number; name: string; url?: string; seed: number; sortOrder?: number }
export type Product = {
  id: number
  name: string
  description: string
  seed: number
  images: ProductImage[]
}

export type CollectionItem = {
  id: number
  batchId: number
  platform: 'douyin' | 'xiaohongshu' | 'tiktok' | string
  externalId: string
  title: string
  description?: string
  author: string
  heat: number
  metrics?: string
  contentType?: 'video' | 'image' | string
  duration?: number
  url: string
  coverUrl: string
  seed: number
  saved: boolean
  createdAt: string
}

export type CollectionBatch = {
  id: number
  platform: string
  keyword: string
  pages: number
  pagesFetched: number
  creditsCharged: number
  status: string
  itemCount: number
  mode: string
  contentType?: string
  publishedDays?: number
  errorMessage?: string
  updatedAt?: string
  createdAt: string
}

export type Skill = {
  id: number
  name: string
  description: string
  content: string
  builtin: boolean
}

export type Workflow = {
  id: number
  name: string
  schedule: string
  enabled: boolean
  nodes: string
  estimatedCredits: number
  lastRun: string
}

export type CloneDraft = {
  id: number
  title: string
  sourceUrl: string
  platform: string
  status: string
  seed: number
  createdAt: string
}

export type UserProvider = {
  id: number
  provider: string
  displayName: string
  baseUrl: string
  models: string
  capability: string
  enabled: boolean
  hasApiKey: boolean
  hasSecretKey: boolean
}

export type RemoteModelOption = {
  id: string
  displayName?: string
  ownedBy?: string
  capability?: string
}

export type WechatAccount = {
  id: number
  accountName: string
  appId: string
  enabled: boolean
  hasSecret: boolean
}

export type PaymentOrder = {
  id: number
  orderNo: string
  packageName: string
  amountCents: number
  credits: number
  bonusCredits: number
  channel: 'alipay' | 'wechat'
  gateway?: 'direct' | 'fyepay' | 'mock' | string
  status: string
  payUrl?: string
  payMode?: 'qrcode' | 'redirect' | string
  qrCodeUrl?: string
  externalTradeNo?: string
  createdAt: string
  paidAt?: string
}

export type CreditTransaction = {
  id: number
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

export type StudioJob = {
  id: number
  tool: string
  toolName: string
  modelSource: string
  modelId: string
  modelLabel: string
  prompt: string
  params: string
  status: string
  creditsCharged: number
  creditsSettled?: boolean
  resultCount: number
  remoteTaskId?: string
  errorMessage?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
}

export type StudioTool = {
  id: string
  group: 'base' | 'pod' | 'retouch'
  name: string
  tag: string
  desc: string
}

export type UploadSlot = { id: string; name: string; seed: number; url?: string; kind?: string }
