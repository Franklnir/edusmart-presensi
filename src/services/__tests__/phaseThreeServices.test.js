import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiClient = vi.fn()

vi.mock('../../lib/api/client', () => ({ apiClient }))
vi.mock('../../lib/api/requestId', () => ({ generateRequestId: () => 'generated-key' }))

const { assignmentService, submissionService } = await import('../assignmentService')
const { attendanceService } = await import('../attendanceService')
const { scheduleService } = await import('../scheduleService')

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

  it('strips tenant and period fields from schedule mutations', async () => {
    await scheduleService.storeSchedule({
      kelas_id: 'class-1',
      hari: 'Senin',
      mapel: 'Matematika',
      guru_id: 'd6ce9361-084a-4516-9099-5917cfac8b5b',
      jam_mulai: '07:00',
      jam_selesai: '08:00',
      tenant_id: 'forged',
      tahun_ajaran: '2099/2100',
      semester: 'Genap',
      guru_nama: 'forged'
    })

    expect(apiClient).toHaveBeenCalledWith('/api/v2/schedules', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'generated-key' },
      body: {
        kelas_id: 'class-1',
        hari: 'Senin',
        mapel: 'Matematika',
        guru_id: 'd6ce9361-084a-4516-9099-5917cfac8b5b',
        jam_mulai: '07:00',
        jam_selesai: '08:00',
        idempotency_key: 'generated-key'
      }
    })
  })

  it('uses class identity and idempotency when deleting a schedule', async () => {
    await scheduleService.deleteSchedule('legacy-id', 'class-1')

    expect(apiClient).toHaveBeenCalledWith('/api/v2/schedules/legacy-id', {
      method: 'DELETE',
      headers: { 'Idempotency-Key': 'generated-key' },
      body: { kelas_id: 'class-1', idempotency_key: 'generated-key' }
    })
  })

  it('loads every schedule page before an all-class export uses the result', async () => {
    apiClient
      .mockResolvedValueOnce({ payload: { success: true, data: [{ id: 'one' }], meta: { last_page: 2 } } })
      .mockResolvedValueOnce({ payload: { success: true, data: [{ id: 'two' }], meta: { last_page: 2 } } })

    await expect(scheduleService.listAllSchedules({ tahun_ajaran: '2026/2027' }))
      .resolves.toEqual({ data: [{ id: 'one' }, { id: 'two' }] })

    expect(apiClient).toHaveBeenNthCalledWith(1, '/api/v2/schedules', {
      method: 'GET',
      params: { tahun_ajaran: '2026/2027', per_page: 500, page: 1 }
    })
    expect(apiClient).toHaveBeenNthCalledWith(2, '/api/v2/schedules', {
      method: 'GET',
      params: { tahun_ajaran: '2026/2027', per_page: 500, page: 2 }
    })
  })

  it('derives sorted subject options from the scoped V2 schedule response', async () => {
    apiClient.mockResolvedValueOnce({
      payload: {
        success: true,
        data: [
          { id: '2', mapel: 'Matematika' },
          { id: '1', mapel: 'Biologi' },
          { id: '3', mapel: 'Matematika' }
        ],
        meta: { last_page: 1 }
      }
    })

    await expect(scheduleService.listSubjectOptions({
      kelas_id: 'X-A',
      hari: 'Senin',
      tahun_ajaran: '2026/2027'
    })).resolves.toEqual({
      data: [
        { id: '1', mapel: 'Biologi' },
        { id: '2', mapel: 'Matematika' }
      ]
    })

    expect(apiClient).toHaveBeenCalledWith('/api/v2/schedules', {
      method: 'GET',
      params: {
        kelas_id: 'X-A',
        hari: 'Senin',
        tahun_ajaran: '2026/2027',
        per_page: 500,
        page: 1
      }
    })
  })
})
