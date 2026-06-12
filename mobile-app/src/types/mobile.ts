export type MobileRole = 'guru' | 'siswa';

export type TenantContext = {
  id: string;
  slug: string;
  name: string;
  host?: string | null;
  apiBaseUrl: string;
  logoUrl?: string | null;
};

export type UserProfile = {
  id: string;
  nama?: string | null;
  email?: string | null;
  role: MobileRole;
  kelas?: string | null;
  nis?: string | null;
  photo_url?: string | null;
};

export type AuthSession = {
  token: string;
  tenant: TenantContext;
  profile: UserProfile;
};

export type RfidScanEvent = {
  event_id: string;
  tenant_slug: string;
  device_id: string;
  card_uid: string;
  mode: string;
  scanned_at: string;
  source: 'mobile-nfc' | 'mobile-qr' | 'mobile-manual';
  context?: Record<string, string | number | null>;
};

export type OfflineScanItem = RfidScanEvent & {
  queued_at: string;
  attempts: number;
  last_error?: string | null;
  last_failed_at?: string | null;
  status?: 'pending' | 'failed';
  failed_permanently?: boolean;
};

export type ApiEnvelope<T> = {
  data?: T;
  error?: string;
  message?: string;
};

/* ── Schedule ── */

export type ScheduleItem = {
  id: string;
  kelas_id: string;
  hari: string;
  mapel: string;
  jam_mulai: string;
  jam_selesai: string;
  guru_nama?: string | null;
};

/* ── Attendance QR ── */

export type AttendanceQrSession = {
  success: boolean;
  token: string;
  ttl_seconds: number;
  refresh_after_seconds: number;
  issued_at: string;
  expires_at: string;
  schedule: Record<string, unknown>;
};

export type AttendanceQrScanResult = {
  success: boolean;
  message?: string;
  reason?: string;
  error?: string;
  absensi_id?: number | null;
  nama?: string;
  kelas?: string;
  mapel?: string;
  jam_absensi?: string;
};

/* ── Manual Attendance ── */

export type ManualAttendancePayload = {
  jadwal_id: string;
  kelas_id: string;
  siswa_id: string;
  status: 'Hadir' | 'Izin' | 'Sakit' | 'Alpha';
};

export type StudentListItem = {
  id: string;
  nama: string;
  nis: string;
  kelas: string;
  photo_url?: string | null;
  has_rfid: boolean;
};

/* ── Task / Tugas ── */

export type TaskItem = {
  id: string;
  judul: string;
  mapel: string;
  deadline: string | null;
  submitted: boolean;
  answer?: Record<string, unknown> | null;
};

export type SubmitTaskPayload = {
  tugas_id: string;
  link_url?: string | null;
  komentar_siswa?: string | null;
  file_url?: string | null;
};

/* ── Quiz ── */

export type QuizListItem = {
  id: string;
  nama: string;
  mapel: string;
  kelas_id: string;
  starts_at?: string | null;
  deadline_at?: string | null;
  duration_minutes?: number | null;
  is_live: boolean;
  is_active: boolean;
  question_count: number;
  submission?: QuizSubmission | null;
};

export type QuizSubmission = {
  id: string;
  quiz_id: string;
  siswa_id: string;
  status: 'ongoing' | 'finished';
  started_at?: string | null;
  finished_at?: string | null;
  score?: number | null;
  total_points?: number | null;
};

export type QuizQuestion = {
  id: string;
  quiz_id: string;
  question_text: string;
  question_type: 'multiple_choice' | 'essay';
  question_number?: number;
  poin?: number;
};

export type QuizOption = {
  id: string;
  question_id: string;
  option_text: string;
  is_correct?: boolean;
};

export type QuizAnswer = {
  id: string;
  submission_id: string;
  question_id: string;
  option_id?: string | null;
  essay_answer?: string | null;
};

export type QuizDetail = {
  quiz: Record<string, unknown>;
  questions: QuizQuestion[];
  options_by_question: Record<string, QuizOption[]>;
  submission?: QuizSubmission | null;
  answers?: QuizAnswer[];
  timing?: {
    server_now: string;
    started_at?: string | null;
    deadline_at?: string | null;
    duration_minutes?: number | null;
    remaining_seconds?: number | null;
  };
};

export type QuizStartResult = {
  submission: QuizSubmission;
  questions: QuizQuestion[];
  options_by_question: Record<string, QuizOption[]>;
  order?: string[];
  timing?: Record<string, unknown>;
};

export type QuizSubmitResult = {
  submission_id: string;
  score?: number | null;
  total_points?: number | null;
  scoring_pending?: boolean;
};
