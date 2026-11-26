import { useCallback, useEffect, useState } from 'react'
import { api, post } from '../api'
import { useAdmin } from '../AppContext'
import { Empty, Modal } from '../components'
import { Select } from '../Select'
import type { JobRow } from '../types'

const STATUS_OPTIONS = [
  ['all', '全部状态'],
  ['running', '运行中'],
  ['waiting_for_user', '待用户确认'],
  ['succeeded', '已完成'],
  ['failed', '失败(已退分)'],
  ['cancelled', '强制取消退分'],
] as const

const STATUS_MAP: Record<string, [string, string]> = {
  running: ['运行中', 'badge-accent'],
  queued: ['排队中', 'badge-warning'],
  waiting_for_user: ['待用户确认', 'badge-warning'],
  succeeded: ['已完成', 'badge-success'],
  failed: ['失败(已退分)', 'badge-danger'],
  cancelled: ['强制取消退分', 'badge'],
}

export default function JobsPage() {
  const { toast } = useAdmin()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [status, setStatus] = useState('all')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [inspect, setInspect] = useState<JobRow | null>(null)

  const load = useCallback(async () => {
    try {
      const query = status === 'all' ? '' : `?status=${status}`
      const data = await api<JobRow[]>(`/admin/jobs${query}`)
      setJobs(data)
    } catch (error) {
      toast(error instanceof Error ? error.message : '任务列表加载失败', 'error')
    }
  }, [status, toast])

  useEffect(() => {
    void load()
  }, [load])

  const cancel = async (row: JobRow) => {
    if (!window.confirm(`强制取消任务 #${row.job.id}？系统将原路全额退回已冻结积分。`)) return
    setBusyId(row.job.id)
    try {
      await post(`/admin/jobs/${row.job.id}/cancel`)
      setJobs((current) =>
        current.map((item) =>
          item.job.id === row.job.id
            ? { ...item, job: { ...item.job, status: 'cancelled', creditsSettled: false } }
            : item,
        ),
      )
      toast('任务已取消，冻结积分已全额退回', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '取消任务失败', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="view-section active">
      <div className="page-head">
        <div>
          <h1 className="page-title">全站任务与积分退费监控</h1>
          <p className="page-sub">审计全站用户异步队列运行态；遇到三方上游卡死任务支持强制取消并原路全额退还冻结积分。</p>
        </div>
        <Select className="select" style={{ width: 190, height: 40 }} value={status} onChange={(event) => setStatus(event.target.value)}>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="card">
        {jobs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>任务 ID</th>
                  <th>所属用户</th>
                  <th>任务名称</th>
                  <th>调用来源</th>
                  <th>预冻结 / 实扣</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((row) => {
                  const badge = STATUS_MAP[row.job.status] || [row.job.status, 'badge']
                  const refundable = ['running', 'queued', 'waiting_for_user'].includes(row.job.status)
                  const settled = row.job.creditsSettled ? row.job.creditsCharged : 0
                  return (
                    <tr key={row.job.id}>
                      <td className="tabular">
                        <code>#{row.job.id}</code>
                      </td>
                      <td className="tabular">{row.user?.phone || `用户 #${row.job.ownerUserId}`}</td>
                      <td>
                        <strong>{row.job.toolName}</strong>
                        <div className="help-text">{new Date(row.job.createdAt).toLocaleString()}</div>
                      </td>
                      <td>
                        {row.job.modelSource === 'custom'
                          ? '用户自有接口(0积分)'
                          : row.job.modelLabel || row.job.modelId || '平台接口'}
                      </td>
                      <td className="tabular">
                        冻 {row.job.creditsCharged} / 扣 {settled}
                      </td>
                      <td>
                        <span className={`badge ${badge[1]}`}>{badge[0]}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setInspect(row)}>
                            载荷与流水
                          </button>
                          {refundable ? (
                            <button
                              type="button"
                              className="btn btn-danger-outline btn-sm"
                              onClick={() => void cancel(row)}
                              disabled={busyId === row.job.id}
                            >
                              {busyId === row.job.id ? '取消中…' : '强制取消并退分'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>当前筛选下没有任务。</Empty>
        )}
      </div>

      <Modal
        open={Boolean(inspect)}
        title={`任务详情与账本快照 · #${inspect?.job.id ?? ''}`}
        onClose={() => setInspect(null)}
        footer={
          <button type="button" className="btn btn-outline" onClick={() => setInspect(null)}>
            关闭
          </button>
        }
      >
        {inspect ? (
          <>
            <div className="help-text">
              发起账号：<strong>{inspect.user?.phone || `用户 #${inspect.job.ownerUserId}`}</strong> · 模型来源：
              {inspect.job.modelSource === 'custom' ? '用户自有接口（0 积分）' : inspect.job.modelLabel || '平台接口'}
            </div>
            <pre
              style={{
                margin: 0,
                padding: 14,
                background: '#18181B',
                color: '#F4F4F5',
                borderRadius: 10,
                fontSize: 12,
                lineHeight: 1.65,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {JSON.stringify(
                {
                  job_id: inspect.job.id,
                  tool: inspect.job.tool,
                  tool_name: inspect.job.toolName,
                  status: inspect.job.status,
                  prompt: inspect.job.prompt,
                  params: inspect.job.params,
                  model: inspect.job.modelId,
                  frozen_credits: inspect.job.creditsCharged,
                  settled: inspect.job.creditsSettled,
                  result_count: inspect.job.resultCount,
                  error_message: inspect.job.errorMessage,
                  idempotency_key: `idem_${inspect.job.id}`,
                },
                null,
                2,
              )}
            </pre>
          </>
        ) : null}
      </Modal>
    </section>
  )
}
