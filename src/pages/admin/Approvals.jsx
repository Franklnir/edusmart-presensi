import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

const statusClass = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-600'
}

const riskClass = {
  high: 'bg-rose-100 text-rose-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-sky-100 text-sky-700'
}

const Approvals = () => {
  const { profile } = useAuthStore()
  const { pushToast } = useUIStore()

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState({ pending: 0, approved: 0, rejected: 0, cancelled: 0, total: 0 })
  const [status, setStatus] = useState('pending')
  const [tableFilter, setTableFilter] = useState('')
  const [processingId, setProcessingId] = useState('')

  const isAdmin = profile?.role === 'admin'

  const loadApprovals = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.admin.approvals({
        status,
        table: tableFilter || undefined,
        limit: 200
      })
      if (error) throw error

      setRows(Array.isArray(data?.rows) ? data.rows : [])
      setSummary(data?.summary || { pending: 0, approved: 0, rejected: 0, cancelled: 0, total: 0 })
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memuat approval')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    loadApprovals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, status])

  const handleApprove = async (row) => {
    if (!row?.id || processingId) return
    const confirmed = window.confirm(`Approve perubahan: ${row.change_summary || row.target_table}?`)
    if (!confirmed) return

    setProcessingId(row.id)
    try {
      const { error } = await supabase.admin.approveApproval(row.id)
      if (error) throw error
      pushToast('success', 'Approval berhasil disetujui')
      await loadApprovals()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal approve perubahan')
    } finally {
      setProcessingId('')
    }
  }

  const handleReject = async (row) => {
    if (!row?.id || processingId) return
    const note = window.prompt('Alasan penolakan (opsional):', '')

    setProcessingId(row.id)
    try {
      const { error } = await supabase.admin.rejectApproval(row.id, { note: note || undefined })
      if (error) throw error
      pushToast('success', 'Approval berhasil ditolak')
      await loadApprovals()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menolak perubahan')
    } finally {
      setProcessingId('')
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Halaman ini hanya untuk admin.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">Approval Maker-Checker</h1>
        <p className="text-sm text-slate-600">Perubahan kritikal akan menunggu persetujuan sebelum diterapkan.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Pending</p>
          <p className="text-xl font-bold text-slate-900">{summary.pending || 0}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-700">Approved</p>
          <p className="text-xl font-bold text-emerald-800">{summary.approved || 0}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs text-rose-700">Rejected</p>
          <p className="text-xl font-bold text-rose-800">{summary.rejected || 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-700">Cancelled</p>
          <p className="text-xl font-bold text-slate-800">{summary.cancelled || 0}</p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <p className="text-xs text-indigo-700">Total</p>
          <p className="text-xl font-bold text-indigo-800">{summary.total || 0}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
          <option value="">Semua Status</option>
        </select>

        <input
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          placeholder="Filter tabel (opsional)"
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
        />

        <button
          type="button"
          onClick={loadApprovals}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        {loading ? (
          <div className="text-sm text-slate-500">Memuat approval...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-slate-500">Belum ada data approval.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4">Waktu</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Risk</th>
                  <th className="py-2 pr-4">Perubahan</th>
                  <th className="py-2 pr-4">Maker</th>
                  <th className="py-2 pr-4">Aksi</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(row.requested_at)}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusClass[row.status] || statusClass.cancelled}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${riskClass[row.risk_level] || riskClass.low}`}>
                        {row.risk_level || 'low'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 min-w-[360px]">
                      <p className="font-semibold text-slate-900">{row.change_summary || `${row.target_action} ${row.target_table}`}</p>
                      <p className="text-xs text-slate-500">{row.target_action} on {row.target_table} • estimasi {row.affected_rows_estimate || 1} baris</p>
                    </td>
                    <td className="py-2 pr-4">{row.requested_by_name || row.requested_by || '-'}</td>
                    <td className="py-2 pr-4">
                      {row.status === 'pending' ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleApprove(row)}
                            disabled={processingId === row.id}
                            className="px-3 py-1.5 rounded-full border border-emerald-200 text-emerald-700 text-xs hover:bg-emerald-50 disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(row)}
                            disabled={processingId === row.id}
                            className="px-3 py-1.5 rounded-full border border-rose-200 text-rose-700 text-xs hover:bg-rose-50 disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">{row.review_note || '-'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Approvals
