import React from 'react'
import { formatDateTime } from '../../lib/time'
import { Icon } from './icons'

const MonitoringRow = React.memo(({ showKelas = false, user }) => {
  const multiDevice = (user.active_devices || 0) >= 2
  const lastSeen = user.last_seen_at ? formatDateTime(user.last_seen_at) : 'Belum pernah online'

  return (
    <div className={`flex items-center justify-between gap-3 p-3 rounded-xl border text-sm ${multiDevice ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-white'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-800 truncate">{user.nama || user.email || 'Tanpa Nama'}</span>
          {showKelas && user.kelas && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{user.kelas}</span>}
          {multiDevice && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-600 text-white font-semibold">Multi Device</span>}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">
          {user.online ? 'Online sekarang' : `Offline - ${lastSeen}`}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${user.online ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {user.online ? 'ONLINE' : 'OFFLINE'}
        </span>
        <span className="text-xs text-slate-500">Aktivitas: <strong>{user.activity_count || 0}</strong></span>
      </div>
    </div>
  )
})

MonitoringRow.displayName = 'MonitoringRow'

const MonitoringModal = React.memo(({
  data,
  error,
  loading,
  onClose,
  onRefresh,
  onlineCount,
  open
}) => {
  if (!open) return null

  const students = data?.students || []
  const teachers = data?.teachers || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 animate-fade-in">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-[var(--shadow-popup)] border border-slate-100 overflow-hidden animate-scale-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span className="p-1.5 bg-brand-100 rounded-lg text-brand-600">
                <Icon name="monitor" className="w-4 h-4" />
              </span>
              Monitoring User
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Online: <strong>{onlineCount}</strong> - Update: {data?.generated_at ? formatDateTime(data.generated_at) : '-'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors font-medium"
            >
              Refresh
            </button>
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors font-medium"
            >
              Tutup
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto bg-slate-50/50">
          {loading && <p className="text-sm text-slate-500 text-center py-4">Memuat data monitoring...</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}

          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Siswa ({students.length})</h4>
            <div className="space-y-2">
              {students.length
                ? students.map((user) => <MonitoringRow key={user.id} user={user} showKelas />)
                : <p className="text-xs text-slate-400">Tidak ada data siswa.</p>}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Guru ({teachers.length})</h4>
            <div className="space-y-2">
              {teachers.length
                ? teachers.map((user) => <MonitoringRow key={user.id} user={user} />)
                : <p className="text-xs text-slate-400">Tidak ada data guru.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

MonitoringModal.displayName = 'MonitoringModal'

export default MonitoringModal
