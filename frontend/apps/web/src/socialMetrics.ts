export type SocialMetrics = {
  likes: number
  comments: number
  saves: number
  shares: number
}

const EMPTY_METRICS: SocialMetrics = { likes: 0, comments: 0, saves: 0, shares: 0 }

export function parseSocialMetrics(raw?: string): SocialMetrics | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof SocialMetrics, number | string>>
    const metrics = {
      likes: Number(value.likes) || 0,
      comments: Number(value.comments) || 0,
      saves: Number(value.saves) || 0,
      shares: Number(value.shares) || 0,
    }
    return Object.values(metrics).some((item) => item > 0) ? metrics : null
  } catch {
    return null
  }
}

export function socialMetricsLine(raw?: string, scope: 'full' | 'engagement' = 'full') {
  const metrics = parseSocialMetrics(raw) || EMPTY_METRICS
  if (scope === 'engagement') {
    return `赞 ${formatMetric(metrics.likes)} · 藏 ${formatMetric(metrics.saves)}`
  }
  return `赞 ${formatMetric(metrics.likes)} · 评论 ${formatMetric(metrics.comments)} · 藏 ${formatMetric(metrics.saves)} · 转 ${formatMetric(metrics.shares)}`
}

export function formatMetric(value: number) {
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`
  return value.toLocaleString()
}
