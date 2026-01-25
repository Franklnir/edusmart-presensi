-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public._policy_backup (
  saved_at timestamp with time zone NOT NULL DEFAULT now(),
  schemaname text,
  tablename text,
  policyname text,
  roles text,
  cmd text,
  qual text,
  with_check text
);
CREATE TABLE public.absensi (
  id bigint NOT NULL DEFAULT nextval('absensi_id_seq'::regclass),
  kelas text NOT NULL,
  tanggal date NOT NULL,
  uid uuid NOT NULL,
  mapel text NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['Hadir'::text, 'Izin'::text, 'Sakit'::text, 'Alpha'::text])),
  nama text,
  waktu timestamp with time zone DEFAULT now(),
  komentar text,
  oleh text,
  dikonfirmasi uuid,
  CONSTRAINT absensi_pkey PRIMARY KEY (id),
  CONSTRAINT absensi_uid_fkey FOREIGN KEY (uid) REFERENCES public.profiles(id)
);
CREATE TABLE public.absensi_ajuan (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kelas text NOT NULL,
  tanggal date NOT NULL,
  uid uuid NOT NULL,
  nama text NOT NULL,
  alasan text NOT NULL,
  mapel text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  status_guru text NOT NULL DEFAULT 'pending'::text CHECK (status_guru = ANY (ARRAY['pending'::text, 'terima'::text, 'sakit'::text, 'tolak'::text])),
  kategori_final text CHECK (kategori_final = ANY (ARRAY['Izin'::text, 'Sakit'::text, 'Alpha'::text])),
  guru_id uuid,
  guru_nama text,
  waktu_respon timestamp with time zone,
  CONSTRAINT absensi_ajuan_pkey PRIMARY KEY (id),
  CONSTRAINT absensi_ajuan_uid_fkey FOREIGN KEY (uid) REFERENCES public.profiles(id),
  CONSTRAINT absensi_ajuan_guru_id_fkey FOREIGN KEY (guru_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.absensi_eskul (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ekskul_id text,
  user_id uuid,
  tanggal date NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['Hadir'::text, 'Izin'::text, 'Alpha'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT absensi_eskul_pkey PRIMARY KEY (id),
  CONSTRAINT absensi_eskul_ekskul_id_fkey FOREIGN KEY (ekskul_id) REFERENCES public.ekskul(id),
  CONSTRAINT absensi_eskul_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.absensi_rfid_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rfid_aktif boolean DEFAULT false,
  rfid_mulai time without time zone,
  rfid_selesai time without time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT absensi_rfid_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.absensi_scan_temp (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tanggal date NOT NULL,
  siswa_id uuid NOT NULL,
  kelas text NOT NULL,
  sesi text NOT NULL CHECK (sesi = ANY (ARRAY['masuk'::text, 'pulang'::text])),
  scan_at timestamp with time zone NOT NULL DEFAULT now(),
  source text,
  card_uid text,
  mapel_count integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT absensi_scan_temp_pkey PRIMARY KEY (id),
  CONSTRAINT absensi_scan_temp_siswa_id_fkey FOREIGN KEY (siswa_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.absensi_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kelas text NOT NULL,
  tanggal date NOT NULL,
  mapel text NOT NULL,
  mode text NOT NULL DEFAULT 'manual'::text CHECK (mode = ANY (ARRAY['manual'::text, 'otomatis'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT absensi_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.admin_users (
  id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_pkey PRIMARY KEY (id),
  CONSTRAINT admin_users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.allowed_registrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role text NOT NULL CHECK (role = ANY (ARRAY['siswa'::text, 'guru'::text, 'admin'::text])),
  full_name text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT allowed_registrations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.anggota_eksku1 (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT anggota_eksku1_pkey PRIMARY KEY (id)
);
CREATE TABLE public.anggota_ekskul (
  id bigint NOT NULL DEFAULT nextval('anggota_ekskul_id_seq'::regclass),
  ekskul_id bigint,
  user_id uuid,
  CONSTRAINT anggota_ekskul_pkey PRIMARY KEY (id),
  CONSTRAINT anggota_ekskul_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.audit_log (
  id bigint NOT NULL DEFAULT nextval('audit_log_id_seq'::regclass),
  table_name text NOT NULL,
  record_id text,
  action text NOT NULL CHECK (action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])),
  old_data jsonb,
  new_data jsonb,
  user_id uuid,
  user_role text,
  timestamp timestamp with time zone DEFAULT now(),
  CONSTRAINT audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.certificates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  nama_penerima text NOT NULL,
  email text,
  kelas text,
  event text NOT NULL,
  event_date date,
  file_url text NOT NULL,
  sent boolean DEFAULT false,
  sent_at timestamp with time zone,
  issued_at timestamp with time zone DEFAULT now(),
  CONSTRAINT certificates_pkey PRIMARY KEY (id),
  CONSTRAINT certificates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.ekskul (
  id text NOT NULL,
  nama text NOT NULL,
  keterangan text,
  hari text,
  jam_mulai time without time zone,
  jam_selesai time without time zone,
  pembina_guru_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ekskul_pkey PRIMARY KEY (id),
  CONSTRAINT ekskul_pembina_guru_id_fkey FOREIGN KEY (pembina_guru_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.ekskul_anggota (
  id integer NOT NULL DEFAULT nextval('ekskul_anggota_id_seq'::regclass),
  ekskul_id text,
  user_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ekskul_anggota_pkey PRIMARY KEY (id),
  CONSTRAINT ekskul_anggota_ekskul_id_fkey FOREIGN KEY (ekskul_id) REFERENCES public.ekskul(id),
  CONSTRAINT ekskul_anggota_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.jadwal (
  id text NOT NULL,
  kelas_id text NOT NULL,
  hari text NOT NULL,
  mapel text NOT NULL,
  guru_id uuid,
  guru_nama text,
  jam_mulai time without time zone NOT NULL,
  jam_selesai time without time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT jadwal_pkey PRIMARY KEY (id, kelas_id),
  CONSTRAINT jadwal_kelas_id_fkey FOREIGN KEY (kelas_id) REFERENCES public.kelas(id),
  CONSTRAINT jadwal_guru_id_fkey FOREIGN KEY (guru_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.jam_kosong (
  id bigint NOT NULL DEFAULT nextval('jam_kosong_id_seq'::regclass),
  tanggal date NOT NULL,
  kelas text NOT NULL,
  mapel text NOT NULL,
  jam_mulai time without time zone NOT NULL,
  jam_selesai time without time zone NOT NULL,
  alasan text NOT NULL,
  guru_pengganti text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT jam_kosong_pkey PRIMARY KEY (id),
  CONSTRAINT jam_kosong_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.kelas (
  id text NOT NULL,
  nama text NOT NULL,
  grade text,
  suffix text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT kelas_pkey PRIMARY KEY (id)
);
CREATE TABLE public.kelas_struktur (
  kelas_id text NOT NULL,
  wali_guru_id uuid,
  wali_guru_nama text,
  ketua_siswa_id text,
  ketua_siswa_nama text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT kelas_struktur_pkey PRIMARY KEY (kelas_id),
  CONSTRAINT kelas_struktur_kelas_id_fkey FOREIGN KEY (kelas_id) REFERENCES public.kelas(id),
  CONSTRAINT kelas_struktur_wali_guru_id_fkey FOREIGN KEY (wali_guru_id) REFERENCES public.profiles(id),
  CONSTRAINT fk_wali_guru FOREIGN KEY (wali_guru_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.mata_pelajaran (
  id text NOT NULL,
  nama text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT mata_pelajaran_pkey PRIMARY KEY (id)
);
CREATE TABLE public.organisasi (
  id text NOT NULL,
  nama text NOT NULL,
  visi text,
  misi text,
  pembina_guru_id uuid,
  pembina_guru_nama text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT organisasi_pkey PRIMARY KEY (id),
  CONSTRAINT organisasi_pembina_guru_id_fkey FOREIGN KEY (pembina_guru_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.organisasi_anggota (
  id integer NOT NULL DEFAULT nextval('organisasi_anggota_id_seq'::regclass),
  organisasi_id text,
  siswa_id text NOT NULL,
  nama text NOT NULL,
  kelas text,
  created_at timestamp with time zone DEFAULT now(),
  jabatan text DEFAULT 'Anggota'::text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT organisasi_anggota_pkey PRIMARY KEY (id),
  CONSTRAINT organisasi_anggota_organisasi_id_fkey FOREIGN KEY (organisasi_id) REFERENCES public.organisasi(id)
);
CREATE TABLE public.osis_anggota (
  id integer NOT NULL DEFAULT nextval('osis_anggota_id_seq'::regclass),
  siswa_id uuid UNIQUE,
  nama text NOT NULL,
  kelas text,
  status text DEFAULT 'aktif'::text,
  bagian text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT osis_anggota_pkey PRIMARY KEY (id),
  CONSTRAINT osis_anggota_siswa_id_fkey FOREIGN KEY (siswa_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.pengumuman (
  id text NOT NULL,
  judul text NOT NULL,
  keterangan text,
  target text DEFAULT 'semua'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT pengumuman_pkey PRIMARY KEY (id)
);
CREATE TABLE public.printed_cards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  printed_at timestamp with time zone DEFAULT now(),
  printed_by text NOT NULL,
  class_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT printed_cards_pkey PRIMARY KEY (id),
  CONSTRAINT printed_cards_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL,
  nama text,
  role text CHECK (role = ANY (ARRAY['siswa'::text, 'guru'::text, 'admin'::text])),
  kelas text,
  jk text,
  usia integer,
  telp text,
  photo_url text,
  created_at timestamp with time zone DEFAULT now(),
  nik text,
  agama text,
  jabatan text,
  alamat text,
  status text DEFAULT 'active'::text,
  alasan_nonaktif text,
  disabled_at timestamp with time zone,
  tanggal_lahir date,
  updated_at timestamp with time zone DEFAULT now(),
  rfid_uid text UNIQUE,
  kelas_change_used boolean NOT NULL DEFAULT false,
  no_hp_siswa text CHECK (no_hp_siswa IS NULL OR length(no_hp_siswa) <= 14),
  no_hp_wali text CHECK (no_hp_wali IS NULL OR length(no_hp_wali) <= 14),
  deleted_at timestamp with time zone,
  photo_path text,
  photo_updated_at timestamp with time zone,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.registration_otps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role text NOT NULL CHECK (role = ANY (ARRAY['siswa'::text, 'guru'::text, 'admin'::text])),
  otp_code text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  CONSTRAINT registration_otps_pkey PRIMARY KEY (id)
);
CREATE TABLE public.rfid_scans (
  id bigint NOT NULL DEFAULT nextval('rfid_scans_id_seq'::regclass),
  card_uid text NOT NULL,
  device_id text,
  status text NOT NULL DEFAULT 'raw'::text CHECK (status = ANY (ARRAY['raw'::text, 'processed'::text, 'error'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rfid_scans_pkey PRIMARY KEY (id)
);
CREATE TABLE public.settings (
  id bigint NOT NULL DEFAULT nextval('settings_id_seq'::regclass),
  nama_sekolah text,
  logo_url text,
  created_at timestamp with time zone DEFAULT now(),
  logourl text,
  registrasisiswaaktif boolean DEFAULT true,
  registrasiguruaktif boolean DEFAULT true,
  registrasiadminaktif boolean DEFAULT false,
  tahun_ajaran text,
  semester_aktif text,
  email text,
  telepon text,
  alamat text,
  registrasi_siswa_aktif boolean DEFAULT true,
  registrasi_guru_aktif boolean DEFAULT true,
  registrasi_admin_aktif boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT now(),
  scan_manual_enabled boolean NOT NULL DEFAULT false,
  manual_jam_masuk_mulai time without time zone,
  manual_jam_masuk_selesai time without time zone,
  manual_jam_pulang_mulai time without time zone,
  manual_jam_pulang_selesai time without time zone,
  visi text,
  misi text,
  link_instagram text,
  link_facebook text,
  link_youtube text,
  link_tiktok text,
  auto_alpha_enabled boolean DEFAULT true,
  logo_path text,
  logo_updated_at timestamp with time zone,
  CONSTRAINT settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.struktur_sekolah (
  id text NOT NULL,
  jabatan text NOT NULL,
  guru_id uuid,
  guru_nama text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT struktur_sekolah_pkey PRIMARY KEY (id),
  CONSTRAINT struktur_sekolah_guru_id_fkey FOREIGN KEY (guru_id) REFERENCES public.profiles(id),
  CONSTRAINT fk_struktur_guru FOREIGN KEY (guru_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.templat_sertifikat_publik (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nama text NOT NULL,
  deskripsi text,
  background_url text NOT NULL,
  text_color text DEFAULT '#000000'::text,
  font_family text DEFAULT 'Helvetica'::text,
  font_size integer DEFAULT 24,
  nama_x integer DEFAULT 420,
  nama_y integer DEFAULT 260,
  event_x integer DEFAULT 420,
  event_y integer DEFAULT 310,
  tanggal_x integer DEFAULT 420,
  tanggal_y integer DEFAULT 380,
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  fields jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT templat_sertifikat_publik_pkey PRIMARY KEY (id),
  CONSTRAINT templat_sertifikat_publik_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
CREATE TABLE public.tugas (
  id bigint NOT NULL DEFAULT nextval('tugas_id_seq'::regclass),
  kelas text NOT NULL,
  judul text NOT NULL,
  mapel text NOT NULL,
  deadline timestamp with time zone,
  keterangan text,
  file_url text,
  link text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tugas_pkey PRIMARY KEY (id),
  CONSTRAINT tugas_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.tugas_jawaban (
  id bigint NOT NULL DEFAULT nextval('tugas_jawaban_id_seq'::regclass),
  tugas_id bigint,
  user_id uuid,
  file_url text,
  link_url text,
  file_name text,
  waktu_submit timestamp with time zone DEFAULT now(),
  status text,
  nilai integer CHECK (nilai >= 0 AND nilai <= 100),
  CONSTRAINT tugas_jawaban_pkey PRIMARY KEY (id),
  CONSTRAINT tugas_jawaban_tugas_id_fkey FOREIGN KEY (tugas_id) REFERENCES public.tugas(id),
  CONSTRAINT tugas_jawaban_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
