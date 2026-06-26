import { apiFetch, buildQueryString, downloadAuthenticatedFile } from './supabase'

const superApi = {
    async me() {
      const res = await apiFetch('/api/super/me', { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async domains() {
      const res = await apiFetch('/api/super/domains', { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async createAdminDomain(payload = {}) {
      const res = await apiFetch('/api/super/domains', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async createTenantDomain(tenantId, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${tenantId}/domains`, {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async checkDomain(id) {
      const res = await apiFetch(`/api/super/domains/${id}/check`, {
        method: 'POST',
        body: {}
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async deleteDomain(id) {
      const res = await apiFetch(`/api/super/domains/${id}`, { method: 'DELETE' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async tenants() {
      const res = await apiFetch('/api/super/tenants', { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async tenantDetail(id) {
      const res = await apiFetch(`/api/super/tenants/${id}`, { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async tenantBackup(id, options = {}) {
      const mode = String(options?.mode || '').trim()
      const monthsRaw = options?.months
      const params = new URLSearchParams()
      if (mode) params.set('mode', mode)
      if (Number.isFinite(Number(monthsRaw)) && Number(monthsRaw) > 0) {
        params.set('months', String(Math.trunc(Number(monthsRaw))))
      }
      const query = params.toString() ? `?${params.toString()}` : ''
      const res = await apiFetch(`/api/super/tenants/${id}/backup${query}`, { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async saveTenantBackupToGoogleDrive(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/backup/google-drive`, {
        method: 'POST',
        body: payload,
        timeoutMs: 60000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async tenantBackupMonthlyStatus(id, options = {}) {
      const query = new URLSearchParams()
      if (options?.refresh) query.set('refresh', '1')
      const suffix = query.toString() ? `?${query.toString()}` : ''
      const res = await apiFetch(`/api/super/tenants/${id}/backup/monthly-status${suffix}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        staleKey: `super.tenant-backup-monthly-status.${id}`,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async saveTenantMonthlyBackupToGoogleDrive(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/backup/google-drive/monthly`, {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 60000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async autoTenantMonthlyBackupToGoogleDrive(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/backup/google-drive/monthly/auto`, {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 180000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async tenantMonthlyBackupJobStatus(id, jobId) {
      const res = await apiFetch(`/api/super/tenants/${id}/backup/google-drive/monthly/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        cacheTtlMs: 0,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async restoreTenant(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/restore`, {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateTenantStatus(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/status`, {
        method: 'PATCH',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateTenantRfidMqtt(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/rfid-mqtt`, {
        method: 'PATCH',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async provisionTenantRfidMosquitto(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/rfid-mqtt/mosquitto`, {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async tenantRfidDevices(id) {
      const res = await apiFetch(`/api/super/tenants/${id}/rfid-devices`, {
        cacheTtlMs: 5000,
        staleKey: `super.rfid-devices.${id}`
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async storeTenantRfidDevice(id, payload) {
      const res = await apiFetch(`/api/super/tenants/${id}/rfid-devices`, {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async deleteTenantRfidDevice(id, deviceId) {
      const encodedDeviceId = encodeURIComponent(String(deviceId || ''))
      const res = await apiFetch(`/api/super/tenants/${id}/rfid-devices/${encodedDeviceId}`, {
        method: 'DELETE'
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async createTenant(payload) {
      const res = await apiFetch('/api/super/tenants', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async resetTenantAdminPassword(tenantId, userId, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${tenantId}/admins/${userId}/reset-password`, {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async setTenantPrimaryAdmin(tenantId, userId) {
      const res = await apiFetch(`/api/super/tenants/${tenantId}/admins/${userId}/primary`, {
        method: 'PATCH',
        body: {}
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async admins() {
      const res = await apiFetch('/api/super/admins', { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async createAdmin(payload) {
      const res = await apiFetch('/api/super/admins', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async deleteAdmin(id) {
      const res = await apiFetch(`/api/super/admins/${id}`, { method: 'DELETE' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async monitoringOverview() {
      const res = await apiFetch('/api/super/monitoring', {
        method: 'GET',
        cacheTtlMs: 5000,
        staleKey: 'super.monitoring',
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async serverMonitoring() {
      const res = await apiFetch('/api/super/monitoring/server', {
        method: 'GET',
        cacheTtlMs: 3000,
        staleKey: 'super.monitoring-server',
        timeoutMs: 15000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async monitoringLogs(params = {}) {
      const res = await apiFetch(`/api/super/monitoring/logs${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 3000,
        staleKey: `super.monitoring-logs.${JSON.stringify(params || {})}`,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async monitoringLogDetail(id) {
      const res = await apiFetch(`/api/super/monitoring/logs/${encodeURIComponent(id)}`, {
        method: 'GET',
        cacheTtlMs: 3000,
        staleKey: `super.monitoring-log.${id}`,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async storageOverview() {
      const res = await apiFetch('/api/super/storage', {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        staleKey: 'super.storage',
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async tenantStorage(id, params = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/storage${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        staleKey: `super.tenant-storage.${id}`,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async tenantGoogleDrive(id, params = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/google-drive${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        staleKey: `super.tenant-google-drive.${id}`,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async tenantGoogleDriveFiles(id, params = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/google-drive/files${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        staleKey: `super.tenant-google-drive-files.${id}`,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async syncTenantGoogleDrive(id, params = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/google-drive/sync${buildQueryString(params)}`, {
        method: 'POST',
        body: {},
        cacheTtlMs: 0,
        timeoutMs: 30000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateTenantStorageQuota(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/storage/quota`, {
        method: 'PATCH',
        body: payload,
        cacheTtlMs: 0
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async syncObjectStorage(payload = {}) {
      const res = await apiFetch('/api/super/storage/object-storage/sync', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 180000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async syncTenantObjectStorage(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/storage/object-storage/sync`, {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 120000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async superStorageCleanupPreview(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/storage/cleanup/preview`, {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async superStorageCleanupExecute(id, payload = {}) {
      const res = await apiFetch(`/api/super/tenants/${id}/storage/cleanup/execute`, {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 60000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async restoreStorageTrash(id, fileId) {
      const res = await apiFetch(`/api/super/tenants/${id}/storage/trash/${fileId}/restore`, {
        method: 'POST',
        body: {},
        cacheTtlMs: 0,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async deleteStorageTrash(id, fileId) {
      const res = await apiFetch(`/api/super/tenants/${id}/storage/trash/${fileId}`, {
        method: 'DELETE',
        cacheTtlMs: 0,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async purgeAllTenantTrash(id) {
      const res = await apiFetch(`/api/super/tenants/${id}/storage/trash/purge-all`, {
        method: 'POST',
        body: {},
        cacheTtlMs: 0,
        timeoutMs: 120000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async purgeExpiredStorageTrash() {
      const res = await apiFetch('/api/super/storage/trash/purge-expired', {
        method: 'POST',
        body: {},
        cacheTtlMs: 0,
        timeoutMs: 60000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async whatsapp(params = {}) {
      const res = await apiFetch(`/api/super/whatsapp${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 10 * 1000,
        staleKey: `super.whatsapp.${JSON.stringify(params || {})}`,
        timeoutMs: 20000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async connectWhatsApp() {
      const res = await apiFetch('/api/super/whatsapp/connect', {
        method: 'POST',
        body: {},
        cacheTtlMs: 0,
        timeoutMs: 30000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async syncWhatsApp() {
      const res = await apiFetch('/api/super/whatsapp/sync', {
        method: 'POST',
        body: {},
        cacheTtlMs: 0,
        timeoutMs: 30000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async logoutWhatsApp() {
      const res = await apiFetch('/api/super/whatsapp/logout', {
        method: 'POST',
        body: {},
        cacheTtlMs: 0,
        timeoutMs: 30000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateWhatsAppTenantStatus(payload = {}) {
      const { tenant_id, is_enabled } = payload
      const res = await apiFetch(`/api/super/whatsapp/tenants/${tenant_id}/status`, {
        method: 'PATCH',
        body: { is_enabled },
        cacheTtlMs: 0,
        timeoutMs: 30000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async sendWhatsAppTest(payload = {}) {
      const res = await apiFetch('/api/super/whatsapp/test', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 30000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async runDailyAlphaWhatsApp(payload = {}) {
      const res = await apiFetch('/api/super/whatsapp/daily-alpha/run', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 60000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async retryFailedWhatsApp(payload = {}) {
      const res = await apiFetch('/api/super/whatsapp/retry-failed', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0,
        timeoutMs: 30000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async auditTrail(params = {}) {
      const query = new URLSearchParams()
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        query.set(String(key), String(value))
      })
      const suffix = query.toString() ? `?${query.toString()}` : ''
      const res = await apiFetch(`/api/super/audit-trail${suffix}`, { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async plugins() {
      const res = await apiFetch('/api/super/plugins', { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async inspectPlugin(formData) {
      const res = await apiFetch('/api/super/plugins/inspect', {
        method: 'POST',
        body: formData
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async installPlugin(payload = {}) {
      const res = await apiFetch('/api/super/plugins', {
        method: 'POST',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updatePluginStatus(id, payload = {}) {
      const res = await apiFetch(`/api/super/plugins/${id}/status`, {
        method: 'PATCH',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async deletePlugin(id, payload = {}) {
      const res = await apiFetch(`/api/super/plugins/${id}`, {
        method: 'DELETE',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async downloadPlugin(id, fallbackName = 'plugin.zip') {
      return downloadAuthenticatedFile(`/api/super/plugins/${id}/download`, fallbackName)
    }
  }

export default superApi
