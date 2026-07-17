import React, { useEffect, useState } from 'react'
import { RefreshCw, ServerCog } from 'lucide-react'
import { supabase } from '../../services/storageService'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'
import {
  JobTable,
  PageGate,
  QueueStatusPanel,
  QueueTable,
  WorkerPanel
} from './SuperMonitoring'

export default function SuperBackgroundJobs() {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const jobs = data?.jobs || {}

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const { data: nextData, error } = await supabase.super.monitoringOverview()
      if (error) throw error
      setData(nextData || null)
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat background job')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!superAdminChecked || !isSuperAdmin) return undefined
    loadData()
    const timer = window.setInterval(() => loadData({ silent: true }), 15000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin])

  return (
    <PageGate superAdminChecked={superAdminChecked} isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-indigo-100 text-indigo-700">
                <ServerCog size={24} />
              </div>
              <div>
                <p className="page-title-kicker">Monitoring</p>
                <h1 className="page-title-heading">Background Job</h1>
                <p className="page-title-description">
                  Pantau Horizon, Redis, worker queue, heartbeat scheduler, dan failed job dari satu tempat.
                </p>
              </div>
            </div>
            <div className="page-title-actions">
              <p className="text-xs font-semibold text-slate-500">
                Update: {data?.generated_at ? formatDateTime(data.generated_at) : '-'}
              </p>
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

        <QueueStatusPanel jobs={jobs} />

        <div className="grid gap-4 xl:grid-cols-[1.35fr_.9fr]">
          <QueueTable queues={jobs?.queues || []} />
          <WorkerPanel supervisors={jobs?.horizon?.supervisors || []} heartbeats={jobs?.heartbeats || {}} />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <JobTable title="Job Pending Horizon" rows={jobs?.horizon?.pending_jobs || []} empty="Tidak ada job pending." />
          <JobTable title="Job Terbaru" rows={jobs?.horizon?.recent_jobs || []} empty="Belum ada riwayat Horizon." />
          <JobTable title="Failed Job" rows={jobs?.database_failed_jobs?.recent?.length ? jobs.database_failed_jobs.recent : (jobs?.horizon?.failed_jobs || [])} empty="Tidak ada failed job." failed />
        </div>
      </div>
    </PageGate>
  )
}
