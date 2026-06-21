import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUIStore } from '../store/useUIStore'
import PasswordInput from './PasswordInput'

const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const severityClass = (severity = '') => {
  if (severity === 'success') return 'bg-emerald-100 text-emerald-700'
  if (severity === 'warning') return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-700'
}

export default function AccountSecurityPanel({ className = '', tone = 'blue' }) {
  const { pushToast } = useUIStore()
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [password, setPassword] = useState('')

  const color = tone === 'purple' ? 'purple' : 'blue'
  const activeWebSessions = overview?.summary?.active_web_sessions || 0
  const activeApiTokens = overview?.summary?.active_api_tokens || 0
  const webSessions = Array.isArray(overview?.web_sessions) ? overview.web_sessions : []
  const apiTokens = Array.isArray(overview?.api_tokens) ? overview.api_tokens : []
  const loginHistory = Array.isArray(overview?.login_history) ? overview.login_history : []
  const hasOtherDevices = useMemo(
    () => webSessions.some((item) => !item.current) || apiTokens.some((item) => !item.current),
    [apiTokens, webSessions]
  )

  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.getSecurityOverview()
      if (error) throw error
      setOverview(data || null)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat keamanan akun')
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase.auth.getSecurityOverview()
        if (error) throw error
        if (!cancelled) setOverview(data || null)
      } catch (error) {
        if (!cancelled) pushToast('error', error?.message || 'Gagal memuat keamanan akun')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pushToast])

  const handleLogoutOtherDevices = async () => {
    const trimmedPassword = password.trim()
    if (!trimmedPassword) {
      pushToast('error', 'Masukkan password akun untuk mengeluarkan perangkat lain.')
      return
    }

    const confirmed = window.confirm(
      'Keluarkan semua perangkat lain dari akun ini? Perangkat yang sedang Anda pakai tetap login.'
    )
    if (!confirmed) return

    setRevoking(true)
    try {
      const { data, error } = await supabase.auth.logoutOtherDevices({ password: trimmedPassword })
      if (error) throw error
      setPassword('')
      setOverview(data?.security || null)
      const webCount = Number(data?.web_sessions_revoked || 0)
      const tokenCount = Number(data?.api_tokens_revoked || 0)
      pushToast('success', `Perangkat lain dikeluarkan. Web: ${webCount}, mobile/API: ${tokenCount}.`)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal mengeluarkan perangkat lain')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <section className={`overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className={`h-1.5 ${color === 'purple' ? 'bg-purple-500' : 'bg-blue-500'}`} />
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className={`text-[11px] font-bold uppercase tracking-[0.16em] ${color === 'purple' ? 'text-purple-700' : 'text-blue-700'}`}>
              Keamanan Session
            </p>
            <h2 className="mt-1 text-base font-bold text-slate-900">Perangkat & Riwayat Login</h2>
            <p className="mt-1 text-sm text-slate-600">
              Pantau perangkat aktif dan keluarkan session lain saat ada aktivitas yang tidak dikenali.
            </p>
          </div>
          <button
            type="button"
            onClick={loadOverview}
            disabled={loading}
            className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Memuat...' : 'Refresh'}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">Session web aktif</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{activeWebSessions}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">Token mobile/API</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{activeApiTokens}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">Rate-limit login</p>
            <p className="mt-1 text-sm font-bold text-slate-900">
              {overview?.summary?.rate_limit?.max_failed_attempts || 5} gagal sebelum lock
            </p>
            <p className="mt-1 text-xs text-slate-500">Timer mengikuti server</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">Perangkat Aktif</h3>
              {hasOtherDevices && (
                <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">
                  Ada perangkat lain
                </span>
              )}
            </div>

            <div className="space-y-2">
              {webSessions.length === 0 && apiTokens.length === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  Belum ada perangkat aktif yang tercatat.
                </p>
              )}

              {webSessions.map((item) => (
                <div key={`web-${item.id}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.name || 'Browser web'}</p>
                      <p className="mt-1 text-xs text-slate-500">IP {item.ip_address || '-'} · {formatDateTime(item.last_active_at)}</p>
                    </div>
                    {item.current && (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                        Saat ini
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {apiTokens.map((item) => (
                <div key={`token-${item.id}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.name || 'Token mobile/API'}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Terakhir aktif {formatDateTime(item.last_active_at || item.created_at)}
                      </p>
                    </div>
                    {item.current && (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                        Saat ini
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-3">
              <label className="text-xs font-bold uppercase tracking-[0.14em] text-red-700">
                Keluarkan Perangkat Lain
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                <PasswordInput
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password akun saat ini"
                  className="w-full rounded-xl border border-red-200 bg-white px-3 py-2.5 text-sm focus:border-red-400 focus:ring-2 focus:ring-red-100"
                />
                <button
                  type="button"
                  onClick={handleLogoutOtherDevices}
                  disabled={revoking || !password.trim()}
                  className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {revoking ? 'Memproses...' : 'Logout Perangkat Lain'}
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-red-700">
                Session web lain dan token mobile/API lain akan dicabut. Perangkat ini tetap login.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-3">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Riwayat Login</h3>
            <div className="space-y-2">
              {loginHistory.length === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  Riwayat login belum tersedia.
                </p>
              )}

              {loginHistory.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.device || 'Perangkat tidak dikenal'}</p>
                      <p className="mt-1 text-xs text-slate-500">IP {item.ip_address || '-'} · {item.host || '-'}</p>
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${severityClass(item.severity)}`}>
                        {item.severity === 'success' ? 'Aman' : item.severity === 'warning' ? 'Perhatian' : 'Info'}
                      </span>
                      <span className="text-xs text-slate-500">{formatDateTime(item.occurred_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
