import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

const severityClass = {
  high: 'border-rose-200 bg-rose-50 text-rose-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-sky-200 bg-sky-50 text-sky-700'
}

const safeJson = (value) => {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const AuditTrail = () => {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()

  const [tenants, setTenants] = useState([])
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState({ total: 0, inserts: 0, updates: 0, deletes: 0 })
  const [anomalies, setAnomalies] = useState([])
  const [loading, setLoading] = useState(false)

  const [filters, setFilters] = useState({
    tenant_id: '',
    table: '',
    action: '',
    q: '',
    from: '',
    to: '',
    limit: '100'
  })

  const tenantOptions = useMemo(() => tenants || [], [tenants])

  const loadTenants = async () => {
    try {
      const { data, error } = await supabase.super.tenants()
      if (error) throw error
      setTenants(Array.isArray(data) ? data : [])
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memuat tenant')
    }
  }

  const loadAudit = async (nextFilters = filters) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.super.auditTrail(nextFilters)
      if (error) throw error
      setRows(Array.isArray(data?.rows) ? data.rows : [])
      setSummary(data?.summary || { total: 0, inserts: 0, updates: 0, deletes: 0 })
      setAnomalies(Array.isArray(data?.anomalies) ? data.anomalies : [])
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memuat audit trail')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!superAdminChecked || !isSuperAdmin) return
    loadTenants()
    loadAudit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin])

  const handleFilterChange = (key) => (event) => {
    const value = event.target.value
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleApplyFilter = async (event) => {
    event.preventDefault()
    await loadAudit(filters)
  }

  if (!superAdminChecked) {
    return <div className="p-6 text-sm text-slate-500">Memuat akses super admin...</div>
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Halaman ini hanya untuk super admin.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">Audit Trail Super Admin</h1>
        <p className="text-sm text-slate-600">
          Pantau perubahan data lintas tenant beserta deteksi anomali.
        </p>
      </div>

      <form onSubmit={handleApplyFilter} className="rounded-2xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <select
          value={filters.tenant_id}
          onChange={handleFilterChange('tenant_id')}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
        >
          <option value="">Semua Tenant</option>
          {tenantOptions.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name} ({tenant.slug})
            </option>
          ))}
        </select>

        <input
          value={filters.table}
          onChange={handleFilterChange('table')}
          placeholder="Filter tabel (contoh: settings)"
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
        />

        <select
          value={filters.action}
          onChange={handleFilterChange('action')}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
        >
          <option value="">Semua Aksi</option>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
        </select>

        <input
          value={filters.q}
          onChange={handleFilterChange('q')}
          placeholder="Cari user/tabel/record"
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
        />

        <input
          type="datetime-local"
          value={filters.from}
          onChange={handleFilterChange('from')}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
        />

        <input
          type="datetime-local"
          value={filters.to}
          onChange={handleFilterChange('to')}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
        />

        <select
          value={filters.limit}
          onChange={handleFilterChange('limit')}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
        >
          <option value="50">50 data</option>
          <option value="100">100 data</option>
          <option value="200">200 data</option>
          <option value="300">300 data</option>
        </select>

        <button
          type="submit"
          className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
        >
          Terapkan Filter
        </button>
      </form>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-xl font-bold text-slate-900">{summary.total || 0}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-700">INSERT</p>
          <p className="text-xl font-bold text-emerald-800">{summary.inserts || 0}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-700">UPDATE</p>
          <p className="text-xl font-bold text-amber-800">{summary.updates || 0}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs text-rose-700">DELETE</p>
          <p className="text-xl font-bold text-rose-800">{summary.deletes || 0}</p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Notifikasi Anomali</h2>
        {anomalies.length === 0 ? (
          <div className="text-sm text-slate-500 rounded-xl border border-slate-200 bg-white p-3">
            Belum ada anomali terdeteksi.
          </div>
        ) : (
          anomalies.map((item, idx) => (
            <div
              key={`${item.code}-${idx}`}
              className={`rounded-xl border p-3 text-sm ${severityClass[item.severity] || severityClass.low}`}
            >
              <p className="font-semibold">{item.code || 'ANOMALY'}</p>
              <p>{item.message}</p>
            </div>
          ))
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        {loading ? (
          <div className="text-sm text-slate-500">Memuat data audit...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-slate-500">Belum ada data audit.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4">Waktu</th>
                  <th className="py-2 pr-4">Tenant</th>
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Tabel</th>
                  <th className="py-2 pr-4">Aksi</th>
                  <th className="py-2 pr-4">Record</th>
                  <th className="py-2 pr-4">Detail</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(row.timestamp)}</td>
                    <td className="py-2 pr-4">{row.tenant_name || row.tenant_id || '-'}</td>
                    <td className="py-2 pr-4">{row.user_name || row.user_id || '-'}</td>
                    <td className="py-2 pr-4">{row.table_name || '-'}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row.action === 'DELETE' ? 'bg-rose-100 text-rose-700' : row.action === 'UPDATE' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {row.action}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{row.record_id || '-'}</td>
                    <td className="py-2 pr-4 min-w-[320px]">
                      <details>
                        <summary className="cursor-pointer text-xs text-indigo-600">Lihat old/new data</summary>
                        <div className="mt-2 space-y-2">
                          <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-auto max-h-48">{safeJson(row.old_data)}</pre>
                          <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-auto max-h-48">{safeJson(row.new_data)}</pre>
                        </div>
                      </details>
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

export default AuditTrail
