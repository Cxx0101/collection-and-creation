import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, post } from '../api'
import { useApp } from '../AppContext'
import { EmptyState, Modal } from '../components'
import { Select } from '../Select'
import type { CreditPackage, CreditTransaction, PaymentOrder } from '../types'

type ChecksTab = 'orders' | 'ledger'

const CHANNEL_LABELS: Record<string, string> = { alipay: '支付宝', wechat: '微信支付' }
const STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  failed: '支付发起失败',
  closed: '已关闭',
  refunded: '已退款',
}

function money(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`
}

function ledgerKind(kind: string) {
  return (
    {
      recharge: '充值到账',
      reserve: '任务冻结',
      settle: '任务结算',
      refund: '冻结退回',
      register_bonus: '注册赠送',
      admin_adjust: '管理员调整',
    }[kind] || kind
  )
}

export default function CreditsPage() {
  const { config, user, toast, refreshUser, refreshConfig } = useApp()
  const [params, setParams] = useSearchParams()
  const [packages, setPackages] = useState<CreditPackage[]>(config?.packages || [])
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [ledger, setLedger] = useState<CreditTransaction[]>([])
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null)
  const [channel, setChannel] = useState<'alipay' | 'wechat'>('alipay')
  const [checkout, setCheckout] = useState<{ order: PaymentOrder; mockMode: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [historyTab, setHistoryTab] = useState<ChecksTab>('orders')
  const [orderFilter, setOrderFilter] = useState('all')
  const [receiptOrder, setReceiptOrder] = useState<PaymentOrder | null>(null)

  const load = useCallback(async () => {
    try {
      const [packageList, orderList, ledgerList] = await Promise.all([
        api<CreditPackage[]>('/credit/packages'),
        api<PaymentOrder[]>('/credit/orders'),
        api<CreditTransaction[]>('/credit/ledger'),
      ])
      setPackages(packageList)
      setOrders(orderList)
      setLedger(ledgerList)
      setSelectedPackageId((current) => (packageList.some((pkg) => pkg.id === current) ? current : packageList[0]?.id ?? null))
    } catch (error) {
      toast(error instanceof Error ? error.message : '积分数据加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void refreshConfig()
  }, [refreshConfig])

  useEffect(() => {
    const syncConfig = () => {
      if (document.visibilityState === 'visible') void refreshConfig()
    }
    window.addEventListener('focus', syncConfig)
    document.addEventListener('visibilitychange', syncConfig)
    return () => {
      window.removeEventListener('focus', syncConfig)
      document.removeEventListener('visibilitychange', syncConfig)
    }
  }, [refreshConfig])

  useEffect(() => {
    const orderNo = params.get('mockOrder')
    if (!orderNo) return
    void api<PaymentOrder>(`/credit/orders/${orderNo}`)
      .then((order) => setCheckout({ order, mockMode: true }))
      .catch(() => {
        toast('未找到该订单，请重新发起支付', 'error')
        params.delete('mockOrder')
        setParams(params, { replace: true })
      })
  }, [params, setParams, toast])

  useEffect(() => {
    if (!checkout || checkout.order.status === 'paid') return
    const timer = window.setInterval(() => {
      void api<PaymentOrder>(`/credit/orders/${checkout.order.orderNo}`)
        .then((order) => {
          setCheckout((current) => (current ? { ...current, order } : current))
          if (order.status === 'paid') {
            void refreshUser()
            void load()
          }
        })
        .catch(() => undefined)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [checkout, load, refreshUser])

  const selectedPackage = packages.find((pkg) => pkg.id === selectedPackageId) || null
  const filteredOrders = useMemo(
    () => orders.filter((order) => orderFilter === 'all' || order.status === orderFilter),
    [orderFilter, orders],
  )

  const selectedTotal = selectedPackage ? selectedPackage.credits + selectedPackage.bonusCredits : 0
  const fyepayAvailable = Boolean(
    config?.payments &&
      config.payments.provider === 'fyepay' &&
      (config.payments.fyepayEnabled ?? true),
  )
  const alipayAvailable = Boolean(
    config?.payments.alipayDirectEnabled ?? config?.payments.alipayEnabled,
  )
  const wechatAvailable = Boolean(
    config?.payments.wechatDirectEnabled ?? config?.payments.wechatEnabled,
  )
  const mockOnly = Boolean(
    config?.payments.mockMode && !fyepayAvailable && !alipayAvailable && !wechatAvailable,
  )
  const hasPaymentMethod = fyepayAvailable || alipayAvailable || wechatAvailable || mockOnly
  const paymentLabel = fyepayAvailable
    ? `合众纵横聚合 · ${CHANNEL_LABELS[channel]}`
    : mockOnly
      ? '开发测试支付'
      : CHANNEL_LABELS[channel]
  const checkoutGatewayLabel = checkout?.order.gateway === 'fyepay'
    ? '合众纵横聚合'
    : checkout?.mockMode
      ? '开发测试'
      : '在线支付'

  useEffect(() => {
    if (fyepayAvailable) return
    if (!alipayAvailable && wechatAvailable) {
      setChannel('wechat')
      return
    }
    if (!wechatAvailable && alipayAvailable) {
      setChannel('alipay')
      return
    }
    if (mockOnly) setChannel('alipay')
  }, [alipayAvailable, fyepayAvailable, mockOnly, wechatAvailable])

  const createOrder = async () => {
    if (!selectedPackage) return toast('请先选择积分套餐', 'error')
    setBusy(true)
    try {
      const data = await post<{ order: PaymentOrder; mockMode: boolean }>('/credit/orders', {
        packageId: selectedPackage.id,
        channel,
      })
      setCheckout(data)
      setOrders((current) => [data.order, ...current.filter((order) => order.id !== data.order.id)])
      toast(data.mockMode ? '测试订单已创建，请在收银台完成模拟支付' : '订单已创建，请打开支付通道完成付款', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '订单创建失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const mockPay = async () => {
    if (!checkout) return
    setBusy(true)
    try {
      const data = await post<{ order: PaymentOrder; credits: number }>(`/credit/orders/${checkout.order.orderNo}/mock-pay`)
      setCheckout((current) => (current ? { ...current, order: data.order } : current))
      await refreshUser()
      await load()
      toast(`支付成功，${checkout.order.credits + checkout.order.bonusCredits} 积分已到账`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '支付失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const closeCheckout = () => {
    setCheckout(null)
    if (params.get('mockOrder')) {
      params.delete('mockOrder')
      setParams(params, { replace: true })
    }
  }

  return (
    <section id="view-credits" className="view-section active" aria-label="积分充值与收银台">
      <div className="page-head">
        <div>
          <h1 className="page-title">积分与充值</h1>
          <p className="page-sub">采集和平台模型共用积分池；支付通道与价格以管理员当前配置为准。</p>
        </div>
      </div>

      <div className="wallet-banner">
        <div>
          <div className="wallet-metric-label">当前可用积分（全站采集与平台模型通用）</div>
          <div className="wallet-metric-val tabular" id="walletAvailableBig">{(user?.credits ?? 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="wallet-metric-label">任务冻结中积分</div>
          <div className="wallet-sub-val tabular" id="walletFrozenBig">{(user?.frozenCredits ?? 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="wallet-metric-label">累计充值积分</div>
          <div className="wallet-sub-val tabular" id="walletTotalRecharged">{(user?.totalRecharged ?? 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="wallet-metric-label">累计消耗积分</div>
          <div className="wallet-sub-val tabular" id="walletTotalConsumed">{(user?.totalConsumed ?? 0).toLocaleString()}</div>
        </div>
      </div>

      {!checkout ? (
        <div id="creditsMainFlow">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="grid-4" style={{ marginBottom: 4 }}>
              <div className="card" style={{ padding: '14px 16px' }}>
                <div className="help-text">TikHub 采集</div>
                <strong className="tabular" style={{ fontSize: 16 }}>{config?.collection.creditsPerPage ?? 10} 积分 / 页</strong>
                <div className="help-text">按实际拉取页数实扣</div>
              </div>
              <div className="card" style={{ padding: '14px 16px' }}>
                <div className="help-text">平台 AI 生图</div>
                <strong className="tabular" style={{ fontSize: 16 }}>12–18 积分 / 张</strong>
                <div className="help-text">含套图 / 精修 / 重绘</div>
              </div>
              <div className="card" style={{ padding: '14px 16px' }}>
                <div className="help-text">平台 AI 生视频</div>
                <strong className="tabular" style={{ fontSize: 16 }}>5–8 积分 / 秒</strong>
                <div className="help-text">支持 1080p 规格系数</div>
              </div>
              <div className="card" style={{ padding: '14px 16px' }}>
                <div className="help-text">自有接口直连</div>
                <strong className="tabular" style={{ fontSize: 16, color: 'var(--success)' }}>0 积分</strong>
                <div className="help-text">在个人中心绑定即可使用</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>1. 选择充值套餐</h2>
              <span className="help-text">积分套餐由管理员在后台实时维护，多买多送</span>
            </div>

            {packages.length ? (
              <div className="grid-4">
                {packages.map((pkg) => {
                  const active = selectedPackageId === pkg.id
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      className={`package-card ${active ? 'selected' : ''}`}
                      style={{ textAlign: 'left', color: 'inherit' }}
                      onClick={() => setSelectedPackageId(pkg.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                        <strong style={{ fontSize: 15.5 }}>{pkg.name}</strong>
                        <span className={`badge ${active ? 'badge-accent' : ''}`}>{pkg.badgeText || '积分套餐'}</span>
                      </div>
                      <div className="tabular" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
                        {money(pkg.priceCents)}
                      </div>
                      <div className="tabular" style={{ margin: '8px 0 12px', fontSize: 13.5, fontWeight: 600, color: 'var(--accent)' }}>
                        到账 {(pkg.credits + pkg.bonusCredits).toLocaleString()} 积分（{pkg.credits.toLocaleString()} 基础 + {pkg.bonusCredits.toLocaleString()} 赠送）
                      </div>
                      <p className="help-text" style={{ margin: 0, flex: 1 }}>
                        {pkg.description || '共用积分池，采集与平台模型通用'}
                      </p>
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span className="help-text tabular">
                          折合 ¥{(pkg.priceCents / 100 / Math.max(1, pkg.credits + pkg.bonusCredits)).toFixed(3)} / 分
                        </span>
                        <span style={{ fontWeight: 600, fontSize: 12.5, color: active ? 'var(--ink)' : 'var(--muted)' }}>
                          {active ? '已选定' : '点击选择'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <EmptyState>管理员尚未发布可用积分套餐，请稍后再试或联系管理员。</EmptyState>
            )}
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>2. 选择支付方式</h2>
            {fyepayAvailable ? (
              <div className="pay-gateway-card selected">
                <div className="pay-gateway-head">
                  <span className="pay-gateway-mark">合</span>
                  <div className="pay-gateway-copy">
                    <div className="pay-gateway-title">
                      <strong>合众纵横聚合支付</strong>
                      <span className="badge badge-success">已启用</span>
                    </div>
                    <div className="help-text">由 Fyepay 统一收款，支持支付宝与微信扫码即时到账</div>
                  </div>
                  <span className="badge badge-accent">推荐</span>
                </div>
                <div className="pay-gateway-channels" role="group" aria-label="聚合支付渠道">
                  <button
                    type="button"
                    className={`pay-gateway-channel ${channel === 'alipay' ? 'active' : ''}`}
                    onClick={() => setChannel('alipay')}
                    aria-pressed={channel === 'alipay'}
                  >
                    <span className="pay-mini-logo alipay">支</span>
                    支付宝支付
                  </button>
                  <button
                    type="button"
                    className={`pay-gateway-channel ${channel === 'wechat' ? 'active' : ''}`}
                    onClick={() => setChannel('wechat')}
                    aria-pressed={channel === 'wechat'}
                  >
                    <span className="pay-mini-logo wechat">微</span>
                    微信支付
                  </button>
                </div>
              </div>
            ) : (
              <div className="pay-channel-grid">
                {alipayAvailable ? (
                  <button
                    type="button"
                    className={`pay-channel-card alipay ${channel === 'alipay' ? 'selected' : ''}`}
                    onClick={() => setChannel('alipay')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 40, height: 40, borderRadius: 10, background: '#1677FF', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 15 }}>支</span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 600, fontSize: 14.5 }}>支付宝支付</div>
                        <div className="help-text">支持支付宝 App 扫码 / 网页当面付</div>
                      </div>
                    </div>
                    <span className="badge" style={{ borderColor: '#93C5FD', color: '#1D4ED8', background: '#EFF6FF' }}>已启用</span>
                  </button>
                ) : null}
                {wechatAvailable ? (
                  <button
                    type="button"
                    className={`pay-channel-card wechat ${channel === 'wechat' ? 'selected' : ''}`}
                    onClick={() => setChannel('wechat')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 40, height: 40, borderRadius: 10, background: '#07C160', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 15 }}>微</span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 600, fontSize: 14.5 }}>微信支付</div>
                        <div className="help-text">支持微信 Native V3 扫码即时到账</div>
                      </div>
                    </div>
                    <span className="badge badge-success">已启用</span>
                  </button>
                ) : null}
                {mockOnly ? (
                  <button
                    type="button"
                    className={`pay-channel-card mock ${channel === 'alipay' ? 'selected' : ''}`}
                    onClick={() => setChannel('alipay')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className="pay-mock-logo">测</span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 600, fontSize: 14.5 }}>开发测试支付</div>
                        <div className="help-text">管理员尚未启用真实支付通道，仅用于本地流程调试</div>
                      </div>
                    </div>
                    <span className="badge badge-warning">沙箱</span>
                  </button>
                ) : null}
                {!hasPaymentMethod ? (
                  <div className="payment-unavailable-note">
                    管理员尚未启用在线支付通道，请联系管理员完成支付配置。
                  </div>
                ) : null}
              </div>
            )}
            {config?.payments.mockMode ? (
              <div className="payment-mock-note">
                当前开发环境使用测试支付通道，订单会进入沙箱收银台，不会产生真实扣款。
              </div>
            ) : null}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingTop: 14, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14 }}>
                {selectedPackage ? (
                  <>
                    已选 <strong>{selectedPackage.name}</strong>
                    （共得 <strong className="tabular" style={{ color: 'var(--accent)' }}>{selectedTotal.toLocaleString()}</strong> 积分）· 实付{' '}
                    <strong className="tabular" style={{ fontSize: 18 }}>{money(selectedPackage.priceCents)}</strong>
                    （{paymentLabel}）
                  </>
                ) : (
                  '请先选择充值套餐'
                )}
              </div>
              <button type="button" className="btn btn-accent btn-lg" onClick={() => void createOrder()} disabled={busy || !selectedPackage || !hasPaymentMethod}>
                {busy ? '正在创建订单…' : '立即前往支付收银台'}
              </button>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div className="tabs-bar">
                <button type="button" className={`tab-btn ${historyTab === 'orders' ? 'active' : ''}`} onClick={() => setHistoryTab('orders')}>
                  充值订单记录
                </button>
                <button type="button" className={`tab-btn ${historyTab === 'ledger' ? 'active' : ''}`} onClick={() => setHistoryTab('ledger')}>
                  积分消费与冻结账本
                </button>
              </div>
              {historyTab === 'orders' ? (
                <Select className="select" style={{ width: 160, height: 36 }} value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)}>
                  <option value="all">全部订单状态</option>
                  <option value="pending">待支付</option>
                  <option value="paid">已支付</option>
                  <option value="closed">已关闭</option>
                </Select>
              ) : (
                <span className="help-text">每笔冻结、结算、退费及充值均按幂等流水永久留痕</span>
              )}
            </div>

            {historyTab === 'orders' ? (
              filteredOrders.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>订单号</th>
                        <th>套餐名称</th>
                        <th>支付渠道</th>
                        <th>实付金额</th>
                        <th>到账积分</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map((order) => (
                        <tr key={order.id}>
                          <td className="tabular">{order.orderNo}</td>
                          <td>{order.packageName}</td>
                          <td>{CHANNEL_LABELS[order.channel] || order.channel}</td>
                          <td className="tabular">{money(order.amountCents)}</td>
                          <td className="tabular">{order.credits + order.bonusCredits}</td>
                          <td>
                            <span className={`badge ${order.status === 'paid' ? 'badge-success' : order.status === 'pending' ? 'badge-warning' : ''}`}>
                              {STATUS_LABELS[order.status] || order.status}
                            </span>
                          </td>
                          <td>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => setReceiptOrder(order)}>
                              查看回单
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState>暂无充值订单。</EmptyState>
              )
            ) : ledger.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>业务</th>
                      <th>可用变动</th>
                      <th>冻结变动</th>
                      <th>实际消耗</th>
                      <th>变动后余额</th>
                      <th>备注</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((row) => (
                      <tr key={row.id}>
                        <td>{ledgerKind(row.kind)}</td>
                        <td className="tabular">{row.bizType}{row.bizId ? ` #${row.bizId}` : ''}</td>
                        <td className={`tabular ${row.deltaAvailable > 0 ? '' : ''}`} style={{ color: row.deltaAvailable > 0 ? 'var(--success)' : row.deltaAvailable < 0 ? 'var(--danger)' : undefined }}>
                          {row.deltaAvailable > 0 ? '+' : ''}{row.deltaAvailable}
                        </td>
                        <td className="tabular">{row.deltaFrozen > 0 ? '+' : ''}{row.deltaFrozen}</td>
                        <td className="tabular">{row.deltaConsumed || '—'}</td>
                        <td className="tabular">{row.balanceAfter}</td>
                        <td>{row.note}</td>
                        <td>{new Date(row.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState>暂无积分流水。</EmptyState>
            )}
          </div>
        </div>
      ) : (
        <div id="creditsCheckoutFlow" className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 780, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <span className="badge badge-accent">{checkoutGatewayLabel} · {CHANNEL_LABELS[checkout.order.channel]} 收银台</span>
              <h2 style={{ margin: '10px 0 4px', fontSize: 22 }}>{checkout.mockMode ? '测试模式收银台' : '扫码完成支付'}</h2>
              <p className="page-sub">订单号 {checkout.order.orderNo}</p>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={closeCheckout}>
              返回积分中心
            </button>
          </div>

          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 220,
                  height: 220,
                  borderRadius: 18,
                  border: '1px solid var(--border)',
                  display: 'grid',
                  placeItems: 'center',
                  background: checkout.order.status === 'paid' ? 'var(--success-bg)' : 'var(--bg-subtle)',
                }}
              >
                {checkout.order.status === 'paid' ? (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ width: 58, height: 58, borderRadius: '50%', background: 'var(--success)', color: '#fff', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontSize: 28 }}>✓</div>
                    <strong>支付成功，积分已到账</strong>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    {checkout.order.qrCodeUrl ? (
                      <img
                        src={checkout.order.qrCodeUrl}
                        alt={`${CHANNEL_LABELS[checkout.order.channel]}支付二维码`}
                        style={{ width: 178, height: 178, display: 'block', margin: '0 auto 12px', borderRadius: 10, background: '#fff' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 118,
                          height: 118,
                          margin: '0 auto 12px',
                          borderRadius: 12,
                          background:
                            'repeating-linear-gradient(0deg,#09090B 0 6px,transparent 6px 12px),repeating-linear-gradient(90deg,#09090B 0 6px,transparent 6px 12px)',
                          opacity: 0.88,
                        }}
                      />
                    )}
                    <strong style={{ color: checkout.order.channel === 'alipay' ? '#1D4ED8' : '#047857' }}>
                      请使用{CHANNEL_LABELS[checkout.order.channel]}扫码
                    </strong>
                  </div>
                )}
              </div>
              <span className="help-text">{checkout.mockMode ? '当前为开发 / 测试模式，不会产生真实扣款。' : '支付成功后页面会自动刷新余额。'}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="switch-row">
                <span>充值套餐</span>
                <strong>{checkout.order.packageName}</strong>
              </div>
              <div className="switch-row">
                <span>应付金额</span>
                <strong className="tabular" style={{ fontSize: 20 }}>{money(checkout.order.amountCents)}</strong>
              </div>
              <div className="switch-row">
                <span>到账积分</span>
                <strong className="tabular">{checkout.order.credits + checkout.order.bonusCredits}</strong>
              </div>
              <div className="switch-row">
                <span>订单状态</span>
                <span className={`badge ${checkout.order.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>
                  {STATUS_LABELS[checkout.order.status] || checkout.order.status}
                </span>
              </div>
              {checkout.order.status === 'paid' ? (
                <button type="button" className="btn btn-primary btn-lg" onClick={closeCheckout}>
                  完成并返回
                </button>
              ) : checkout.mockMode ? (
                <button type="button" className="btn btn-accent btn-lg" onClick={() => void mockPay()} disabled={busy}>
                  {busy ? '正在入账…' : '模拟支付完成'}
                </button>
              ) : checkout.order.qrCodeUrl ? (
                <span className="help-text" style={{ textAlign: 'center' }}>
                  二维码有效期与订单一致，支付完成后自动入账。
                </span>
              ) : (
                <a className="btn btn-accent btn-lg" href={checkout.order.payUrl} target="_blank" rel="noreferrer">
                  打开{CHANNEL_LABELS[checkout.order.channel]}支付
                </a>
              )}
              <div className="help-text" style={{ textAlign: 'center' }}>
                订单 30 分钟内有效；如已付款但余额未刷新，请稍等回调或联系管理员核销。
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(receiptOrder)}
        title="充值订单回单"
        onClose={() => setReceiptOrder(null)}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setReceiptOrder(null)}>
            关闭
          </button>
        }
      >
        {receiptOrder ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="switch-row">
              <span>订单号</span>
              <strong className="tabular">{receiptOrder.orderNo}</strong>
            </div>
            <div className="switch-row">
              <span>充值套餐</span>
              <strong>{receiptOrder.packageName}</strong>
            </div>
            <div className="switch-row">
              <span>支付渠道</span>
              <strong>{CHANNEL_LABELS[receiptOrder.channel] || receiptOrder.channel}</strong>
            </div>
            <div className="switch-row">
              <span>实付金额</span>
              <strong className="tabular">{money(receiptOrder.amountCents)}</strong>
            </div>
            <div className="switch-row">
              <span>到账积分</span>
              <strong className="tabular">{(receiptOrder.credits + receiptOrder.bonusCredits).toLocaleString()}</strong>
            </div>
            <div className="switch-row">
              <span>订单状态</span>
              <span className={`badge ${receiptOrder.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>
                {STATUS_LABELS[receiptOrder.status] || receiptOrder.status}
              </span>
            </div>
            <div className="switch-row">
              <span>创建时间</span>
              <strong>{new Date(receiptOrder.createdAt).toLocaleString()}</strong>
            </div>
            <div className="switch-row">
              <span>支付时间</span>
              <strong>{receiptOrder.paidAt ? new Date(receiptOrder.paidAt).toLocaleString() : '—'}</strong>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  )
}
