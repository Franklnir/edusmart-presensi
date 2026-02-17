-- RLS policies for edusmart-presensi
-- NOTE: Review and adjust for your exact business rules before running.
-- Assumptions:
-- - Roles are stored in public.profiles.role (siswa/guru/admin).
-- - User kelas is stored in public.profiles.kelas.
-- - Storage object keys follow the patterns used in the frontend:
--   * profile-photos: profiles/<uid>/avatar.jpg
--   * assignments: tugas_lampiran/<uid>-<timestamp>.<ext> (guru)
--   * assignments: <tugas_id>/<uid>-<timestamp>.<ext> (siswa jawaban)
--   * certificates/sertifikat-files: file_url stores object key or URL containing object key.
-- - Logo file is stored as profile-photos/logo_sekolah.png.

begin;

-- Helper functions (SECURITY DEFINER to avoid RLS recursion)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.status = 'active'
  )
  or exists (
    select 1 from public.admin_users au where au.id = auth.uid()
  );
$$;

create or replace function public.is_guru()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'guru'
      and p.status = 'active'
  );
$$;

create or replace function public.is_siswa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'siswa'
      and p.status = 'active'
  );
$$;

create or replace function public.current_kelas()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.kelas
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.current_rfid_uid()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.rfid_uid
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.is_guru_for_kelas(target_kelas text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jadwal j
    where j.guru_id = auth.uid()
      and j.kelas_id = target_kelas
  )
  or exists (
    select 1
    from public.kelas_struktur ks
    where ks.wali_guru_id = auth.uid()
      and ks.kelas_id = target_kelas
  );
$$;

-- =============================
-- TABLE POLICIES
-- =============================

-- absensi
alter table public.absensi enable row level security;
alter table public.absensi force row level security;

drop policy if exists absensi_select on public.absensi;
create policy absensi_select
  on public.absensi
  for select
  using (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
    or uid = auth.uid()
  );

drop policy if exists absensi_insert on public.absensi;
create policy absensi_insert
  on public.absensi
  for insert
  with check (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
    or (uid = auth.uid() and kelas = public.current_kelas())
  );

drop policy if exists absensi_update on public.absensi;
create policy absensi_update
  on public.absensi
  for update
  using (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
    or uid = auth.uid()
  )
  with check (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
    or uid = auth.uid()
  );

drop policy if exists absensi_delete on public.absensi;
create policy absensi_delete
  on public.absensi
  for delete
  using (public.is_admin());

-- absensi_ajuan
alter table public.absensi_ajuan enable row level security;
alter table public.absensi_ajuan force row level security;

drop policy if exists absensi_ajuan_select on public.absensi_ajuan;
create policy absensi_ajuan_select
  on public.absensi_ajuan
  for select
  using (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
    or uid = auth.uid()
  );

drop policy if exists absensi_ajuan_insert on public.absensi_ajuan;
create policy absensi_ajuan_insert
  on public.absensi_ajuan
  for insert
  with check (
    uid = auth.uid()
    and kelas = public.current_kelas()
  );

drop policy if exists absensi_ajuan_update on public.absensi_ajuan;
create policy absensi_ajuan_update
  on public.absensi_ajuan
  for update
  using (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
  )
  with check (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
  );

drop policy if exists absensi_ajuan_delete on public.absensi_ajuan;
create policy absensi_ajuan_delete
  on public.absensi_ajuan
  for delete
  using (public.is_admin());

-- absensi_eskul
alter table public.absensi_eskul enable row level security;
alter table public.absensi_eskul force row level security;

drop policy if exists absensi_eskul_select on public.absensi_eskul;
create policy absensi_eskul_select
  on public.absensi_eskul
  for select
  using (
    public.is_admin()
    or public.is_guru()
    or user_id = auth.uid()
  );

drop policy if exists absensi_eskul_insert on public.absensi_eskul;
create policy absensi_eskul_insert
  on public.absensi_eskul
  for insert
  with check (
    public.is_admin()
    or public.is_guru()
    or user_id = auth.uid()
  );

drop policy if exists absensi_eskul_update on public.absensi_eskul;
create policy absensi_eskul_update
  on public.absensi_eskul
  for update
  using (
    public.is_admin()
    or public.is_guru()
  )
  with check (
    public.is_admin()
    or public.is_guru()
  );

drop policy if exists absensi_eskul_delete on public.absensi_eskul;
create policy absensi_eskul_delete
  on public.absensi_eskul
  for delete
  using (public.is_admin());

-- absensi_rfid_settings
alter table public.absensi_rfid_settings enable row level security;
alter table public.absensi_rfid_settings force row level security;

drop policy if exists absensi_rfid_settings_select on public.absensi_rfid_settings;
create policy absensi_rfid_settings_select
  on public.absensi_rfid_settings
  for select
  using (auth.role() = 'authenticated');

drop policy if exists absensi_rfid_settings_modify on public.absensi_rfid_settings;
create policy absensi_rfid_settings_modify
  on public.absensi_rfid_settings
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- absensi_scan_temp
alter table public.absensi_scan_temp enable row level security;
alter table public.absensi_scan_temp force row level security;

drop policy if exists absensi_scan_temp_select on public.absensi_scan_temp;
create policy absensi_scan_temp_select
  on public.absensi_scan_temp
  for select
  using (public.is_admin() or public.is_guru());

drop policy if exists absensi_scan_temp_insert on public.absensi_scan_temp;
create policy absensi_scan_temp_insert
  on public.absensi_scan_temp
  for insert
  with check (public.is_admin() or public.is_guru());

drop policy if exists absensi_scan_temp_update on public.absensi_scan_temp;
create policy absensi_scan_temp_update
  on public.absensi_scan_temp
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists absensi_scan_temp_delete on public.absensi_scan_temp;
create policy absensi_scan_temp_delete
  on public.absensi_scan_temp
  for delete
  using (public.is_admin());

-- absensi_settings
alter table public.absensi_settings enable row level security;
alter table public.absensi_settings force row level security;

drop policy if exists absensi_settings_select on public.absensi_settings;
create policy absensi_settings_select
  on public.absensi_settings
  for select
  using (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
    or (public.is_siswa() and kelas = public.current_kelas())
  );

drop policy if exists absensi_settings_insert on public.absensi_settings;
create policy absensi_settings_insert
  on public.absensi_settings
  for insert
  with check (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
  );

drop policy if exists absensi_settings_update on public.absensi_settings;
create policy absensi_settings_update
  on public.absensi_settings
  for update
  using (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
  )
  with check (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
  );

drop policy if exists absensi_settings_delete on public.absensi_settings;
create policy absensi_settings_delete
  on public.absensi_settings
  for delete
  using (public.is_admin() or public.is_guru_for_kelas(kelas));

-- admin_users
alter table public.admin_users enable row level security;
alter table public.admin_users force row level security;

drop policy if exists admin_users_admin_all on public.admin_users;
create policy admin_users_admin_all
  on public.admin_users
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- allowed_registrations
alter table public.allowed_registrations enable row level security;
alter table public.allowed_registrations force row level security;

drop policy if exists allowed_registrations_admin_all on public.allowed_registrations;
create policy allowed_registrations_admin_all
  on public.allowed_registrations
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- anggota_eksku1
alter table public.anggota_eksku1 enable row level security;
alter table public.anggota_eksku1 force row level security;

drop policy if exists anggota_eksku1_admin_all on public.anggota_eksku1;
create policy anggota_eksku1_admin_all
  on public.anggota_eksku1
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- anggota_ekskul
alter table public.anggota_ekskul enable row level security;
alter table public.anggota_ekskul force row level security;

drop policy if exists anggota_ekskul_select on public.anggota_ekskul;
create policy anggota_ekskul_select
  on public.anggota_ekskul
  for select
  using (public.is_admin() or public.is_guru() or user_id = auth.uid());

drop policy if exists anggota_ekskul_modify on public.anggota_ekskul;
create policy anggota_ekskul_modify
  on public.anggota_ekskul
  for all
  using (public.is_admin() or public.is_guru())
  with check (public.is_admin() or public.is_guru());

-- audit_log
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read
  on public.audit_log
  for select
  using (public.is_admin());

-- certificates
alter table public.certificates enable row level security;
alter table public.certificates force row level security;

drop policy if exists certificates_select on public.certificates;
create policy certificates_select
  on public.certificates
  for select
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists certificates_modify on public.certificates;
create policy certificates_modify
  on public.certificates
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ekskul
alter table public.ekskul enable row level security;
alter table public.ekskul force row level security;

drop policy if exists ekskul_select on public.ekskul;
create policy ekskul_select
  on public.ekskul
  for select
  using (auth.role() = 'authenticated');

drop policy if exists ekskul_modify on public.ekskul;
create policy ekskul_modify
  on public.ekskul
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ekskul_anggota
alter table public.ekskul_anggota enable row level security;
alter table public.ekskul_anggota force row level security;

drop policy if exists ekskul_anggota_select on public.ekskul_anggota;
create policy ekskul_anggota_select
  on public.ekskul_anggota
  for select
  using (public.is_admin() or public.is_guru() or user_id = auth.uid());

drop policy if exists ekskul_anggota_modify on public.ekskul_anggota;
create policy ekskul_anggota_modify
  on public.ekskul_anggota
  for all
  using (public.is_admin() or public.is_guru())
  with check (public.is_admin() or public.is_guru());

-- jadwal
alter table public.jadwal enable row level security;
alter table public.jadwal force row level security;

drop policy if exists jadwal_select on public.jadwal;
create policy jadwal_select
  on public.jadwal
  for select
  using (
    public.is_admin()
    or public.is_guru_for_kelas(kelas_id)
    or (public.is_siswa() and kelas_id = public.current_kelas())
  );

drop policy if exists jadwal_modify on public.jadwal;
create policy jadwal_modify
  on public.jadwal
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- jam_kosong
alter table public.jam_kosong enable row level security;
alter table public.jam_kosong force row level security;

drop policy if exists jam_kosong_select on public.jam_kosong;
create policy jam_kosong_select
  on public.jam_kosong
  for select
  using (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
    or (public.is_siswa() and kelas = public.current_kelas())
  );

drop policy if exists jam_kosong_insert on public.jam_kosong;
create policy jam_kosong_insert
  on public.jam_kosong
  for insert
  with check (
    public.is_admin()
    or (public.is_guru_for_kelas(kelas) and created_by = auth.uid())
  );

drop policy if exists jam_kosong_update on public.jam_kosong;
create policy jam_kosong_update
  on public.jam_kosong
  for update
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());

drop policy if exists jam_kosong_delete on public.jam_kosong;
create policy jam_kosong_delete
  on public.jam_kosong
  for delete
  using (public.is_admin());

-- kelas
alter table public.kelas enable row level security;
alter table public.kelas force row level security;

drop policy if exists kelas_select on public.kelas;
create policy kelas_select
  on public.kelas
  for select
  using (auth.role() = 'authenticated');

drop policy if exists kelas_modify on public.kelas;
create policy kelas_modify
  on public.kelas
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- kelas_struktur
alter table public.kelas_struktur enable row level security;
alter table public.kelas_struktur force row level security;

drop policy if exists kelas_struktur_select on public.kelas_struktur;
create policy kelas_struktur_select
  on public.kelas_struktur
  for select
  using (auth.role() = 'authenticated');

drop policy if exists kelas_struktur_modify on public.kelas_struktur;
create policy kelas_struktur_modify
  on public.kelas_struktur
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- mata_pelajaran
alter table public.mata_pelajaran enable row level security;
alter table public.mata_pelajaran force row level security;

drop policy if exists mata_pelajaran_select on public.mata_pelajaran;
create policy mata_pelajaran_select
  on public.mata_pelajaran
  for select
  using (auth.role() = 'authenticated');

drop policy if exists mata_pelajaran_modify on public.mata_pelajaran;
create policy mata_pelajaran_modify
  on public.mata_pelajaran
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- organisasi
alter table public.organisasi enable row level security;
alter table public.organisasi force row level security;

drop policy if exists organisasi_select on public.organisasi;
create policy organisasi_select
  on public.organisasi
  for select
  using (auth.role() = 'authenticated');

drop policy if exists organisasi_modify on public.organisasi;
create policy organisasi_modify
  on public.organisasi
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- organisasi_anggota
alter table public.organisasi_anggota enable row level security;
alter table public.organisasi_anggota force row level security;

drop policy if exists organisasi_anggota_select on public.organisasi_anggota;
create policy organisasi_anggota_select
  on public.organisasi_anggota
  for select
  using (public.is_admin() or public.is_guru());

drop policy if exists organisasi_anggota_modify on public.organisasi_anggota;
create policy organisasi_anggota_modify
  on public.organisasi_anggota
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- osis_anggota
alter table public.osis_anggota enable row level security;
alter table public.osis_anggota force row level security;

drop policy if exists osis_anggota_select on public.osis_anggota;
create policy osis_anggota_select
  on public.osis_anggota
  for select
  using (public.is_admin() or public.is_guru() or siswa_id = auth.uid());

drop policy if exists osis_anggota_modify on public.osis_anggota;
create policy osis_anggota_modify
  on public.osis_anggota
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- pengumuman
alter table public.pengumuman enable row level security;
alter table public.pengumuman force row level security;

drop policy if exists pengumuman_select on public.pengumuman;
create policy pengumuman_select
  on public.pengumuman
  for select
  using (auth.role() = 'authenticated');

drop policy if exists pengumuman_modify on public.pengumuman;
create policy pengumuman_modify
  on public.pengumuman
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- printed_cards
alter table public.printed_cards enable row level security;
alter table public.printed_cards force row level security;

drop policy if exists printed_cards_admin_all on public.printed_cards;
create policy printed_cards_admin_all
  on public.printed_cards
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- profiles
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select
  on public.profiles
  for select
  using (
    public.is_admin()
    or id = auth.uid()
    or (public.is_guru() and exists (
      select 1
      from public.jadwal j
      where j.guru_id = auth.uid()
        and j.kelas_id = profiles.kelas
    ))
    or (
      public.is_guru()
      and profiles.role = 'siswa'
      and exists (
        select 1
        from public.ekskul_anggota ea
        join public.ekskul e on e.id = ea.ekskul_id
        where ea.user_id = profiles.id
          and e.pembina_guru_id = auth.uid()
      )
    )
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert
  on public.profiles
  for insert
  with check (
    public.is_admin()
    or id = auth.uid()
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update
  on public.profiles
  for update
  using (
    public.is_admin()
    or id = auth.uid()
  )
  with check (
    public.is_admin()
    or id = auth.uid()
  );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete
  on public.profiles
  for delete
  using (public.is_admin());

-- registration_otps
alter table public.registration_otps enable row level security;
alter table public.registration_otps force row level security;

drop policy if exists registration_otps_admin_all on public.registration_otps;
create policy registration_otps_admin_all
  on public.registration_otps
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- rfid_scans
alter table public.rfid_scans enable row level security;
alter table public.rfid_scans force row level security;

drop policy if exists rfid_scans_select on public.rfid_scans;
create policy rfid_scans_select
  on public.rfid_scans
  for select
  using (
    public.is_admin()
    or public.is_guru()
    or card_uid = public.current_rfid_uid()
  );

drop policy if exists rfid_scans_insert on public.rfid_scans;
create policy rfid_scans_insert
  on public.rfid_scans
  for insert
  with check (public.is_admin() or public.is_guru());

drop policy if exists rfid_scans_update on public.rfid_scans;
create policy rfid_scans_update
  on public.rfid_scans
  for update
  using (
    public.is_admin()
    or public.is_guru()
    or card_uid = public.current_rfid_uid()
  )
  with check (
    public.is_admin()
    or public.is_guru()
    or card_uid = public.current_rfid_uid()
  );

drop policy if exists rfid_scans_delete on public.rfid_scans;
create policy rfid_scans_delete
  on public.rfid_scans
  for delete
  using (public.is_admin());

-- settings
alter table public.settings enable row level security;
alter table public.settings force row level security;

drop policy if exists settings_select on public.settings;
create policy settings_select
  on public.settings
  for select
  using (true);

drop policy if exists settings_modify on public.settings;
create policy settings_modify
  on public.settings
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- struktur_sekolah
alter table public.struktur_sekolah enable row level security;
alter table public.struktur_sekolah force row level security;

drop policy if exists struktur_sekolah_select on public.struktur_sekolah;
create policy struktur_sekolah_select
  on public.struktur_sekolah
  for select
  using (auth.role() = 'authenticated');

drop policy if exists struktur_sekolah_modify on public.struktur_sekolah;
create policy struktur_sekolah_modify
  on public.struktur_sekolah
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- templat_sertifikat_publik
alter table public.templat_sertifikat_publik enable row level security;
alter table public.templat_sertifikat_publik force row level security;

drop policy if exists templat_sertifikat_select on public.templat_sertifikat_publik;
create policy templat_sertifikat_select
  on public.templat_sertifikat_publik
  for select
  using (auth.role() = 'authenticated');

drop policy if exists templat_sertifikat_modify on public.templat_sertifikat_publik;
create policy templat_sertifikat_modify
  on public.templat_sertifikat_publik
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- tugas
alter table public.tugas enable row level security;
alter table public.tugas force row level security;

drop policy if exists tugas_select on public.tugas;
create policy tugas_select
  on public.tugas
  for select
  using (
    public.is_admin()
    or public.is_guru_for_kelas(kelas)
    or (public.is_siswa() and kelas = public.current_kelas())
  );

drop policy if exists tugas_insert on public.tugas;
create policy tugas_insert
  on public.tugas
  for insert
  with check (
    public.is_admin()
    or (public.is_guru_for_kelas(kelas) and created_by = auth.uid())
  );

drop policy if exists tugas_update on public.tugas;
create policy tugas_update
  on public.tugas
  for update
  using (
    public.is_admin()
    or created_by = auth.uid()
  )
  with check (
    public.is_admin()
    or created_by = auth.uid()
  );

drop policy if exists tugas_delete on public.tugas;
create policy tugas_delete
  on public.tugas
  for delete
  using (public.is_admin() or created_by = auth.uid());

-- tugas_jawaban
alter table public.tugas_jawaban enable row level security;
alter table public.tugas_jawaban force row level security;

drop policy if exists tugas_jawaban_select on public.tugas_jawaban;
create policy tugas_jawaban_select
  on public.tugas_jawaban
  for select
  using (
    public.is_admin()
    or user_id = auth.uid()
    or exists (
      select 1
      from public.tugas t
      where t.id = tugas_jawaban.tugas_id
        and public.is_guru_for_kelas(t.kelas)
    )
  );

drop policy if exists tugas_jawaban_insert on public.tugas_jawaban;
create policy tugas_jawaban_insert
  on public.tugas_jawaban
  for insert
  with check (user_id = auth.uid());

drop policy if exists tugas_jawaban_update on public.tugas_jawaban;
create policy tugas_jawaban_update
  on public.tugas_jawaban
  for update
  using (
    public.is_admin()
    or user_id = auth.uid()
    or exists (
      select 1
      from public.tugas t
      where t.id = tugas_jawaban.tugas_id
        and public.is_guru_for_kelas(t.kelas)
    )
  )
  with check (
    public.is_admin()
    or user_id = auth.uid()
    or exists (
      select 1
      from public.tugas t
      where t.id = tugas_jawaban.tugas_id
        and public.is_guru_for_kelas(t.kelas)
    )
  );

drop policy if exists tugas_jawaban_delete on public.tugas_jawaban;
create policy tugas_jawaban_delete
  on public.tugas_jawaban
  for delete
  using (public.is_admin() or user_id = auth.uid());

-- =============================
-- STORAGE POLICIES
-- =============================
-- NOTE: Enabling RLS on storage.objects requires table ownership.
-- If you see "must be owner of table objects", enable RLS via Supabase
-- Dashboard (Storage > Policies) or run the ALTER TABLE as the owner,
-- then run the policy statements below.

-- profile-photos bucket

drop policy if exists storage_profile_photos_select on storage.objects;
create policy storage_profile_photos_select
  on storage.objects
  for select
  using (
    bucket_id = 'profile-photos'
    and (
      public.is_admin()
      or name = 'logo_sekolah.png'
      or (
        split_part(name, '/', 1) = 'profiles'
        and split_part(name, '/', 2) = auth.uid()::text
      )
    )
  );

drop policy if exists storage_profile_photos_insert on storage.objects;
create policy storage_profile_photos_insert
  on storage.objects
  for insert
  with check (
    bucket_id = 'profile-photos'
    and (
      public.is_admin()
      or (
        split_part(name, '/', 1) = 'profiles'
        and split_part(name, '/', 2) = auth.uid()::text
      )
    )
  );

drop policy if exists storage_profile_photos_update on storage.objects;
create policy storage_profile_photos_update
  on storage.objects
  for update
  using (
    bucket_id = 'profile-photos'
    and (
      public.is_admin()
      or (
        split_part(name, '/', 1) = 'profiles'
        and split_part(name, '/', 2) = auth.uid()::text
      )
    )
  )
  with check (
    bucket_id = 'profile-photos'
    and (
      public.is_admin()
      or (
        split_part(name, '/', 1) = 'profiles'
        and split_part(name, '/', 2) = auth.uid()::text
      )
    )
  );

drop policy if exists storage_profile_photos_delete on storage.objects;
create policy storage_profile_photos_delete
  on storage.objects
  for delete
  using (
    bucket_id = 'profile-photos'
    and (
      public.is_admin()
      or (
        split_part(name, '/', 1) = 'profiles'
        and split_part(name, '/', 2) = auth.uid()::text
      )
    )
  );

-- assignments bucket

drop policy if exists storage_assignments_select on storage.objects;
create policy storage_assignments_select
  on storage.objects
  for select
  using (
    bucket_id = 'assignments'
    and (
      public.is_admin()
      or (
        public.is_guru()
        and (
          name like 'tugas_lampiran/' || auth.uid()::text || '-%'
          or exists (
            select 1
            from public.tugas t
            where public.is_guru_for_kelas(t.kelas)
              and (t.file_url = name or t.file_url like '%' || name)
          )
          or exists (
            select 1
            from public.tugas_jawaban tj
            join public.tugas t on t.id = tj.tugas_id
            where public.is_guru_for_kelas(t.kelas)
              and (tj.file_url = name or tj.file_url like '%' || name)
          )
        )
      )
      or (
        public.is_siswa()
        and (
          (split_part(name, '/', 2) like auth.uid()::text || '-%'
            and exists (
              select 1
              from public.tugas t
              where t.id::text = split_part(name, '/', 1)
                and t.kelas = public.current_kelas()
            )
          )
          or exists (
            select 1
            from public.tugas t
            where t.kelas = public.current_kelas()
              and (t.file_url = name or t.file_url like '%' || name)
          )
        )
      )
    )
  );

drop policy if exists storage_assignments_insert on storage.objects;
create policy storage_assignments_insert
  on storage.objects
  for insert
  with check (
    bucket_id = 'assignments'
    and (
      public.is_admin()
      or (
        public.is_guru()
        and name like 'tugas_lampiran/' || auth.uid()::text || '-%'
      )
      or (
        public.is_siswa()
        and split_part(name, '/', 2) like auth.uid()::text || '-%'
        and exists (
          select 1
          from public.tugas t
          where t.id::text = split_part(name, '/', 1)
            and t.kelas = public.current_kelas()
        )
      )
    )
  );

drop policy if exists storage_assignments_update on storage.objects;
create policy storage_assignments_update
  on storage.objects
  for update
  using (
    bucket_id = 'assignments'
    and (
      public.is_admin()
      or (
        public.is_guru()
        and name like 'tugas_lampiran/' || auth.uid()::text || '-%'
      )
      or (
        public.is_siswa()
        and split_part(name, '/', 2) like auth.uid()::text || '-%'
      )
    )
  )
  with check (
    bucket_id = 'assignments'
    and (
      public.is_admin()
      or (
        public.is_guru()
        and name like 'tugas_lampiran/' || auth.uid()::text || '-%'
      )
      or (
        public.is_siswa()
        and split_part(name, '/', 2) like auth.uid()::text || '-%'
      )
    )
  );

drop policy if exists storage_assignments_delete on storage.objects;
create policy storage_assignments_delete
  on storage.objects
  for delete
  using (
    bucket_id = 'assignments'
    and (
      public.is_admin()
      or (
        public.is_guru()
        and name like 'tugas_lampiran/' || auth.uid()::text || '-%'
      )
      or (
        public.is_siswa()
        and split_part(name, '/', 2) like auth.uid()::text || '-%'
      )
    )
  );

-- certificates / sertifikat-files bucket (download by owner or admin)

drop policy if exists storage_certificates_select on storage.objects;
create policy storage_certificates_select
  on storage.objects
  for select
  using (
    bucket_id in ('certificates', 'sertifikat-files')
    and (
      public.is_admin()
      or exists (
        select 1
        from public.certificates c
        where c.user_id = auth.uid()
          and (c.file_url = name or c.file_url like '%' || name)
      )
    )
  );

drop policy if exists storage_certificates_modify on storage.objects;
create policy storage_certificates_modify
  on storage.objects
  for all
  using (
    bucket_id in ('certificates', 'sertifikat-files')
    and public.is_admin()
  )
  with check (
    bucket_id in ('certificates', 'sertifikat-files')
    and public.is_admin()
  );

-- certificate templates (admin only)

drop policy if exists storage_certificate_templates_admin on storage.objects;
create policy storage_certificate_templates_admin
  on storage.objects
  for all
  using (
    bucket_id in ('certificate-templates', 'sertifikat-templates')
    and public.is_admin()
  )
  with check (
    bucket_id in ('certificate-templates', 'sertifikat-templates')
    and public.is_admin()
  );

-- settings bucket (admin only, if used)

drop policy if exists storage_settings_admin on storage.objects;
create policy storage_settings_admin
  on storage.objects
  for all
  using (
    bucket_id = 'settings'
    and public.is_admin()
  )
  with check (
    bucket_id = 'settings'
    and public.is_admin()
  );

commit;
