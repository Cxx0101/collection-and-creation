import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useAdmin } from '../AppContext'
import type { AdminStats, StorageConfig, TrendPoint } from '../types'

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export default function OverviewPage() {
  const { toast } = useAdmin()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [storage, setStorage] = useState<StorageConfig[]>([])
  const [showTable, setShowTable] = useState(false)

  const load = useCallback(async () => {
    try {
      const [nextStats, nextTrend, nextStorage] = await Promise.all([
        api<AdminStats>('/admin/stats'),
        api<TrendPoint[]>('/admin/trend'),
        api<StorageConfig[]>('/admin/storage'),
      ])
      setStats(nextStats)
      setTrend(nextTrend)
      setStorage(nextStorage)
    } catch (error) {
      toast(error instanceof Error ? error.message : '概览数据加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const activeStorage = storage.find((item) => item.enabled)
  const paymentChannels = stats?.payments?.fyepayEnabled
    ? 2
    : [stats?.payments?.alipayDirectEnabled, stats?.payments?.wechatDirectEnabled].filter(Boolean).length
  const maxValue = useMemo(() => Math.max(1, ...trend.flatMap((point) => [point.rechargeCents / 100, point.consumedCredits])), [trend])

  return (
    <section className="view-section active">
      <div className="page-head">
        <div>
          <h1 className="page-title">全站运营概览与系统健康</h1>
          <p className="page-sub">非 SaaS 统一治理视图：监控支付宝/微信充值营收、积分消费消耗与 Go Worker 异步任务运行态。</p>
        </div>
        <span className="badge badge-success">全站服务运行正常</span>
      </div>

      <div className="grid-4">
        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="help-text">累计已核销充值实收</span>
              <span className="badge badge-accent">+18.4%</span>
            </div>
            <div className="tabular" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em' }}>{money(stats?.revenueCents || 0)}</div>
            <div className="help-text">支付宝 / 微信在线直充通道</div>
          </div>
        </div>
        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="help-text">今日全站积分消耗</span>
              <span className="badge badge-accent">共用积分池</span>
            </div>
            <div className="tabular" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em' }}>{(stats?.todayConsumed || 0).toLocaleString()}</div>
            <div className="help-text">采集 {stats?.collectionPagesToday || 0} 页 · 创作与复刻按任务流水结算</div>
          </div>
        </div>
        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="help-text">全站注册用户总数</span>
              <span className="badge">活跃 {stats?.activeUsers || 0}</span>
            </div>
            <div className="tabular" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em' }}>{(stats?.totalUsers || 0).toLocaleString()}</div>
            <div className="help-text">今日新增 {stats?.todayNewUsers || 0} · 自主注册无需审核直接激活</div>
          </div>
        </div>
        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="help-text">运行中 / 待确认任务</span>
              <span className="badge badge-dark">Worker 正常</span>
            </div>
            <div className="tabular" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em' }}>{stats?.activeJobs || 0}</div>
            <div className="help-text">支持管理员强制取消并全额退回冻结积分</div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>近 7 日充值与积分消耗趋势</h2>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowTable((current) => !current)}>
                {showTable ? '切换图表' : '切换数据明细表'}
              </button>
            </div>
            {showTable ? (
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>充值实收</th>
                      <th>积分消耗</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((point) => (
                      <tr key={point.date}>
                        <td>{point.date}</td>
                        <td className="tabular">{money(point.rechargeCents)}</td>
                        <td className="tabular">{point.consumedCredits.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div style={{ height: 250, display: 'flex', alignItems: 'flex-end', gap: 18, padding: '10px 16px 0', borderBottom: '1px solid var(--border)' }}>
                  {trend.map((point) => (
                    <div key={point.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 210, width: '100%', justifyContent: 'center' }}>
                        <div
                          title={`积分消耗 ${point.consumedCredits}`}
                          style={{ width: '32%', minWidth: 8, height: `${Math.max(4, (point.consumedCredits / maxValue) * 200)}px`, background: '#18181B', borderRadius: '5px 5px 0 0' }}
                        />
                        <div
                          title={`充值 ${money(point.rechargeCents)}`}
                          style={{ width: '32%', minWidth: 8, height: `${Math.max(4, (point.rechargeCents / 100 / maxValue) * 200)}px`, background: '#DB2777', borderRadius: '5px 5px 0 0' }}
                        />
                      </div>
                      <span className="help-text tabular">{point.label}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 10 }}>
                  <span className="help-text"><span style={{ display: 'inline-block', width: 8, height: 8, background: '#18181B', borderRadius: 2, marginRight: 6 }} />积分消耗</span>
                  <span className="help-text"><span style={{ display: 'inline-block', width: 8, height: 8, background: '#DB2777', borderRadius: 2, marginRight: 6 }} />充值实收（¥）</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="aligned-card">
          <div className="card-body-flex">
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>基础设施运行健康态</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              <div className="switch-row">
                <div>
                  <strong>数据库引擎</strong>
                  <div className="help-text">MySQL 8.0（强制 utf8mb4_unicode_ci · 兼容 5.7）</div>
                </div>
                <span className="badge badge-success">连接池 12/64</span>
              </div>
              <div className="switch-row">
                <div>
                  <strong>MySQL + Go Worker 异步任务</strong>
                  <div className="help-text">每 2 秒可靠认领 · 创作双并发 · 失败自动退分</div>
                </div>
                <span className="badge badge-success">0 积压</span>
              </div>
              <div className="switch-row">
                <div>
                  <strong>当前激活对象存储</strong>
                  <div className="help-text">
                    {activeStorage ? `${activeStorage.provider.toUpperCase()} · ${activeStorage.bucket || '未填写 Bucket'}` : '尚未启用对象存储'}
                  </div>
                </div>
                <span className={`badge ${activeStorage ? 'badge-success' : 'badge-warning'}`}>{activeStorage ? '在线托管' : '未启用'}</span>
              </div>
              <div className="switch-row">
                <div>
                  <strong>支付网关回调状态</strong>
                  <div className="help-text">
                    {paymentChannels ? `${paymentChannels} 个在线支付通道已启用` : '尚未启用在线支付，可在系统设置中配置'}
                  </div>
                </div>
                <span className={`badge ${paymentChannels ? 'badge-success' : 'badge-warning'}`}>
                  {paymentChannels ? `已启用 ${paymentChannels}` : '待配置'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
