import { apiFetch, buildQueryString, invalidateDbSelectCache } from './supabase'

const adminApi = {
    async provisionUser(payload = {}) {
      const res = await apiFetch('/api/admin/users/provision', {
        method: 'POST',
        body: payload
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async deleteUser(userId) {
      const res = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateUserStatus(userId, payload = {}) {
      const res = await apiFetch(`/api/admin/users/${userId}/status`, {
        method: 'PATCH',
        body: payload
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateTeacherName(userId, nama) {
      const res = await apiFetch(`/api/admin/teachers/${userId}/name`, {
        method: 'PATCH',
        body: { nama }
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateTeacherProfile(userId, payload = {}) {
      const res = await apiFetch(`/api/admin/teachers/${userId}/profile`, {
        method: 'PATCH',
        body: payload
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async dashboardSummary() {
      const res = await apiFetch('/api/admin/dashboard-summary', {
        method: 'GET',
        cacheTtlMs: 60 * 1000,
        persistCache: true,
        staleCacheTtlMs: 10 * 60 * 1000,
        staleKey: 'admin.dashboard-summary',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async students(params = {}) {
      const res = await apiFetch(`/api/admin/students${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 10 * 60 * 1000,
        staleKey: 'admin.students',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async studentDetail(studentId) {
      const id = encodeURIComponent(String(studentId || ''))
      const res = await apiFetch(`/api/admin/students/${id}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 5 * 60 * 1000,
        staleKey: `admin.student-detail.${id}`,
        timeoutMs: 12000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async importStudents(payload = {}) {
      const res = await apiFetch('/api/admin/students/import', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 120000
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async academicSummary(params = {}) {
      const res = await apiFetch(`/api/admin/academic-summary${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 15 * 1000,
        persistCache: true,
        staleCacheTtlMs: 10 * 60 * 1000,
        staleKey: 'admin.academic-summary',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async applyAcademicPeriod(payload = {}) {
      const res = await apiFetch('/api/admin/academic-period/apply', {
        method: 'POST',
        body: payload,
        timeoutMs: 45000
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error, raw: res.raw }
    },
    async restoreAcademicPeriodRoster(payload = {}) {
      const res = await apiFetch('/api/admin/academic-period/restore-roster', {
        method: 'POST',
        body: payload,
        timeoutMs: 45000
      })
      if (!res.error && payload?.apply) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error, raw: res.raw }
    },
    async studentOptions(params = {}) {
      const res = await apiFetch(`/api/admin/student-options${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 20 * 1000,
        persistCache: true,
        staleCacheTtlMs: 10 * 60 * 1000,
        staleKey: `admin.student-options.${params?.kelas || 'all'}`,
        timeoutMs: 12000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async teachers(params = {}) {
      const res = await apiFetch(`/api/admin/teachers${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 10 * 60 * 1000,
        staleKey: 'admin.teachers',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async certificates(params = {}) {
      const res = await apiFetch(`/api/admin/certificates${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 30 * 1000,
        persistCache: true,
        staleCacheTtlMs: 10 * 60 * 1000,
        staleKey: 'admin.certificates',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async scanSessionSummary(params = {}) {
      const res = await apiFetch(`/api/admin/scan-session-summary${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 2 * 60 * 1000,
        staleKey: 'admin.scan-session-summary',
        timeoutMs: 12000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async featurePermissions() {
      const res = await apiFetch('/api/admin/feature-permissions', {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 10 * 60 * 1000,
        staleKey: 'admin.feature-permissions',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async createFeaturePermission(payload = {}) {
      const res = await apiFetch('/api/admin/feature-permissions', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 15000
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateFeaturePermission(id, payload = {}) {
      const res = await apiFetch(`/api/admin/feature-permissions/${encodeURIComponent(String(id || ''))}`, {
        method: 'PATCH',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 15000
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async deleteFeaturePermission(id) {
      const res = await apiFetch(`/api/admin/feature-permissions/${encodeURIComponent(String(id || ''))}`, {
        method: 'DELETE',
        cacheTtlMs: 0,
        timeoutMs: 15000
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async backup(options = {}) {
      const params = new URLSearchParams()
      const mode = String(options?.mode || '').trim()
      const periodType = String(options?.periodType || options?.period_type || '').trim()
      const tahunAjaran = String(options?.tahunAjaran || options?.tahun_ajaran || '').trim()
      const semester = String(options?.semester || '').trim()
      const startDate = String(options?.startDate || options?.start_date || '').trim()
      const endDate = String(options?.endDate || options?.end_date || '').trim()
      const monthsRaw = options?.months

      if (mode) {
        params.set('mode', mode)
      }

      if (periodType) {
        params.set('period_type', periodType)
      }

      if (Number.isFinite(Number(monthsRaw)) && Number(monthsRaw) > 0) {
        params.set('months', String(Math.max(1, Math.min(12, Math.trunc(Number(monthsRaw))))))
      }

      if (tahunAjaran) params.set('tahun_ajaran', tahunAjaran)
      if (semester) params.set('semester', semester)
      if (startDate) params.set('start_date', startDate)
      if (endDate) params.set('end_date', endDate)

      const query = params.toString() ? `?${params.toString()}` : ''
      const res = await apiFetch(`/api/admin/backup${query}`, { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async monitoring() {
      const res = await apiFetch('/api/admin/monitoring', {
        method: 'GET',
        cacheTtlMs: 5000,
        persistCache: true,
        staleCacheTtlMs: 60 * 1000,
        staleKey: 'admin.monitoring',
        timeoutMs: 12000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async delegatedPermissions() {
      const res = await apiFetch('/api/guru/admin-permissions', {
        method: 'GET',
        cacheTtlMs: 30 * 1000,
        persistCache: true,
        staleCacheTtlMs: 5 * 60 * 1000,
        staleKey: 'guru.admin-permissions',
        timeoutMs: 12000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async scanSettings() {
      const res = await apiFetch('/api/admin/scan-settings', { method: 'GET', cacheTtlMs: 0 })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateScanSettings(payload = {}) {
      const res = await apiFetch('/api/admin/scan-settings', {
        method: 'PATCH',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async restoreBackup(payload) {
      const res = await apiFetch('/api/admin/backup/restore', {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async saveBackupToGoogleDrive(payload = {}) {
      const res = await apiFetch('/api/admin/backup/google-drive', {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async backupMonthlyStatus(options = {}) {
      const query = new URLSearchParams()
      if (options?.refresh) query.set('refresh', '1')
      const suffix = query.toString() ? `?${query.toString()}` : ''
      const res = await apiFetch(`/api/admin/backup/monthly-status${suffix}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 5 * 60 * 1000,
        staleKey: 'admin.backup-monthly-status',
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async saveMonthlyBackupToGoogleDrive(payload = {}) {
      const res = await apiFetch('/api/admin/backup/google-drive/monthly', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 60000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async autoMonthlyBackupToGoogleDrive(payload = {}) {
      const res = await apiFetch('/api/admin/backup/google-drive/monthly/auto', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 180000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async backupMonthlyJobStatus(jobId) {
      const res = await apiFetch(`/api/admin/backup/google-drive/monthly/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        cacheTtlMs: 0,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async approvals(params = {}) {
      const query = new URLSearchParams()
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        query.set(String(key), String(value))
      })
      const suffix = query.toString() ? `?${query.toString()}` : ''
      const res = await apiFetch(`/api/admin/approvals${suffix}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 2 * 60 * 1000,
        staleKey: `admin.approvals.${suffix}`,
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async approveApproval(id, payload = {}) {
      const res = await apiFetch(`/api/admin/approvals/${id}/approve`, {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async rejectApproval(id, payload = {}) {
      const res = await apiFetch(`/api/admin/approvals/${id}/reject`, {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async whatsapp() {
      const res = await apiFetch('/api/admin/whatsapp', {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 2 * 60 * 1000,
        staleKey: 'admin.whatsapp',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async connectWhatsApp() {
      const res = await apiFetch('/api/admin/whatsapp/connect', { method: 'POST', body: {} })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async syncWhatsApp() {
      const res = await apiFetch('/api/admin/whatsapp/sync', { method: 'POST', body: {} })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async logoutWhatsApp() {
      const res = await apiFetch('/api/admin/whatsapp/logout', { method: 'POST', body: {} })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateWhatsAppSettings(payload = {}) {
      const res = await apiFetch('/api/admin/whatsapp/settings', {
        method: 'PATCH',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async sendWhatsAppTest(payload = {}) {
      const res = await apiFetch('/api/admin/whatsapp/test', {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async googleDrive(params = {}) {
      const query = new URLSearchParams()
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        query.set(String(key), String(value))
      })
      const suffix = query.toString() ? `?${query.toString()}` : ''
      const res = await apiFetch(`/api/admin/google-drive${suffix}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 5 * 60 * 1000,
        staleKey: 'admin.google-drive',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async googleDriveFiles(params = {}) {
      const query = new URLSearchParams()
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        query.set(String(key), String(value))
      })
      const suffix = query.toString() ? `?${query.toString()}` : ''
      const res = await apiFetch(`/api/admin/google-drive/files${suffix}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 5 * 60 * 1000,
        staleKey: `admin.google-drive-files.${suffix}`,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async googleDriveConnectUrl(payload = {}) {
      const res = await apiFetch('/api/admin/google-drive/connect-url', {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async syncGoogleDrive(params = {}) {
      const query = new URLSearchParams()
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        query.set(String(key), String(value))
      })
      const suffix = query.toString() ? `?${query.toString()}` : ''
      const res = await apiFetch(`/api/admin/google-drive/sync${suffix}`, {
        method: 'POST',
        body: {}
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async recoverGoogleDrive() {
      const res = await apiFetch('/api/admin/google-drive/recover', {
        method: 'POST',
        body: {},
        cacheTtlMs: 0,
        timeoutMs: 30000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async disconnectGoogleDrive() {
      const res = await apiFetch('/api/admin/google-drive/disconnect', {
        method: 'POST',
        body: {}
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async storageManager(params = {}) {
      const res = await apiFetch(`/api/admin/storage-manager${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        persistCache: true,
        staleCacheTtlMs: 5 * 60 * 1000,
        staleKey: 'admin.storage-manager',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async storageCleanupPreview(payload = {}) {
      const res = await apiFetch('/api/admin/storage-manager/cleanup/preview', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async storageCleanupExecute(payload = {}) {
      const res = await apiFetch('/api/admin/storage-manager/cleanup/execute', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 60000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async syncObjectStorage(payload = {}) {
      const res = await apiFetch('/api/admin/storage-manager/object-storage/sync', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 120000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async restoreStorageTrash(fileId) {
      const res = await apiFetch(`/api/admin/storage-manager/trash/${fileId}/restore`, {
        method: 'POST',
        body: {},
        cacheTtlMs: 0,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    }
  }

export default adminApi
