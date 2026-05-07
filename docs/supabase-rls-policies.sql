-- Supabase RLS / Storage Policies (RESET)
-- Jalankan di SQL Editor Supabase sebagai postgres/supabase_admin.
-- Error: "must be owner of table objects" = query dijalankan bukan owner.
-- Pastikan role user disimpan di auth.user_metadata.role atau auth.app_metadata.role
-- (nilai: admin | guru | siswa).

-- ===============================
-- DROP ALL POLICIES (public + storage)
-- ===============================
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname in ('public', 'storage')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ===============================
-- HELPER FUNCTIONS (NO RLS RECURSION)
-- ===============================
create or replace function public.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'role', ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    nullif(auth.jwt() ->> 'role', ''),
    ''
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.jwt_role() = 'admin';
$$;

create or replace function public.is_guru()
returns boolean
language sql
stable
as $$
  select public.jwt_role() in ('guru', 'teacher');
$$;

create or replace function public.is_siswa()
returns boolean
language sql
stable
as $$
  select public.jwt_role() = 'siswa';
$$;

-- Ambil kelas user tanpa memicu RLS pada profiles
create or replace function public.current_kelas()
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.kelas from public.profiles p where p.id = auth.uid();
$$;

-- ===============================
-- ENABLE RLS
-- ===============================
alter table storage.objects enable row level security;

alter table public.profiles enable row level security;
alter table public.settings enable row level security;

alter table public.kelas enable row level security;
alter table public.kelas_struktur enable row level security;
alter table public.jadwal enable row level security;
alter table public.mata_pelajaran enable row level security;
alter table public.struktur_sekolah enable row level security;

alter table public.pengumuman enable row level security;

alter table public.ekskul enable row level security;
alter table public.ekskul_anggota enable row level security;

alter table public.organisasi enable row level security;
alter table public.organisasi_anggota enable row level security;
alter table public.osis_anggota enable row level security;

alter table public.absensi enable row level security;
alter table public.absensi_ajuan enable row level security;
alter table public.absensi_settings enable row level security;
alter table public.absensi_rfid_settings enable row level security;
alter table public.absensi_eskul enable row level security;
alter table public.absensi_scan_temp enable row level security;

alter table public.rfid_scans enable row level security;

alter table public.jam_kosong enable row level security;

alter table public.tugas enable row level security;
alter table public.tugas_jawaban enable row level security;

alter table public.certificates enable row level security;
alter table public.templat_sertifikat_publik enable row level security;

-- ===============================
-- STORAGE POLICIES
-- ===============================

-- Admin full access to all storage objects
create policy "storage admin all"
on storage.objects
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- PROFILE PHOTOS (bucket: profile-photos)
create policy "profile photos read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    name like 'profiles/%'
    or name = 'logo_sekolah.png'
  )
);

create policy "profile photos insert own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and name like ('profiles/' || auth.uid() || '/%')
);

create policy "profile photos update own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-photos'
  and name like ('profiles/' || auth.uid() || '/%')
)
with check (
  bucket_id = 'profile-photos'
  and name like ('profiles/' || auth.uid() || '/%')
);

create policy "profile photos delete own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and name like ('profiles/' || auth.uid() || '/%')
);

-- ASSIGNMENTS (bucket: assignments)
-- Path guru:   tugas_lampiran/<guruId>/...
-- Path siswa:  <tugas_id>/<siswaId>-<timestamp>.<ext>
create policy "assignments read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'assignments'
  and (
    -- guru: lampiran tugas milik sendiri
    name like ('tugas_lampiran/' || auth.uid() || '/%')
    -- siswa: jawaban milik sendiri
    or name ~ ('^[^/]+/' || auth.uid() || '-')
    -- siswa: lihat lampiran tugas untuk kelasnya
    or exists (
      select 1
      from public.tugas t
      where t.file_url = storage.objects.name
        and t.kelas = public.current_kelas()
    )
    -- siswa: lihat file jawaban sendiri
    or exists (
      select 1
      from public.tugas_jawaban j
      where j.file_url = storage.objects.name
        and j.user_id = auth.uid()
    )
    -- guru: lihat jawaban siswa untuk tugas yang dia buat
    or exists (
      select 1
      from public.tugas_jawaban j
      join public.tugas t on t.id = j.tugas_id
      where j.file_url = storage.objects.name
        and t.created_by = auth.uid()
    )
  )
);

create policy "assignments insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'assignments'
  and (
    name like ('tugas_lampiran/' || auth.uid() || '/%')
    or name ~ ('^[^/]+/' || auth.uid() || '-')
  )
);

create policy "assignments update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'assignments'
  and (
    name like ('tugas_lampiran/' || auth.uid() || '/%')
    or name ~ ('^[^/]+/' || auth.uid() || '-')
  )
)
with check (
  bucket_id = 'assignments'
  and (
    name like ('tugas_lampiran/' || auth.uid() || '/%')
    or name ~ ('^[^/]+/' || auth.uid() || '-')
  )
);

create policy "assignments delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'assignments'
  and (
    name like ('tugas_lampiran/' || auth.uid() || '/%')
    or name ~ ('^[^/]+/' || auth.uid() || '-')
  )
);

-- CERTIFICATE FILES (bucket names may vary)
create policy "cert files read owner"
on storage.objects
for select
to authenticated
using (
  bucket_id in ('certificates', 'sertifikat-files')
  and exists (
    select 1
    from public.certificates c
    where c.file_url = storage.objects.name
      and c.user_id = auth.uid()
  )
);

-- CERTIFICATE TEMPLATES (admin only via storage admin policy)

-- ===============================
-- TABLE POLICIES
-- ===============================

-- PROFILES
create policy "profiles admin all"
on public.profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "profiles self read"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "profiles self insert"
on public.profiles
for insert
to authenticated
with check (id = auth.uid() and role = public.jwt_role());

create policy "profiles self update"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role = public.jwt_role()
  and (
    not public.is_siswa()
    or kelas = public.current_kelas()
  )
);

create policy "profiles guru read siswa kelas"
on public.profiles
for select
to authenticated
using (
  public.is_guru()
  and role = 'siswa'
  and exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = profiles.kelas
  )
);

create policy "profiles guru read guru"
on public.profiles
for select
to authenticated
using (
  public.is_guru()
  and role in ('guru', 'teacher')
);

create policy "profiles siswa read classmates"
on public.profiles
for select
to authenticated
using (
  public.is_siswa()
  and role = 'siswa'
  and kelas = public.current_kelas()
);

create policy "profiles siswa read guru"
on public.profiles
for select
to authenticated
using (
  public.is_siswa()
  and role in ('guru', 'teacher')
);

-- SETTINGS (public read)
create policy "settings read public"
on public.settings
for select
to anon, authenticated
using (true);

create policy "settings admin all"
on public.settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- KELAS
create policy "kelas read"
on public.kelas
for select
to authenticated
using (true);

create policy "kelas admin all"
on public.kelas
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- MATA_PELAJARAN
create policy "mata_pelajaran read"
on public.mata_pelajaran
for select
to authenticated
using (true);

create policy "mata_pelajaran admin all"
on public.mata_pelajaran
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- STRUKTUR_SEKOLAH
create policy "struktur_sekolah read"
on public.struktur_sekolah
for select
to authenticated
using (true);

create policy "struktur_sekolah admin all"
on public.struktur_sekolah
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- KELAS_STRUKTUR
create policy "kelas_struktur admin all"
on public.kelas_struktur
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "kelas_struktur guru read"
on public.kelas_struktur
for select
to authenticated
using (public.is_guru() and wali_guru_id = auth.uid());

create policy "kelas_struktur siswa read"
on public.kelas_struktur
for select
to authenticated
using (public.is_siswa() and kelas_id = public.current_kelas());

-- JADWAL
create policy "jadwal admin all"
on public.jadwal
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "jadwal guru read"
on public.jadwal
for select
to authenticated
using (public.is_guru() and guru_id = auth.uid());

create policy "jadwal siswa read"
on public.jadwal
for select
to authenticated
using (public.is_siswa() and kelas_id = public.current_kelas());

-- PENGUMUMAN
create policy "pengumuman admin all"
on public.pengumuman
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "pengumuman read by target"
on public.pengumuman
for select
to authenticated
using (
  public.is_admin()
  or coalesce(lower(target), '') in ('', 'semua', 'all')
  or (public.is_siswa() and coalesce(lower(target), '') in ('siswa', 'student'))
  or (public.is_guru() and coalesce(lower(target), '') in ('guru', 'teacher'))
);

-- EKSKUL
create policy "ekskul admin all"
on public.ekskul
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "ekskul read"
on public.ekskul
for select
to authenticated
using (true);

-- EKSKUL_ANGGOTA
create policy "ekskul_anggota admin all"
on public.ekskul_anggota
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "ekskul_anggota read"
on public.ekskul_anggota
for select
to authenticated
using (true);

create policy "ekskul_anggota insert own"
on public.ekskul_anggota
for insert
to authenticated
with check (user_id = auth.uid());

create policy "ekskul_anggota delete own"
on public.ekskul_anggota
for delete
to authenticated
using (user_id = auth.uid());

-- ORGANISASI
create policy "organisasi admin all"
on public.organisasi
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "organisasi read"
on public.organisasi
for select
to authenticated
using (true);

-- ORGANISASI_ANGGOTA
create policy "organisasi_anggota admin all"
on public.organisasi_anggota
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "organisasi_anggota read"
on public.organisasi_anggota
for select
to authenticated
using (true);

-- OSIS_ANGGOTA (admin only)
create policy "osis_anggota admin all"
on public.osis_anggota
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ABSENSI
create policy "absensi admin all"
on public.absensi
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "absensi guru all"
on public.absensi
for all
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = absensi.kelas
      and j.mapel = absensi.mapel
  )
)
with check (
  public.is_guru()
  and exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = absensi.kelas
      and j.mapel = absensi.mapel
  )
);

create policy "absensi siswa read kelas"
on public.absensi
for select
to authenticated
using (public.is_siswa() and kelas = public.current_kelas());

create policy "absensi siswa upsert own"
on public.absensi
for insert
to authenticated
with check (public.is_siswa() and uid = auth.uid() and kelas = public.current_kelas());

create policy "absensi siswa update own"
on public.absensi
for update
to authenticated
using (public.is_siswa() and uid = auth.uid() and kelas = public.current_kelas())
with check (public.is_siswa() and uid = auth.uid() and kelas = public.current_kelas());

-- ABSENSI_AJUAN
create policy "absensi_ajuan admin all"
on public.absensi_ajuan
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "absensi_ajuan siswa read own"
on public.absensi_ajuan
for select
to authenticated
using (public.is_siswa() and uid = auth.uid());

create policy "absensi_ajuan siswa insert own"
on public.absensi_ajuan
for insert
to authenticated
with check (public.is_siswa() and uid = auth.uid() and kelas = public.current_kelas());

create policy "absensi_ajuan guru read"
on public.absensi_ajuan
for select
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = absensi_ajuan.kelas
      and j.mapel = absensi_ajuan.mapel
  )
);

create policy "absensi_ajuan guru delete"
on public.absensi_ajuan
for delete
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = absensi_ajuan.kelas
      and j.mapel = absensi_ajuan.mapel
  )
);

-- ABSENSI_SETTINGS
create policy "absensi_settings admin all"
on public.absensi_settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "absensi_settings guru read"
on public.absensi_settings
for select
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = absensi_settings.kelas
      and j.mapel = absensi_settings.mapel
  )
);

create policy "absensi_settings guru upsert"
on public.absensi_settings
for insert
to authenticated
with check (
  public.is_guru()
  and exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = absensi_settings.kelas
      and j.mapel = absensi_settings.mapel
  )
);

create policy "absensi_settings guru update"
on public.absensi_settings
for update
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = absensi_settings.kelas
      and j.mapel = absensi_settings.mapel
  )
)
with check (
  public.is_guru()
  and exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = absensi_settings.kelas
      and j.mapel = absensi_settings.mapel
  )
);

create policy "absensi_settings siswa read"
on public.absensi_settings
for select
to authenticated
using (public.is_siswa() and kelas = public.current_kelas());

-- ABSENSI_RFID_SETTINGS
create policy "absensi_rfid_settings admin all"
on public.absensi_rfid_settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "absensi_rfid_settings read"
on public.absensi_rfid_settings
for select
to authenticated
using (true);

-- ABSENSI_ESKUL
create policy "absensi_eskul admin all"
on public.absensi_eskul
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "absensi_eskul guru all"
on public.absensi_eskul
for all
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.ekskul e
    where e.id = absensi_eskul.ekskul_id
      and e.pembina_guru_id = auth.uid()
  )
)
with check (
  public.is_guru()
  and exists (
    select 1
    from public.ekskul e
    where e.id = absensi_eskul.ekskul_id
      and e.pembina_guru_id = auth.uid()
  )
);

create policy "absensi_eskul siswa read own"
on public.absensi_eskul
for select
to authenticated
using (public.is_siswa() and user_id = auth.uid());

-- ABSENSI_SCAN_TEMP (admin only)
create policy "absensi_scan_temp admin all"
on public.absensi_scan_temp
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- RFID_SCANS
create policy "rfid_scans admin all"
on public.rfid_scans
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "rfid_scans siswa read"
on public.rfid_scans
for select
to authenticated
using (
  public.is_siswa()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.rfid_uid = rfid_scans.card_uid
  )
);

create policy "rfid_scans siswa update"
on public.rfid_scans
for update
to authenticated
using (
  public.is_siswa()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.rfid_uid = rfid_scans.card_uid
  )
)
with check (
  public.is_siswa()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.rfid_uid = rfid_scans.card_uid
  )
);

create policy "rfid_scans guru read"
on public.rfid_scans
for select
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.profiles p
    join public.jadwal j on j.kelas_id = p.kelas
    where j.guru_id = auth.uid()
      and p.rfid_uid = rfid_scans.card_uid
  )
);

create policy "rfid_scans guru update"
on public.rfid_scans
for update
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.profiles p
    join public.jadwal j on j.kelas_id = p.kelas
    where j.guru_id = auth.uid()
      and p.rfid_uid = rfid_scans.card_uid
  )
)
with check (
  public.is_guru()
  and exists (
    select 1
    from public.profiles p
    join public.jadwal j on j.kelas_id = p.kelas
    where j.guru_id = auth.uid()
      and p.rfid_uid = rfid_scans.card_uid
  )
);

-- JAM_KOSONG
create policy "jam_kosong admin all"
on public.jam_kosong
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "jam_kosong guru own"
on public.jam_kosong
for all
to authenticated
using (public.is_guru() and created_by = auth.uid())
with check (public.is_guru() and created_by = auth.uid());

create policy "jam_kosong siswa read"
on public.jam_kosong
for select
to authenticated
using (public.is_siswa() and kelas = public.current_kelas());

-- TUGAS
create policy "tugas admin all"
on public.tugas
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "tugas guru own"
on public.tugas
for all
to authenticated
using (public.is_guru() and created_by = auth.uid())
with check (public.is_guru() and created_by = auth.uid());

create policy "tugas siswa kelas"
on public.tugas
for select
to authenticated
using (public.is_siswa() and kelas = public.current_kelas());

-- TUGAS_JAWABAN
create policy "tugas_jawaban admin all"
on public.tugas_jawaban
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "tugas_jawaban siswa own"
on public.tugas_jawaban
for all
to authenticated
using (public.is_siswa() and user_id = auth.uid())
with check (public.is_siswa() and user_id = auth.uid());

create policy "tugas_jawaban guru read"
on public.tugas_jawaban
for select
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.tugas t
    where t.id = tugas_jawaban.tugas_id
      and t.created_by = auth.uid()
  )
);

create policy "tugas_jawaban guru update"
on public.tugas_jawaban
for update
to authenticated
using (
  public.is_guru()
  and exists (
    select 1
    from public.tugas t
    where t.id = tugas_jawaban.tugas_id
      and t.created_by = auth.uid()
  )
)
with check (
  public.is_guru()
  and exists (
    select 1
    from public.tugas t
    where t.id = tugas_jawaban.tugas_id
      and t.created_by = auth.uid()
  )
);

-- CERTIFICATES
create policy "certificates admin all"
on public.certificates
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "certificates read own"
on public.certificates
for select
to authenticated
using (user_id = auth.uid());

-- TEMPLATE SERTIFIKAT
create policy "templat_sertifikat_publik admin all"
on public.templat_sertifikat_publik
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
