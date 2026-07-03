import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  MonitorSmartphone,
  RefreshCw,
  Search,
  Timer,
  Zap
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

const rangeOptions = [
  { value: '24h', label: '24 Jam' },
  { value: '7d', label: '7 Hari' },
  { value: '30d', label: '30 Hari' }
]

const roleOptions = [
  { value: '', label: 'Semua Role' },
  { value: 'admin', label: 'Admin Sekolah' },
  { value: 'guru', label: 'Guru' },
  { value: 'siswa', label: 'Siswa' },
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'guest', label: 'Guest' }
]

const deviceOptions = [
  { value: '', label: 'Semua Device' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'desktop', label: 'Desktop' }
]

const statusMeta = {
  good: {
    label: 'Bagus',
    icon: CheckCircle2,
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    bar: 'bg-emerald-500'
  },
  needs_attention: {
    label: 'Pantau',
    icon: AlertTriangle,
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    bar: 'bg-amber-500'
  },
  poor: {
    label: 'Lambat',
    icon: AlertTriangle,
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    bar: 'bg-rose-500'
  },
  unknown: {
    label: 'Belum Ada',
    icon: Activity,
    badge: 'border-slate-200 bg-slate-50 text-slate-600',
    bar: 'bg-slate-400'
  }
}

const roleLabel = {
  admin: 'Admin Sekolah',
  guru: 'Guru',
  teacher: 'Guru',
  siswa: 'Siswa',
  super_admin: 'Super Admin',
  guest: 'Guest',
  authenticated: 'Login'
}

const numberFormatter = new Intl.NumberFormat('id-ID')
const formatNumber = (value) => numberFormatter.format(Number(value || 0))
const formatMs = (value) => {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}s`
  return `${Math.round(number)}ms`
}
const formatCls = (value) => {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toFixed(3)
}
const percent = (value) => `${Math.max(0, Math.min(100, Number(value || 0)))}%`

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

function StatusBadge({ status }) {
  const meta = statusMeta[status] || statusMeta.unknown
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${meta.badge}`}>
      <Icon size={13} />
      {meta.label}
    </span>
  )
}

function MetricCard({ label, value, hint, icon: Icon, status = 'unknown' }) {
  const meta = statusMeta[status] || statusMeta.unknown
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-700">
          <Icon size={19} />
        </span>
      </div>
      <div className="mt-4 h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${meta.bar}`} style={{ width: status === 'good' ? '100%' : status === 'needs_attention' ? '62%' : status === 'poor' ? '32%' : '12%' }} />
      </div>
      <p className="mt-3 text-sm text-slate-500">{hint}</p>
    </section>
  )
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
      >
        {children}
      </select>
    </label>
  )
}

function RouteTable({ rows = [] }) {
  if (!rows.length) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center shadow-card">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-50 text-slate-500">
          <Gauge size={22} />
        </div>
        <h2 className="mt-4 text-base font-bold text-slate-950">Belum ada data performa halaman</h2>
        <p className="mt-2 text-sm text-slate-500">
          Data akan muncul setelah pengguna membuka halaman SISMU dari browser produksi.
        </p>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card">
      <div className="border-b border-slate-100 p-5">
        <h2 className="text-base font-bold text-slate-950">Halaman Paling Perlu Dipantau</h2>
        <p className="mt-1 text-sm text-slate-500">Diurutkan dari status terburuk dan p75 LCP tertinggi.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Halaman</th>
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Sample</th>
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">LCP</th>
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">TTFB</th>
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">INP</th>
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">CLS</th>
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-slate-50/70">
                <td className="max-w-[320px] px-5 py-4">
                  <p className="truncate text-sm font-bold text-slate-950" title={row.label}>{row.label}</p>
                  {row.tenant_slug ? <p className="mt-1 text-xs text-slate-500">{row.tenant_slug}</p> : null}
                </td>
                <td className="px-5 py-4 text-sm font-semibold text-slate-700">{formatNumber(row.samples)}</td>
                <td className="px-5 py-4 text-sm font-semibold text-slate-700">{formatMs(row.p75?.lcp_ms)}</td>
                <td className="px-5 py-4 text-sm font-semibold text-slate-700">{formatMs(row.p75?.ttfb_ms)}</td>
                <td className="px-5 py-4 text-sm font-semibold text-slate-700">{formatMs(row.p75?.inp_ms)}</td>
                <td className="px-5 py-4 text-sm font-semibold text-slate-700">{formatCls(row.p75?.cls)}</td>
                <td className="px-5 py-4"><StatusBadge status={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function BreakdownList({ title, rows = [], valueFormatter = formatMs, metric = 'lcp_ms' }) {
  const maxSamples = Math.max(1, ...rows.map((row) => Number(row.samples || 0)))
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <h2 className="text-base font-bold text-slate-950">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length ? rows.map((row) => (
          <div key={row.key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-semibold text-slate-700">{roleLabel[row.label] || row.label}</span>
              <span className="shrink-0 font-bold text-slate-950">{valueFormatter(row.p75?.[metric])}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-indigo-600" style={{ width: percent((Number(row.samples || 0) / maxSamples) * 100) }} />
            </div>
            <p className="text-xs text-slate-500">{formatNumber(row.samples)} sample</p>
          </div>
        )) : (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Belum ada data.</p>
        )}
      </div>
    </section>
  )
}

export default function SuperWebVitals() {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    range: '24h',
    tenant_id: '',
    role: '',
    device: '',
    route: ''
  })

  const summary = data?.summary || {}
  const p75 = summary.p75 || {}
  const status = summary.status || 'unknown'

  const queryParams = useMemo(() => {
    const params = {}
    Object.entries(filters).forEach(([key, value]) => {
      const next = String(value || '').trim()
      if (next) params[key] = next
    })
    return params
  }, [filters])

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const { data: nextData, error } = await supabase.super.webVitals(queryParams)
      if (error) throw error
      setData(nextData || null)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat Web Vitals')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!superAdminChecked || !isSuperAdmin) return undefined
    loadData()
    const timer = window.setInterval(() => loadData({ silent: true }), 30000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin, queryParams])

  return (
    <PageGate superAdminChecked={superAdminChecked} isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-indigo-100 text-indigo-700">
                <Gauge size={24} />
              </div>
              <div>
                <p className="page-title-kicker">Monitoring</p>
                <h1 className="page-title-heading">Performa Halaman</h1>
                <p className="page-title-description">
                  Pantau Web Vitals real-user: LCP, TTFB, INP, CLS, dan route yang terasa lambat.
                </p>
              </div>
            </div>
            <div className="page-title-actions">
              <button
                type="button"
                onClick={() => loadData()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
          <div className="grid gap-3 md:grid-cols-5">
            <FilterSelect label="Periode" value={filters.range} onChange={(value) => updateFilter('range', value)}>
              {rangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Sekolah" value={filters.tenant_id} onChange={(value) => updateFilter('tenant_id', value)}>
              <option value="">Semua Sekolah</option>
              {(data?.filters?.tenants || []).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Role" value={filters.role} onChange={(value) => updateFilter('role', value)}>
              {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Device" value={filters.device} onChange={(value) => updateFilter('device', value)}>
              {deviceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Cari Route</span>
              <span className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
                <Search size={16} className="text-slate-400" />
                <input
                  value={filters.route}
                  onChange={(event) => updateFilter('route', event.target.value)}
                  placeholder="/guru/laporan"
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none"
                />
              </span>
            </label>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Skor Platform" value={`${summary.score ?? 0}/100`} hint={`${formatNumber(summary.samples)} sample`} icon={Gauge} status={status} />
          <MetricCard label="LCP p75" value={formatMs(p75.lcp_ms)} hint="Target bagus <= 2.5s" icon={Zap} status={p75.lcp_ms == null ? 'unknown' : p75.lcp_ms <= 2500 ? 'good' : p75.lcp_ms <= 4000 ? 'needs_attention' : 'poor'} />
          <MetricCard label="TTFB p75" value={formatMs(p75.ttfb_ms)} hint="Target bagus <= 800ms" icon={Timer} status={p75.ttfb_ms == null ? 'unknown' : p75.ttfb_ms <= 800 ? 'good' : p75.ttfb_ms <= 1800 ? 'needs_attention' : 'poor'} />
          <MetricCard label="INP p75" value={formatMs(p75.inp_ms)} hint="Target bagus <= 200ms" icon={Activity} status={p75.inp_ms == null ? 'unknown' : p75.inp_ms <= 200 ? 'good' : p75.inp_ms <= 500 ? 'needs_attention' : 'poor'} />
          <MetricCard label="CLS p75" value={formatCls(p75.cls)} hint="Target bagus <= 0.100" icon={MonitorSmartphone} status={p75.cls == null ? 'unknown' : p75.cls <= 0.1 ? 'good' : p75.cls <= 0.25 ? 'needs_attention' : 'poor'} />
        </div>

        <RouteTable rows={data?.routes || []} />

        <div className="grid gap-4 xl:grid-cols-3">
          <BreakdownList title="Per Sekolah" rows={data?.tenants || []} />
          <BreakdownList title="Per Role" rows={data?.roles || []} />
          <BreakdownList title="Per Device" rows={data?.devices || []} />
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-base font-bold text-slate-950">Event Terbaru</h2>
            <p className="mt-1 text-sm text-slate-500">
              Terakhir sinkron: {data?.generated_at ? formatDateTime(data.generated_at) : '-'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Waktu</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Sekolah</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Route</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Role</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Device</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.recent || []).length ? data.recent.map((row, index) => (
                  <tr key={`${row.created_at}-${index}`} className="hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">{row.created_at ? formatDateTime(row.created_at) : '-'}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-800">{row.tenant_name || row.tenant_slug || '-'}</td>
                    <td className="max-w-[320px] px-5 py-4 text-sm font-semibold text-slate-800">
                      <span className="block truncate" title={row.route_path}>{row.route_path || '-'}</span>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{roleLabel[row.role] || row.role || '-'}</td>
                    <td className="px-5 py-4 text-sm text-slate-600">{row.device_type || '-'}</td>
                    <td className="px-5 py-4"><StatusBadge status={row.status} /></td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">Belum ada event terbaru.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </PageGate>
  )
}
