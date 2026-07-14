import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiClient = vi.fn()

vi.mock('../../lib/api/client', () => ({ apiClient }))
vi.mock('../../lib/api/requestId', () => ({ generateRequestId: () => 'generated-key' }))

const { assignmentService, submissionService } = await import('../assignmentService')
const { attendanceService } = await import('../attendanceService')

describe('Phase 3 API V2 services', () => {
  beforeEach(() => {
    apiClient.mockReset()
    apiClient.mockResolvedValue({
      data: [{ id: 1 }],
      payload: { success: true, data: [{ id: 1 }], meta: { total: 1 } }
    })
  })

  it('uses the callable API client and preserves the response envelope', async () => {
    const result = await assignmentService.getAssignments({ kelas: '10A' })

    expect(apiClient).toHaveBeenCalledWith('/api/v2/assignments', {
      method: 'GET',
      params: { kelas: '10A' }
    })
    expect(result).toEqual({ success: true, data: [{ id: 1 }], meta: { total: 1 } })
  })

  it('adds one idempotency key to assignment mutations and strips server fields', async () => {
    await assignmentService.storeAssignment({
      kelas: '10A',
      judul: 'Tugas',
      mapel: 'Matematika',
      deadline: '2026-07-20T00:00:00Z',
      tenant_id: 'forged',
      created_by: 'forged',
      file_url: 'https://example.test/permanent'
    })

    expect(apiClient).toHaveBeenCalledWith('/api/v2/assignments', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'generated-key' },
      body: {
        kelas: '10A',
        judul: 'Tugas',
        mapel: 'Matematika',
        deadline: '2026-07-20T00:00:00Z',
        idempotency_key: 'generated-key'
      }
    })
  })

  it('does not send student identity, status, or arbitrary URLs in a submission', async () => {
    await submissionService.storeSubmission({
      tugas_id: 12,
      user_id: 'forged',
      status: 'dinilai',
      file_url: 'https://example.test/permanent',
      link_url: 'https://example.test/reference'
    })

    expect(apiClient).toHaveBeenCalledWith('/api/v2/submissions', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'generated-key' },
      body: {
        tugas_id: 12,
        link_url: 'https://example.test/reference',
        idempotency_key: 'generated-key'
      }
    })
  })

  it('uses PATCH and idempotency for attendance request decisions', async () => {
    await attendanceService.updateAttendanceRequest('request-1', { action: 'izin' })

    expect(apiClient).toHaveBeenCalledWith('/api/v2/attendance-requests/request-1', {
      method: 'PATCH',
      headers: { 'Idempotency-Key': 'generated-key' },
      body: { action: 'izin', idempotency_key: 'generated-key' }
    })
  })

  it('adds idempotency to assignment deletion', async () => {
    await assignmentService.deleteAssignment(12)

    expect(apiClient).toHaveBeenCalledWith('/api/v2/assignments/12', {
      method: 'DELETE',
      headers: { 'Idempotency-Key': 'generated-key' },
      body: { idempotency_key: 'generated-key' }
    })
  })
})
