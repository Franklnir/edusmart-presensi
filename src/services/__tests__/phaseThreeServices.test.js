import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiClient = vi.fn()

vi.mock('../../lib/api/client', () => ({ apiClient }))
vi.mock('../../lib/api/requestId', () => ({ generateRequestId: () => 'generated-key' }))

const { assignmentService, submissionService } = await import('../assignmentService')
const { attendanceService } = await import('../attendanceService')
const { academicContextService } = await import('../academicContextService')
const { adminDashboardService } = await import('../adminDashboardService')
const { announcementService } = await import('../announcementService')
const { currentProfileService } = await import('../currentProfileService')
const { organizationService } = await import('../organizationService')
const { scheduleService } = await import('../scheduleService')
const { gradeService } = await import('../gradeService')

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

  it('loads academic context through its tenant-scoped V2 resource', async () => {
    await academicContextService.getActiveContext()

    expect(apiClient).toHaveBeenCalledWith('/api/v2/academic-context', {
      method: 'GET',
      cacheTtlMs: 60 * 1000,
      dedupe: true
    })
  })

  it('loads the compact admin dashboard through the V2 resource', async () => {
    await adminDashboardService.getDashboard({ tahun_ajaran: '2026/2027' })

    expect(apiClient).toHaveBeenCalledWith('/api/v2/dashboard/admin', {
      method: 'GET',
      params: { tahun_ajaran: '2026/2027' },
      cacheTtlMs: 15 * 1000,
      dedupe: true
    })
  })

  it('loads the tenant-scoped organization shell through the V2 resource', async () => {
    await organizationService.getContext()

    expect(apiClient).toHaveBeenCalledWith('/api/v2/organizations', {
      method: 'GET',
      cacheTtlMs: 60 * 1000,
      dedupe: true
    })
  })

  it('uses idempotent V2 mutations for announcements', async () => {
    await announcementService.storeAnnouncement({
      judul: 'Rapat',
      keterangan: 'Besok',
      target: 'guru'
    })

    expect(apiClient).toHaveBeenCalledWith('/api/v2/announcements', expect.objectContaining({
      method: 'POST',
      headers: { 'Idempotency-Key': 'generated-key' },
      body: {
        judul: 'Rapat',
        keterangan: 'Besok',
        target: 'guru',
        idempotency_key: 'generated-key'
      }
    }))
  })

  it('loads and saves teacher grade weights through the fixed V2 resource', async () => {
    await gradeService.listWeights({ tahun_ajaran: '2026/2027', semester: 'Ganjil' })
    expect(apiClient).toHaveBeenNthCalledWith(1, '/api/v2/grades/weights', {
      method: 'GET',
      params: { tahun_ajaran: '2026/2027', semester: 'Ganjil' },
      cacheTtlMs: 15 * 1000,
      dedupe: true
    })

    await gradeService.saveWeight({
      tahun_ajaran: '2026/2027',
      semester: 'Ganjil',
      guru_id: 'forged-teacher',
      mapel: 'Matematika',
      bobot_tugas_pr: 30,
      bobot_quiz_reguler: 20,
      bobot_quiz_uts: 20,
      bobot_quiz_uas: 30,
      sumber_uts: 'digital',
      sumber_uas: 'manual',
      jenis_manual: 'nilai_tambah',
      label_manual: 'Nilai tambah'
    })

    expect(apiClient).toHaveBeenNthCalledWith(2, '/api/v2/grades/weights', {
      method: 'PUT',
      headers: { 'Idempotency-Key': 'generated-key' },
      body: {
        tahun_ajaran: '2026/2027',
        semester: 'Ganjil',
        guru_id: 'forged-teacher',
        mapel: 'Matematika',
        bobot_tugas_pr: 30,
        bobot_quiz_reguler: 20,
        bobot_quiz_uts: 20,
        bobot_quiz_uas: 30,
        sumber_uts: 'digital',
        sumber_uas: 'manual',
        jenis_manual: 'nilai_tambah',
        label_manual: 'Nilai tambah',
        idempotency_key: 'generated-key'
      }
    })
  })

  it('uses an idempotent self-profile endpoint and strips privileged fields', async () => {
    await currentProfileService.updateCurrentProfile({
      jk: 'P',
      no_hp_siswa: '081234567890',
      tenant_id: 'forged',
      role: 'admin',
      photo_url: 'https://permanent.example/avatar.jpg'
    })

    expect(apiClient).toHaveBeenCalledWith('/api/v2/profile', {
      method: 'PATCH',
      headers: { 'Idempotency-Key': 'generated-key' },
      body: {
        jk: 'P',
        no_hp_siswa: '081234567890',
        idempotency_key: 'generated-key'
      }
    })
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
