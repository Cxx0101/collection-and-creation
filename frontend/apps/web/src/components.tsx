import type { ReactNode } from 'react'
import { useApp } from './AppContext'
import { CloseIcon } from './icons'

export function LoadingScreen() {
  return <div className="root-loading">正在加载星芒创作工作台…</div>
}

export function ToastHost() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toast-stack" id="toastStack" aria-live="polite">
      {toasts.map((item) => (
        <button key={item.id} type="button" className={`toast ${item.type === 'default' ? '' : item.type}`} onClick={() => dismissToast(item.id)}>
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
  className,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  className?: string
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div className="modal-backdrop open" onClick={(event) => event.target === event.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className={`modal-box ${wide ? 'wide' : ''} ${className || ''}`.trim()}>
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

export function ConfirmModal({
  open,
  title,
  description,
  confirmText = '确认',
  danger = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmText?: string
  danger?: boolean
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
          <button type="button" className={`btn ${danger ? 'btn-danger-outline' : 'btn-accent'}`} onClick={onConfirm}>
            {confirmText}
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

export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="ref-thumb-remove" onClick={onClick} aria-label={label}>
      <CloseIcon size={11} />
    </button>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>
}
