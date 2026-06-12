import type {
  AttendanceQrScanResult,
  AttendanceQrSession,
  AuthSession,
  ManualAttendancePayload,
  QuizAnswer,
  QuizDetail,
  QuizListItem,
  QuizStartResult,
  QuizSubmitResult,
  RfidScanEvent,
  ScheduleItem,
  StudentListItem,
  SubmitTaskPayload,
  TaskItem,
  TenantContext,
  UserProfile,
} from '@/types/mobile';
import { apiRequest, setApiSession, setApiTenant } from './client';

type LoginResponse = {
  access_token: string;
  token_type: string;
  profile: UserProfile;
  user: { id: string; email: string };
};

/* ── Auth ── */

export async function searchSchools(search: string): Promise<TenantContext[]> {
  const qs = encodeURIComponent(search);
  const rows = await apiRequest<Array<Record<string, string | null>>>(`/api/mobile/schools?search=${qs}&limit=12`, {
    authenticated: false,
  });

  return rows.map(row => ({
    id: String(row.id || row.tenant_id || ''),
    slug: String(row.slug || row.tenant_slug || ''),
    name: String(row.name || ''),
    host: row.host ? String(row.host) : null,
    apiBaseUrl: String(row.apiBaseUrl || row.api_base_url || ''),
    logoUrl: row.logoUrl ? String(row.logoUrl) : null,
  })).filter(row => row.id && row.slug && row.apiBaseUrl);
}

export async function loginMobile(tenant: TenantContext, identifier: string, password: string): Promise<AuthSession> {
  setApiTenant(tenant);
  const data = await apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    authenticated: false,
    headers: { 'X-Mobile-App': 'edusmart-presensi' },
    body: JSON.stringify({
      email: identifier,
      password,
      mobile: true,
    }),
  });

  const session: AuthSession = {
    token: data.access_token,
    tenant,
    profile: data.profile,
  };
  setApiSession(session);
  return session;
}

export async function logoutMobile(): Promise<{ ok: true }> {
  await apiRequest<unknown>('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  return { ok: true };
}

export function fetchMe(): Promise<{ profile: UserProfile; tenant: TenantContext }> {
  return apiRequest('/api/mobile/me');
}

/* ── Dashboard ── */

export function fetchDashboard(): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/dashboard');
}

/* ── Guru: Schedules & Classes ── */

export function fetchGuruSchedulesToday(): Promise<ScheduleItem[]> {
  return apiRequest('/api/mobile/guru/schedules/today');
}

export function fetchGuruClasses(): Promise<Array<Record<string, unknown>>> {
  return apiRequest('/api/mobile/guru/classes');
}

export function fetchGuruClassDetail(classId: string): Promise<{ kelas_id: string; students: StudentListItem[] }> {
  return apiRequest(`/api/mobile/guru/classes/${encodeURIComponent(classId)}`);
}

export function fetchGuruAttendanceSummary(): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/guru/attendance/summary');
}

/* ── Guru: RFID / NFC scan ── */

export function postRfidScan(event: RfidScanEvent): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/guru/rfid/scan', {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

export function syncRfidEvents(events: RfidScanEvent[]): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/guru/rfid/sync', {
    method: 'POST',
    body: JSON.stringify({ events }),
  });
}

/* ── Guru: QR Absensi Kelas (Guru tampilkan QR → Siswa scan) ── */

export function postAttendanceQrSession(jadwalId: string, kelasId: string): Promise<AttendanceQrSession> {
  return apiRequest('/api/attendance-qr/session', {
    method: 'POST',
    body: JSON.stringify({ jadwal_id: jadwalId, kelas_id: kelasId }),
  });
}

/* ── Guru: Manual Attendance ── */

export function postManualAttendance(payload: ManualAttendancePayload): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/guru/attendance/manual', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/* ── Siswa: Attendance ── */

export function fetchSiswaAttendance(): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/siswa/attendance');
}

export function fetchSiswaSchedules(): Promise<ScheduleItem[]> {
  return apiRequest('/api/mobile/siswa/schedules');
}

/* ── Siswa: QR Absensi (Siswa scan QR guru) ── */

export function postAttendanceQrScan(token: string): Promise<AttendanceQrScanResult> {
  return apiRequest('/api/attendance-qr/scan', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/* ── Siswa: Tasks / Tugas ── */

export function fetchSiswaTasks(): Promise<TaskItem[]> {
  return apiRequest('/api/mobile/siswa/tasks');
}

export function submitTaskAnswer(payload: SubmitTaskPayload): Promise<Record<string, unknown>> {
  return apiRequest('/api/tugas/jawaban/submit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/* ── Siswa: Grades ── */

export function fetchSiswaGrades(): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/siswa/grades');
}

/* ── Siswa: Digital Card ── */

export function fetchDigitalCard(): Promise<{ token: string; expires_at: string; student: Record<string, unknown> }> {
  return apiRequest('/api/mobile/siswa/digital-card');
}

/* ── Siswa: Quiz ── */

export function fetchQuizDashboard(kelas?: string): Promise<{ rows: QuizListItem[]; meta: Record<string, unknown> }> {
  const params = kelas ? `?kelas=${encodeURIComponent(kelas)}` : '';
  return apiRequest(`/api/quiz/dashboard${params}`);
}

export function fetchQuizDetail(quizId: string): Promise<QuizDetail> {
  return apiRequest(`/api/quiz/${encodeURIComponent(quizId)}/detail`);
}

export function postQuizStart(quizId: string, accessCode?: string): Promise<QuizStartResult> {
  return apiRequest('/api/quiz/start', {
    method: 'POST',
    body: JSON.stringify({ quiz_id: quizId, access_code: accessCode }),
  });
}

export function postQuizAnswer(
  quizId: string,
  submissionId: string,
  questionId: string,
  optionId?: string | null,
  essayAnswer?: string | null,
): Promise<{ answer_id: string; submission_id: string; question_id: string; saved_at: string }> {
  return apiRequest('/api/quiz/answer', {
    method: 'POST',
    body: JSON.stringify({
      quiz_id: quizId,
      submission_id: submissionId,
      question_id: questionId,
      option_id: optionId ?? undefined,
      essay_answer: essayAnswer ?? undefined,
    }),
  });
}

export function postQuizAnswersBatch(
  quizId: string,
  submissionId: string,
  answers: Array<{ question_id: string; option_id?: string | null; essay_answer?: string | null }>,
): Promise<{ submission_id: string; answers: QuizAnswer[]; saved_count: number }> {
  return apiRequest('/api/quiz/answers/batch', {
    method: 'POST',
    body: JSON.stringify({ quiz_id: quizId, submission_id: submissionId, answers }),
  });
}

export function postQuizSubmit(
  quizId: string,
  submissionId: string,
  answers?: Array<{ question_id: string; option_id?: string | null; essay_answer?: string | null }>,
): Promise<QuizSubmitResult> {
  return apiRequest('/api/quiz/submit', {
    method: 'POST',
    body: JSON.stringify({
      quiz_id: quizId,
      submission_id: submissionId,
      answers: answers ?? [],
    }),
  });
}
