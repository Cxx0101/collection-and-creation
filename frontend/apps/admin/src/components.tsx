import type { ReactNode } from 'react'
import { useAdmin } from './AppContext'

export function ToastHost() {
  const { toasts, dismiss } = useAdmin()
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((item) => (
        <button key={item.id} type="button" className={`toast ${item.type === 'default' ? '' : item.type}`} onClick={() => dismiss(item.id)}>
          {item.message}
        </button>
      ))}
    </div>
  )
}

export function Modal({
  open,
  title,
  children,
  footer,
  wide,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div className="modal-backdrop open" onClick={(event) => event.target === event.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className={`modal-box ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Confirm({
  open,
  title,
  description,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: ReactNode
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-danger-outline" onClick={onConfirm}>
            确认删除
          </button>
        </>
      }
    >
      <div className="help-text" style={{ lineHeight: 1.7 }}>
        {description}
      </div>
    </Modal>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    running: '运行中',
    queued: '排队中',
    waiting_for_user: '待确认',
    succeeded: '已成功',
    failed: '已失败',
    cancelled: '已取消',
    active: '正常',
    disabled: '已禁用',
    pending: '待支付',
    paid: '已支付',
  }
  const cls =
    status === 'succeeded' || status === 'active' || status === 'paid'
      ? 'badge-success'
      : status === 'failed' || status === 'disabled'
        ? 'badge-danger'
        : status === 'pending' || status === 'queued'
          ? 'badge-warning'
          : 'badge-accent'
  return <span className={`badge ${cls}`}>{labels[status] || status}</span>
}
