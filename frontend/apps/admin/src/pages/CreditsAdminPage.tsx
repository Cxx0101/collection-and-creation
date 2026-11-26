import { useCallback, useEffect, useState } from 'react'
import { api, del, post, put } from '../api'
import { useAdmin } from '../AppContext'
import { Confirm, Empty, Modal, StatusBadge } from '../components'
import { Select } from '../Select'
import type { CreditPackage, OrderRow } from '../types'

type SettingsPayload = { settings: Record<string, string>; secretsConfigured: Record<string, boolean> }

const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN ||
  (window.location.port === '5184' ? 'http://127.0.0.1:8090' : window.location.origin)

const EMPTY_PACKAGE = {
  name: '',
  badgeText: '',
  description: '',
  priceCents: 0,
  credits: 0,
  bonusCredits: 0,
  sortOrder: 0,
  enabled: true,
}

function money(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`
}

export default function CreditsAdminPage() {
  const { toast } = useAdmin()
  const [packages, setPackages] = useState<CreditPackage[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [secrets, setSecrets] = useState<Record<string, boolean>>({})
  const [packageOpen, setPackageOpen] = useState(false)
  const [packageEdit, setPackageEdit] = useState<CreditPackage | null>(null)
  const [packageForm, setPackageForm] = useState(EMPTY_PACKAGE)
  const [deletePackage, setDeletePackage] = useState<CreditPackage | null>(null)
  const [orderStatus, setOrderStatus] = useState('all')
  const [busy, setBusy] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    alipayEnabled: false,
    wechatEnabled: false,
    mockMode: true,
    fyepayEnabled: false,
    fyepayMchId: '',
    fyepayKey: '',
    fyepayGateway: 'https://api.fyepay.com/getaway',
    fyepayNotifyUrl: '',
    fyepayTradeIp: '',
    alipayAppId: '',
    alipayPrivateKey: '',
    alipayPublicKey: '',
    wechatAppId: '',
    wechatMchId: '',
    wechatApiV3Key: '',
    wechatSerialNo: '',
    wechatPrivateKey: '',
    wechatPlatformPublicKey: '',
  })

  const load = useCallback(async () => {
    try {
      const [packageList, settingsData, ordersData] = await Promise.all([
        api<CreditPackage[]>('/admin/packages'),
        api<SettingsPayload>('/admin/settings'),
        api<OrderRow[]>('/admin/orders'),
      ])
      setPackages(packageList)
      setSettings(settingsData.settings)
      setSecrets(settingsData.secretsConfigured)
      setOrders(ordersData)
      setPaymentForm({
        alipayEnabled: settingsData.settings['payment.alipay.enabled'] === 'true',
        wechatEnabled: settingsData.settings['payment.wechat.enabled'] === 'true',
        mockMode: settingsData.settings['payment.mockMode'] === 'true',
        fyepayEnabled: settingsData.settings['payment.fyepay.enabled'] === 'true',
        fyepayMchId: settingsData.settings['payment.fyepay.mchId'] || '',
        fyepayKey: '',
        fyepayGateway: settingsData.settings['payment.fyepay.gateway'] || 'https://api.fyepay.com/getaway',
        fyepayNotifyUrl: settingsData.settings['payment.fyepay.notifyUrl'] || '',
        fyepayTradeIp: settingsData.settings['payment.fyepay.tradeIp'] || '',
        alipayAppId: settingsData.settings['payment.alipay.appId'] || '',
        alipayPrivateKey: '',
        alipayPublicKey: '',
        wechatAppId: settingsData.settings['payment.wechat.appId'] || '',
        wechatMchId: settingsData.settings['payment.wechat.mchId'] || '',
        wechatApiV3Key: '',
        wechatSerialNo: settingsData.settings['payment.wechat.serialNo'] || '',
        wechatPrivateKey: '',
        wechatPlatformPublicKey: '',
      })
    } catch (error) {
      toast(error instanceof Error ? error.message : '商业化数据加载失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const openPackage = (pkg?: CreditPackage) => {
    setPackageEdit(pkg || null)
    setPackageForm(
      pkg
        ? {
            name: pkg.name,
            badgeText: pkg.badgeText,
            description: pkg.description,
            priceCents: pkg.priceCents,
            credits: pkg.credits,
            bonusCredits: pkg.bonusCredits,
            sortOrder: pkg.sortOrder,
            enabled: pkg.enabled,
          }
        : EMPTY_PACKAGE,
    )
    setPackageOpen(true)
  }

  const savePackage = async () => {
    if (!packageForm.name.trim()) return toast('套餐名称不能为空', 'error')
    if (packageForm.credits <= 0) return toast('套餐积分必须大于 0', 'error')
    setBusy(true)
    try {
      const body = { ...packageForm, name: packageForm.name.trim() }
      const row = packageEdit ? await put<CreditPackage>(`/admin/packages/${packageEdit.id}`, body) : await post<CreditPackage>('/admin/packages', body)
      setPackages((current) => (packageEdit ? current.map((pkg) => (pkg.id === row.id ? row : pkg)) : [...current, row].sort((a, b) => a.sortOrder - b.sortOrder)))
      setPackageOpen(false)
      toast(packageEdit ? '套餐已更新' : '套餐已创建并同步前台', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '套餐保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const removePackage = async () => {
    if (!deletePackage) return
    try {
      await del(`/admin/packages/${deletePackage.id}`)
      setPackages((current) => current.filter((pkg) => pkg.id !== deletePackage.id))
      setDeletePackage(null)
      toast('套餐已删除')
    } catch (error) {
      toast(error instanceof Error ? error.message : '套餐删除失败', 'error')
    }
  }

  const togglePackage = async (pkg: CreditPackage) => {
    try {
      const row = await put<CreditPackage>(`/admin/packages/${pkg.id}`, {
        name: pkg.name,
        badgeText: pkg.badgeText,
        description: pkg.description,
        priceCents: pkg.priceCents,
        credits: pkg.credits,
        bonusCredits: pkg.bonusCredits,
        sortOrder: pkg.sortOrder,
        enabled: !pkg.enabled,
      })
      setPackages((current) => current.map((item) => (item.id === row.id ? row : item)))
      toast(row.enabled ? '套餐已上架并同步前台' : '套餐已下架，前台立即隐藏', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '套餐状态切换失败', 'error')
    }
  }

  const savePayment = async () => {
    setBusy(true)
    try {
      const next: Record<string, string> = {
        ...settings,
        'payment.alipay.enabled': String(paymentForm.alipayEnabled),
        'payment.wechat.enabled': String(paymentForm.wechatEnabled),
        'payment.mockMode': String(paymentForm.mockMode),
        'payment.fyepay.enabled': String(paymentForm.fyepayEnabled),
        'payment.fyepay.mchId': paymentForm.fyepayMchId.trim(),
        'payment.fyepay.gateway': paymentForm.fyepayGateway.trim(),
        'payment.fyepay.notifyUrl': paymentForm.fyepayNotifyUrl.trim(),
        'payment.fyepay.tradeIp': paymentForm.fyepayTradeIp.trim(),
        'payment.alipay.appId': paymentForm.alipayAppId,
        'payment.wechat.appId': paymentForm.wechatAppId,
        'payment.wechat.mchId': paymentForm.wechatMchId,
        'payment.wechat.serialNo': paymentForm.wechatSerialNo,
      }
      if (paymentForm.alipayPrivateKey.trim()) next['payment.alipay.privateKey'] = paymentForm.alipayPrivateKey.trim()
      if (paymentForm.alipayPublicKey.trim()) next['payment.alipay.publicKey'] = paymentForm.alipayPublicKey.trim()
      if (paymentForm.wechatApiV3Key.trim()) next['payment.wechat.apiV3Key'] = paymentForm.wechatApiV3Key.trim()
      if (paymentForm.wechatPrivateKey.trim()) next['payment.wechat.privateKey'] = paymentForm.wechatPrivateKey.trim()
      if (paymentForm.wechatPlatformPublicKey.trim()) next['payment.wechat.platformPublicKey'] = paymentForm.wechatPlatformPublicKey.trim()
      if (paymentForm.fyepayKey.trim()) next['payment.fyepay.key'] = paymentForm.fyepayKey.trim()
      await put('/admin/settings', { settings: next })
      setSettings(next)
      setSecrets((current) => ({
        ...current,
        'payment.alipay.privateKey': current['payment.alipay.privateKey'] || Boolean(paymentForm.alipayPrivateKey),
        'payment.alipay.publicKey': current['payment.alipay.publicKey'] || Boolean(paymentForm.alipayPublicKey),
        'payment.wechat.apiV3Key': current['payment.wechat.apiV3Key'] || Boolean(paymentForm.wechatApiV3Key),
        'payment.wechat.privateKey': current['payment.wechat.privateKey'] || Boolean(paymentForm.wechatPrivateKey),
        'payment.wechat.platformPublicKey': current['payment.wechat.platformPublicKey'] || Boolean(paymentForm.wechatPlatformPublicKey),
        'payment.fyepay.key': current['payment.fyepay.key'] || Boolean(paymentForm.fyepayKey),
      }))
      toast('支付通道配置已加密保存', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '支付配置保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const markPaid = async (row: OrderRow) => {
    if (!window.confirm(`确认订单 ${row.order.orderNo} 已线下核实到账，并手动入账？`)) return
    try {
      await post(`/admin/orders/${row.order.id}/mark-paid`)
      await load()
      toast('订单已核销并完成积分入账', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '订单核销失败', 'error')
    }
  }

  const filteredOrders = orders.filter((row) => orderStatus === 'all' || row.order.status === orderStatus)
  const fyepayConfigured =
    Boolean(paymentForm.fyepayMchId.trim()) &&
    (Boolean(secrets['payment.fyepay.key']) || Boolean(paymentForm.fyepayKey.trim()))

  return (
    <section className="view-section active">
      <div className="page-head">
        <div>
          <h1 className="page-title">积分套餐、支付通道与充值订单</h1>
          <p className="page-sub">支持积分套餐增删改查，以及合众纵横聚合收款或支付宝、微信官方直连通道配置。</p>
        </div>
        <button type="button" className="btn btn-accent" onClick={() => openPackage()}>
          + 新建积分套餐
        </button>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>积分充值套餐列表</h2>
        {packages.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>排序</th>
                  <th>套餐名称</th>
                  <th>角标</th>
                  <th>售价</th>
                  <th>基础 + 赠送积分</th>
                  <th>状态</th>
                  <th>操作（CRUD）</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg) => (
                  <tr key={pkg.id}>
                    <td className="tabular">{pkg.sortOrder}</td>
                    <td>
                      <strong>{pkg.name}</strong>
                      <div className="help-text">{pkg.description}</div>
                    </td>
                    <td>{pkg.badgeText ? <span className="badge badge-accent">{pkg.badgeText}</span> : '—'}</td>
                    <td className="tabular">{money(pkg.priceCents)}</td>
                    <td className="tabular">
                      {pkg.credits.toLocaleString()} + {pkg.bonusCredits.toLocaleString()} ={' '}
                      <strong>{(pkg.credits + pkg.bonusCredits).toLocaleString()}</strong>
                    </td>
                    <td><span className={`badge ${pkg.enabled ? 'badge-success' : ''}`}>{pkg.enabled ? '已上架' : '已下架'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => openPackage(pkg)}>编辑</button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => void togglePackage(pkg)}>
                          {pkg.enabled ? '下架' : '上架'}
                        </button>
                        <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setDeletePackage(pkg)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>尚未创建积分套餐。</Empty>
        )}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: '#18181B', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 15 }}>合</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Fyepay · 合众纵横聚合收款</h2>
                <span className={`badge ${paymentForm.fyepayEnabled ? (fyepayConfigured ? 'badge-success' : 'badge-warning') : ''}`}>
                  {paymentForm.fyepayEnabled ? (fyepayConfigured ? '聚合网关已就绪' : '待补全商户配置') : '未启用'}
                </span>
              </div>
              <p className="help-text" style={{ margin: '4px 0 0' }}>
                启用并保存后优先接管前台支付宝与微信扫码收款；关闭时使用下方官方直连通道。修改开关或商户参数后需点击底部保存按钮生效。商户密钥由服务端 AES-GCM 加密保存且不回显。
              </p>
            </div>
          </div>
          <button
            type="button"
            className={`toggle-pill ${paymentForm.fyepayEnabled ? 'on' : ''}`}
            onClick={() => setPaymentForm((current) => ({ ...current, fyepayEnabled: !current.fyepayEnabled }))}
            aria-label="开关合众纵横聚合支付"
          />
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">商户号 MchID</span>
            <input
              className="input tabular"
              value={paymentForm.fyepayMchId}
              onChange={(event) => setPaymentForm((current) => ({ ...current, fyepayMchId: event.target.value }))}
              placeholder="由合众纵横分配"
            />
          </div>
          <div className="field">
            <span className="field-label">商户密钥 Key（AES-GCM 加密 · 留空不改）</span>
            <input
              className="input"
              type="password"
              value={paymentForm.fyepayKey}
              onChange={(event) => setPaymentForm((current) => ({ ...current, fyepayKey: event.target.value }))}
              placeholder={secrets['payment.fyepay.key'] ? '********（已配置加密存储）' : '请输入商户密钥'}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">支付网关</span>
            <input
              className="input tabular"
              value={paymentForm.fyepayGateway}
              onChange={(event) => setPaymentForm((current) => ({ ...current, fyepayGateway: event.target.value }))}
              placeholder="https://api.fyepay.com/getaway"
            />
          </div>
          <div className="field">
            <span className="field-label">交易 IP（可选，留空自动识别）</span>
            <input
              className="input tabular"
              value={paymentForm.fyepayTradeIp}
              onChange={(event) => setPaymentForm((current) => ({ ...current, fyepayTradeIp: event.target.value }))}
              placeholder="服务器公网 IPv4，例如 203.0.113.10"
            />
          </div>
        </div>
        <div className="field">
          <span className="field-label">异步回调 Notify URL（留空使用本站自动地址）</span>
          <input
            className="input"
            value={paymentForm.fyepayNotifyUrl}
            onChange={(event) => setPaymentForm((current) => ({ ...current, fyepayNotifyUrl: event.target.value }))}
            placeholder={`${API_ORIGIN}/api/v1/payments/fyepay/notify`}
          />
        </div>
        <div className="card-footer-stick" style={{ borderTop: 0, paddingTop: 0 }}>
          <span className="help-text">回调必须可直接访问；开发环境开启测试通道时不会发起真实扣款。</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void savePayment()} disabled={busy}>
            保存聚合支付配置
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: '#1677FF', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600 }}>支</span>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>支付宝通道配置</h2>
              </div>
              <button type="button" className={`toggle-pill ${paymentForm.alipayEnabled ? 'on' : ''}`} onClick={() => setPaymentForm((current) => ({ ...current, alipayEnabled: !current.alipayEnabled }))} aria-label="开关支付宝通道" />
            </div>
            <div className="field">
              <span className="field-label">应用 AppID</span>
              <input className="input tabular" value={paymentForm.alipayAppId} onChange={(event) => setPaymentForm((current) => ({ ...current, alipayAppId: event.target.value }))} />
            </div>
            <div className="field">
              <span className="field-label">应用私钥（AES-GCM 加密 · 留空不改）</span>
              <input className="input" type="password" value={paymentForm.alipayPrivateKey} onChange={(event) => setPaymentForm((current) => ({ ...current, alipayPrivateKey: event.target.value }))} placeholder={secrets['payment.alipay.privateKey'] ? '********（已配置加密存储）' : '未配置'} />
            </div>
            <div className="field">
              <span className="field-label">支付宝公钥（AES-GCM 加密）</span>
              <input className="input" type="password" value={paymentForm.alipayPublicKey} onChange={(event) => setPaymentForm((current) => ({ ...current, alipayPublicKey: event.target.value }))} placeholder={secrets['payment.alipay.publicKey'] ? '********（已配置加密存储）' : '未配置'} />
            </div>
            <div className="field">
              <span className="field-label">异步回调 Notify URL</span>
              <input className="input" value={`${API_ORIGIN}/api/v1/payments/alipay/notify`} readOnly />
            </div>
          </div>
          <div className="card-footer-stick">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span className="help-text">密钥由服务端 AES-GCM 加密保存且不回显</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <span className="help-text">开发测试通道</span>
                <button
                  type="button"
                  className={`toggle-pill ${paymentForm.mockMode ? 'on' : ''}`}
                  onClick={() => setPaymentForm((current) => ({ ...current, mockMode: !current.mockMode }))}
                  aria-label="开关开发测试支付通道"
                />
              </span>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void savePayment()} disabled={busy}>
              保存支付宝配置
            </button>
          </div>
        </div>

        <div className="aligned-card">
          <div className="card-body-flex">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: '#07C160', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600 }}>微</span>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>微信支付 V3 通道配置</h2>
              </div>
              <button type="button" className={`toggle-pill ${paymentForm.wechatEnabled ? 'on' : ''}`} onClick={() => setPaymentForm((current) => ({ ...current, wechatEnabled: !current.wechatEnabled }))} aria-label="开关微信支付通道" />
            </div>
            <div className="grid-2">
              <div className="field">
                <span className="field-label">公众号 / AppID</span>
                <input className="input tabular" value={paymentForm.wechatAppId} onChange={(event) => setPaymentForm((current) => ({ ...current, wechatAppId: event.target.value }))} />
              </div>
              <div className="field">
                <span className="field-label">微信商户号 MchID</span>
                <input className="input tabular" value={paymentForm.wechatMchId} onChange={(event) => setPaymentForm((current) => ({ ...current, wechatMchId: event.target.value }))} />
              </div>
            </div>
            <div className="field">
              <span className="field-label">APIv3 密钥</span>
              <input className="input" type="password" value={paymentForm.wechatApiV3Key} onChange={(event) => setPaymentForm((current) => ({ ...current, wechatApiV3Key: event.target.value }))} placeholder={secrets['payment.wechat.apiV3Key'] ? '********（已配置加密存储）' : '未配置'} />
            </div>
            <div className="grid-2">
              <div className="field">
                <span className="field-label">证书序列号</span>
                <input className="input tabular" value={paymentForm.wechatSerialNo} onChange={(event) => setPaymentForm((current) => ({ ...current, wechatSerialNo: event.target.value }))} />
              </div>
              <div className="field">
                <span className="field-label">商户私钥</span>
                <input className="input" type="password" value={paymentForm.wechatPrivateKey} onChange={(event) => setPaymentForm((current) => ({ ...current, wechatPrivateKey: event.target.value }))} placeholder={secrets['payment.wechat.privateKey'] ? '********（已配置）' : '未配置'} />
              </div>
            </div>
            <div className="field">
              <span className="field-label">异步回调 Notify URL</span>
              <input className="input" value={`${API_ORIGIN}/api/v1/payments/wechat/notify`} readOnly />
            </div>
            <div className="field">
              <span className="field-label">微信支付平台公钥（用于回调验签，AES-GCM 加密）</span>
              <input className="input" type="password" value={paymentForm.wechatPlatformPublicKey} onChange={(event) => setPaymentForm((current) => ({ ...current, wechatPlatformPublicKey: event.target.value }))} placeholder={secrets['payment.wechat.platformPublicKey'] ? '********（已配置加密存储）' : '未配置'} />
            </div>
          </div>
          <div className="card-footer-stick">
            <span className="help-text">微信支付 V3 回调验签使用平台公钥</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void savePayment()} disabled={busy}>
              保存微信配置
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>全站充值订单与异常核销补单</h2>
          <Select className="select" style={{ width: 160, height: 36 }} value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}>
            <option value="all">全部订单状态</option>
            <option value="pending">待支付 / 异常</option>
            <option value="paid">已支付</option>
          </Select>
        </div>
        {filteredOrders.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>充值用户</th>
                  <th>套餐</th>
                  <th>通道</th>
                  <th>实付金额</th>
                  <th>积分</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((row) => (
                  <tr key={row.order.id}>
                    <td className="tabular">{row.order.orderNo}</td>
                    <td className="tabular">{row.user?.phone || `#${row.order.userId}`}</td>
                    <td>{row.order.packageName}</td>
                    <td>
                      {row.order.channel === 'alipay' ? '支付宝' : '微信支付'}
                      <div className="help-text">
                        {row.order.gateway === 'fyepay' ? '合众纵横' : row.order.gateway === 'mock' ? '测试通道' : '官方直连'}
                      </div>
                    </td>
                    <td className="tabular">{money(row.order.amountCents)}</td>
                    <td className="tabular">{row.order.credits + row.order.bonusCredits}</td>
                    <td><StatusBadge status={row.order.status} /></td>
                    <td>
                      {row.order.status === 'pending' ? (
                        <button type="button" className="btn btn-accent btn-sm" onClick={() => void markPaid(row)}>人工核销补单</button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>没有匹配的订单。</Empty>}
      </div>

      <Modal
        open={packageOpen}
        title={packageEdit ? '编辑积分套餐' : '新建积分套餐'}
        onClose={() => setPackageOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setPackageOpen(false)}>取消</button>
            <button type="button" className="btn btn-accent" onClick={() => void savePackage()} disabled={busy}>{busy ? '保存中…' : '保存套餐'}</button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field">
            <span className="field-label">套餐名称</span>
            <input className="input" value={packageForm.name} onChange={(event) => setPackageForm((current) => ({ ...current, name: event.target.value }))} placeholder="如：创作者标准包" />
          </div>
          <div className="field">
            <span className="field-label">角标文案</span>
            <input className="input" value={packageForm.badgeText} onChange={(event) => setPackageForm((current) => ({ ...current, badgeText: event.target.value }))} placeholder="最受欢迎 / 赠 300" />
          </div>
        </div>
        <div className="field">
          <span className="field-label">套餐说明</span>
          <input className="input" value={packageForm.description} onChange={(event) => setPackageForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="grid-3">
          <div className="field">
            <span className="field-label">售价（分）</span>
            <input className="input tabular" type="number" min={0} value={packageForm.priceCents} onChange={(event) => setPackageForm((current) => ({ ...current, priceCents: Number(event.target.value) }))} />
            <span className="help-text">¥{(packageForm.priceCents / 100).toFixed(2)}</span>
          </div>
          <div className="field">
            <span className="field-label">基础积分</span>
            <input className="input tabular" type="number" min={1} value={packageForm.credits} onChange={(event) => setPackageForm((current) => ({ ...current, credits: Number(event.target.value) }))} />
          </div>
          <div className="field">
            <span className="field-label">赠送积分</span>
            <input className="input tabular" type="number" min={0} value={packageForm.bonusCredits} onChange={(event) => setPackageForm((current) => ({ ...current, bonusCredits: Number(event.target.value) }))} />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">排序（升序）</span>
            <input className="input tabular" type="number" value={packageForm.sortOrder} onChange={(event) => setPackageForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
          </div>
          <div className="switch-row" style={{ alignSelf: 'end' }}>
            <div>
              <strong>上架套餐</strong>
              <div className="help-text">关闭后前台立即隐藏</div>
            </div>
            <button type="button" className={`toggle-pill ${packageForm.enabled ? 'on' : ''}`} onClick={() => setPackageForm((current) => ({ ...current, enabled: !current.enabled }))} aria-label="切换套餐上架" />
          </div>
        </div>
      </Modal>

      <Confirm
        open={Boolean(deletePackage)}
        title="确认删除积分套餐"
        description={`将删除套餐「${deletePackage?.name || ''}」。如存在待支付订单需先下架处理。`}
        onCancel={() => setDeletePackage(null)}
        onConfirm={() => void removePackage()}
      />
    </section>
  )
}
