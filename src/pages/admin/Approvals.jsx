import React, { useEffect, useMemo, useState } from 'react'
import {
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle
} from 'lucide-react'
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

const statusLabel = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled'
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
  const summaryCards = useMemo(() => ([
    {
      key: 'pending',
      label: 'Pending',
      value: summary.pending || 0,
      icon: Clock3,
      iconClass: 'bg-amber-100 text-amber-700',
      valueClass: 'text-gray-900'
    },
    {
      key: 'approved',
      label: 'Approved',
      value: summary.approved || 0,
      icon: CheckCircle2,
      iconClass: 'bg-emerald-100 text-emerald-700',
      valueClass: 'text-emerald-700'
    },
    {
      key: 'rejected',
      label: 'Rejected',
      value: summary.rejected || 0,
      icon: XCircle,
      iconClass: 'bg-rose-100 text-rose-700',
      valueClass: 'text-rose-700'
    },
    {
      key: 'cancelled',
      label: 'Cancelled',
      value: summary.cancelled || 0,
      icon: Ban,
      iconClass: 'bg-gray-100 text-gray-600',
      valueClass: 'text-gray-900'
    },
    {
      key: 'total',
      label: 'Total',
      value: summary.total || 0,
      icon: ListChecks,
      iconClass: 'bg-blue-100 text-blue-700',
      valueClass: 'text-blue-700'
    }
  ]), [summary])

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
      <div className="w-full px-4 pt-2 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
          Halaman ini hanya untuk admin.
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-8 px-4 pt-2 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-blue-100 p-3 text-blue-700">
              <ShieldCheck size={30} strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Approval Maker-Checker</h1>
              <p className="mt-1 text-gray-600">
                Perubahan kritikal menunggu persetujuan admin sebelum diterapkan.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
            {summary.pending || 0} request menunggu review
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {summaryCards.map(({ key, label, value, icon: Icon, iconClass, valueClass }) => (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-4 shadow">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
              </div>
              <div className={`rounded-lg p-3 ${iconClass}`}>
                <Icon size={22} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
              <span className="rounded-lg bg-blue-100 p-2 text-blue-700">
                <Search size={20} />
              </span>
              Filter Approval
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Pilih status dan tabel untuk mempersempit daftar request.
            </p>
          </div>
          <button
            type="button"
            onClick={loadApprovals}
            disabled={loading}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-medium text-gray-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-60 sm:w-auto"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-12 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
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
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                loadApprovals()
              }
            }}
            placeholder="Filter tabel (opsional)"
            className="h-12 rounded-lg border border-gray-300 px-3 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
              <span className="rounded-lg bg-blue-100 p-2 text-blue-700">
                <ClipboardCheck size={20} />
              </span>
              Daftar Approval
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Review perubahan kritikal sesuai status yang dipilih.
            </p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Status aktif: {status ? statusLabel[status] || status : 'Semua Status'}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="mt-4 text-sm font-medium text-gray-600">Memuat approval...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
            <div className="rounded-full bg-gray-100 p-7 text-gray-400">
              <ClipboardCheck size={48} strokeWidth={1.8} />
            </div>
            <h3 className="mt-5 text-xl font-semibold text-gray-600">Belum ada data approval</h3>
            <p className="mt-2 text-sm text-gray-500">Request yang sesuai filter akan tampil di sini.</p>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="py-3 pr-4 font-semibold">Waktu</th>
                  <th className="py-3 pr-4 font-semibold">Status</th>
                  <th className="py-3 pr-4 font-semibold">Risk</th>
                  <th className="py-3 pr-4 font-semibold">Perubahan</th>
                  <th className="py-3 pr-4 font-semibold">Maker</th>
                  <th className="py-3 pr-4 font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 align-top last:border-0">
                    <td className="whitespace-nowrap py-4 pr-4">{formatDateTime(row.requested_at)}</td>
                    <td className="py-4 pr-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[row.status] || statusClass.cancelled}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-4 pr-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${riskClass[row.risk_level] || riskClass.low}`}>
                        {row.risk_level || 'low'}
                      </span>
                    </td>
                    <td className="min-w-[360px] py-4 pr-4">
                      <p className="font-semibold text-gray-900">{row.change_summary || `${row.target_action} ${row.target_table}`}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {row.target_action} on {row.target_table} - estimasi {row.affected_rows_estimate || 1} baris
                      </p>
                    </td>
                    <td className="py-4 pr-4">{row.requested_by_name || row.requested_by || '-'}</td>
                    <td className="py-4 pr-4">
                      {row.status === 'pending' ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleApprove(row)}
                            disabled={processingId === row.id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                          >
                            <CheckCircle2 size={14} />
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(row)}
                            disabled={processingId === row.id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                          >
                            <XCircle size={14} />
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">{row.review_note || '-'}</span>
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
