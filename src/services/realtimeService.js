import { apiClient } from '../lib/api/client'

const INTERVAL_MS = 15000

class RealtimeChannel {
  constructor(name, table, filter, callback) {
    this.name = name
    this.table = table
    this.filter = filter
    this.callback = callback
    this.interval = null
    this.lastData = null
  }

  async poll() {
    try {
      const params = { per_page: 500 }
      if (this.filter?.tanggal) params.tanggal = this.filter.tanggal
      if (this.filter?.kelas) params.kelas = this.filter.kelas
      if (this.filter?.mapel) params.mapel = this.filter.mapel
      if (this.filter?.uid) params.uid = this.filter.uid
      if (this.filter?.guru_id) params.guru_id = this.filter.guru_id

      let endpoint = ''
      let dataKey = 'data'
      switch (this.table) {
        case 'absensi': endpoint = '/api/v2/attendance'; break
        case 'absensi_ajuan': endpoint = '/api/v2/attendance-requests'; break
        case 'absensi_settings': endpoint = '/api/v2/attendance'; break
        case 'settings': endpoint = '/api/v2/organization-context'; break
        case 'tugas': endpoint = '/api/v2/assignments'; break
        case 'tugas_jawaban': endpoint = '/api/v2/submissions'; break
        case 'jadwal': endpoint = '/api/v2/schedules'; break
        case 'jam_kosong': endpoint = '/api/v2/jam-kosong'; break
        case 'profiles': endpoint = '/api/v2/profile'; break
        case 'rfid_scans': return
        default: return
      }

      const result = await apiClient(endpoint, { method: 'GET', params, dedupe: true })
      const data = result.payload?.data || result.data
      const newData = JSON.stringify(data)
      if (newData !== this.lastData) {
        this.lastData = newData
        this.callback({
          eventType: 'UPDATE',
          table: this.table,
          new: data,
          old: null
        })
      }
    } catch {}
  }

  subscribe() {
    this.poll()
    this.interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      this.poll()
    }, INTERVAL_MS)
  }

  close() {
    if (this.interval) { clearInterval(this.interval); this.interval = null }
  }
}

export const realtimeService = {
  channel(name) {
    let _table = ''
    let _filter = {}
    let _callback = null
    const builder = {
      on(eventType, config, fn) {
        _table = config.table
        _filter = config.filter || {}
        _callback = fn
        return builder
      },
      subscribe() {
        const ch = new RealtimeChannel(name, _table, _filter, _callback)
        ch.subscribe()
        return ch
      }
    }
    return builder
  },
  removeChannel(ch) {
    if (ch && typeof ch.close === 'function') ch.close()
  }
}
