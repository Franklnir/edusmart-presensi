import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bug,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileWarning,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  X
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/time'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import apiClient from '../../lib/api/client'

const LOG_FILTER_STORAGE_KEY = 'edusmart.admin.monitor-log.filters.v1'

const defaultFilters = () => ({
  from: '',
  to: '',
  level: '',
  endpoint: '',
  q: '',
  per_page: 20,
  page: 1
})

const normalizeSavedFilters = (value) => ({
  ...defaultFilters(),
  ...(value && typeof value === 'object' ? value : {}),
  page: 1,
  per_page: Number(value?.per_page || 20)
})

const loadSavedFilters = () => {
  if (typeof window === 'undefined') return defaultFilters()
  try {
    const raw = window.localStorage.getItem(LOG_FILTER_STORAGE_KEY)
    return normalizeSavedFilters(raw ? JSON.parse(raw) : null)
  } catch {
    return defaultFilters()
  }
}

const saveFilters = (filters) => {
  if (typeof window === 'undefined') return
  const payload = normalizeSavedFilters(filters)
  window.localStorage.setItem(LOG_FILTER_STORAGE_KEY, JSON.stringify(payload))
}

const levelTone = {
  emergency: 'border-rose-200 bg-rose-50 text-rose-700',
  alert: 'border-rose-200 bg-rose-50 text-rose-700',
  critical: 'border-red-200 bg-red-50 text-red-700',
  error: 'border-red-200 bg-red-50 text-red-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  notice: 'border-sky-200 bg-sky-50 text-sky-700',
  info: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  debug: 'border-slate-200 bg-slate-50 text-slate-700'
}

const levelLabel = (level) => String(level || '-').toUpperCase()

const safeJson = (value) => {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function PageGate({ superAdminChecked, isSuperAdmin, children }) {
  if (!superAdminChecked) return <div className="p-6 text-sm text-slate-500">Memuat akses super admin...</div>
  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Halaman ini hanya untuk super admin.
        </div>
      </div>
    )
  }
  return children
}

function StatCard({ label, value, icon: Icon, tone = 'slate', hint }) {
  const color = {
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    slate: 'bg-slate-100 text-slate-700'
  }[tone] || 'bg-slate-100 text-slate-700'

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value || 0}</p>
        </div>
        <span className={`grid h-11 w-11 place-items-center rounded-2xl ${color}`}>
          <Icon size={19} />
        </span>
      </div>
      {hint ? <p className="mt-3 text-sm text-slate-500">{hint}</p> : null}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid gap-3 px-4 py-4 md:grid-cols-[150px_100px_1.2fr_2fr_130px_90px]">
          {Array.from({ length: 6 }).map((__, cell) => (
            <div key={cell} className="h-5 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ))}
    </div>
  )
}

function DetailModal({ detail, loading, onClose }) {
  if (!detail && !loading) return null

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="mx-auto flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-600">Detail Log</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">
              {loading ? 'Memuat detail...' : levelLabel(detail?.level)}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{detail?.timestamp ? formatDateTime(detail.timestamp) : '-'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            aria-label="Tutup detail log"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-10 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="overflow-y-auto p-5">
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ['Timestamp', detail?.timestamp ? formatDateTime(detail.timestamp) : '-'],
                ['Log Level', levelLabel(detail?.level)],
                ['Request URL', detail?.endpoint || '-'],
                ['HTTP Method', detail?.method || '-'],
                ['User ID', detail?.user || '-'],
                ['IP Address', detail?.ip_address || '-'],
                ['File', detail?.file || '-'],
                ['Line Number', detail?.line || '-']
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 break-words text-sm font-bold text-slate-950">{value}</p>
                </div>
              ))}
            </div>

            <section className="mt-4 rounded-2xl border border-slate-100 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Error Message</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold text-slate-900">{detail?.message || '-'}</p>
            </section>

            <section className="mt-4 rounded-2xl border border-slate-100 bg-slate-950 p-4 text-slate-100">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Stack Trace</p>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{detail?.stack_trace || '-'}</pre>
            </section>

            <section className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Context Data</p>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">
                {safeJson(detail?.context)}
              </pre>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MonitorLog() {
  const { isAuthorized, user } = useAuthStore()
  const { pushToast } = useUIStore()
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState({ errors: 0, warnings: 0, critical: 0, total: 0 })
  const [options, setOptions] = useState({ levels: [], endpoints: [] })
  const [pagination, setPagination] = useState({ page: 1, per_page: 20, total: 0, last_page: 1 })
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [filters, setFilters] = useState(() => loadSavedFilters())
  const filtersRef = useRef(filters)
  const pageRef = useRef(1)

  const canPrev = Number(pagination.page || 1) > 1
  const canNext = Number(pagination.page || 1) < Number(pagination.last_page || 1)

  const queryFilters = useMemo(() => ({
    ...filters,
    page: pagination.page || filters.page || 1,
    per_page: filters.per_page || 20
  }), [filters, pagination.page])

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  useEffect(() => {
    pageRef.current = pagination.page || 1
  }, [pagination.page])

  const loadLogs = async (nextFilters = queryFilters, { silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const { data } = await apiClient('/api/v2/frontend-logs', { method: 'GET', params: nextFilters })
      setRows(Array.isArray(data?.data) ? data.data : [])
      setSummary({
        errors: data?.data?.filter(l => l.level === 'error').length || 0,
        warnings: data?.data?.filter(l => l.level === 'warning').length || 0,
        critical: data?.data?.filter(l => l.level === 'critical').length || 0,
        total: data?.total || 0
      })
      setOptions({ levels: ['error', 'warning', 'info', 'critical'], endpoints: [] })
      setPagination({
        page: data?.current_page || 1,
        per_page: data?.per_page || 20,
        total: data?.total || 0,
        last_page: data?.last_page || 1
      })
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat Monitor Log')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthorized) return undefined
    const initialFilters = { ...filters, page: 1 }
    loadLogs(initialFilters)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadLogs({ ...filtersRef.current, page: pageRef.current }, { silent: true })
      }
    }, 8000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const updateFilter = (key) => (event) => {
    const value = event.target.value
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }))
  }

  const applyFilters = async (event) => {
    event.preventDefault()
    const next = { ...filters, page: 1 }
    saveFilters(next)
    setPagination((prev) => ({ ...prev, page: 1 }))
    await loadLogs(next)
  }

  const resetFilters = async () => {
    const next = defaultFilters()
    saveFilters(next)
    setFilters(next)
    setPagination((prev) => ({ ...prev, page: 1 }))
    await loadLogs(next)
  }

  const goPage = async (page) => {
    const next = { ...filters, page }
    saveFilters(next)
    setPagination((prev) => ({ ...prev, page }))
    await loadLogs(next)
  }

  const openDetail = async (id) => {
    setDetail(null)
    setDetailLoading(true)
    try {
      const row = rows.find(r => r.id === id)
      if (!row) throw new Error('Detail tidak ditemukan')
      setDetail({
        ...row,
        timestamp: row.created_at,
        endpoint: row.url,
        file: '-',
        line: '-'
      })
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat detail log')
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
        <div className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-slate-950 text-white">
                <TerminalSquare size={24} />
              </div>
              <div>
                <p className="page-title-kicker">Monitor Log</p>
                <h1 className="page-title-heading">Monitor Log Backend</h1>
                <p className="page-title-description">
                  Pantau error dan aktivitas Laravel tanpa membuka file log VPS. Data sensitif otomatis disembunyikan.
                </p>
              </div>
            </div>
            <div className="page-title-actions">
              <button
                type="button"
                onClick={() => loadLogs(queryFilters)}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Error Hari Ini" value={summary.errors} icon={Bug} tone="red" />
          <StatCard label="Total Warning Hari Ini" value={summary.warnings} icon={AlertTriangle} tone="amber" />
          <StatCard label="Total Critical Hari Ini" value={summary.critical} icon={FileWarning} tone="rose" />
          <StatCard label="Total Log Hari Ini" value={summary.total} icon={ShieldCheck} tone="indigo" />
        </div>

        <form onSubmit={applyFilters} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <Search size={18} className="text-indigo-600" />
            <h2 className="text-base font-black text-slate-950">Filter Log</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Dari Tanggal</span>
              <input id="log-from" name="from" type="date" value={filters.from} onChange={updateFilter('from')} className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Sampai Tanggal</span>
              <input id="log-to" name="to" type="date" value={filters.to} onChange={updateFilter('to')} className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400" />
              <span className="block text-[11px] font-semibold text-slate-400">Kosong = sampai log terbaru saat ini.</span>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Level</span>
              <select id="log-level" name="level" value={filters.level} onChange={updateFilter('level')} className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400">
                <option value="">Semua level</option>
                {(options.levels || []).map((level) => <option key={level} value={level}>{levelLabel(level)}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Endpoint</span>
              <input id="log-endpoint" name="endpoint" list="log-endpoint-options" value={filters.endpoint} onChange={updateFilter('endpoint')} placeholder="/api/db" className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400" />
              <datalist id="log-endpoint-options">
                {(options.endpoints || []).map((endpoint) => <option key={endpoint} value={endpoint} />)}
              </datalist>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Keyword</span>
              <input id="log-keyword" name="q" value={filters.q} onChange={updateFilter('q')} placeholder="Cari pesan/user/file" className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400" />
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className="h-12 flex-1 rounded-2xl bg-indigo-600 px-4 text-sm font-black text-white shadow-sm hover:bg-indigo-700">
                Terapkan
              </button>
              <button type="button" onClick={resetFilters} className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
                Reset
              </button>
            </div>
          </div>
        </form>

        <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-card">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">Daftar Log</h2>
              <p className="text-sm text-slate-500">Auto refresh setiap 8 detik saat tab aktif.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              <CalendarDays size={16} />
              {pagination.total || 0} log
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[1050px]">
              <div className="grid grid-cols-[160px_110px_1.2fr_2fr_150px_110px] gap-3 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
                <span>Waktu</span>
                <span>Level</span>
                <span>Endpoint</span>
                <span>Pesan Error</span>
                <span>User</span>
                <span>Aksi</span>
              </div>
              {loading ? (
                <SkeletonRows />
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">Belum ada log yang cocok dengan filter.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[160px_110px_1.2fr_2fr_150px_110px] gap-3 px-4 py-4 text-sm">
                      <div className="font-semibold text-slate-700">{row.timestamp ? formatDateTime(row.timestamp) : '-'}</div>
                      <div>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${levelTone[row.level] || levelTone.debug}`}>
                          {levelLabel(row.level)}
                        </span>
                      </div>
                      <div className="truncate font-semibold text-slate-700" title={row.url || '-'}>{row.url || '-'}</div>
                      <div className="line-clamp-2 text-slate-600" title={row.message || '-'}>{row.message || '-'}</div>
                      <div className="truncate text-slate-600" title={row.user || '-'}>{row.user || '-'}</div>
                      <div>
                        <button type="button" onClick={() => openDetail(row.id)} className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100">
                          <Eye size={14} />
                          Detail
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-slate-500">
              Halaman {pagination.page || 1} dari {pagination.last_page || 1}
            </p>
            <div className="flex items-center gap-2">
              <select
                id="log-per-page"
                name="per_page"
                value={filters.per_page}
                onChange={updateFilter('per_page')}
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"
              >
                <option value="20">20 / halaman</option>
                <option value="50">50 / halaman</option>
                <option value="100">100 / halaman</option>
              </select>
              <button type="button" disabled={!canPrev || loading} onClick={() => goPage(Number(pagination.page || 1) - 1)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-40">
                <ChevronLeft size={18} />
              </button>
              <button type="button" disabled={!canNext || loading} onClick={() => goPage(Number(pagination.page || 1) + 1)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-40">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </section>

        <DetailModal detail={detail} loading={detailLoading} onClose={() => { setDetail(null); setDetailLoading(false) }} />
      </div>
  )
}
