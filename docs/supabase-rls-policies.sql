-- Supabase RLS / Storage Policies
-- Jalankan di SQL Editor Supabase. Sesuaikan bucket_id jika berbeda.
-- Tujuan: hilangkan error "infinite recursion detected in policy for relation objects"
-- dan pastikan tugas/preview/penilaian berjalan aman.

-- ===============================
-- STORAGE: bucket profile-photos
-- ===============================
alter table storage.objects enable row level security;

drop policy if exists "profile read" on storage.objects;
drop policy if exists "profile insert own" on storage.objects;
drop policy if exists "profile update own" on storage.objects;
drop policy if exists "profile delete own" on storage.objects;

create policy "profile read"
on storage.objects
for select
to authenticated
using (bucket_id = 'profile-photos');

create policy "profile insert own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and name like ('profiles/' || auth.uid() || '/%')
);

create policy "profile update own"
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

create policy "profile delete own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and name like ('profiles/' || auth.uid() || '/%')
);

-- ===============================
-- STORAGE: bucket assignments (tugas)
-- Path guru:   tugas_lampiran/<guruId>/...
-- Path siswa:  <tugas_id>/<siswaId>-<timestamp>.<ext>
-- ===============================
drop policy if exists "assignments read" on storage.objects;
drop policy if exists "assignments insert" on storage.objects;
drop policy if exists "assignments update" on storage.objects;
drop policy if exists "assignments delete" on storage.objects;

create policy "assignments read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'assignments'
  and (
    name like ('tugas_lampiran/' || auth.uid() || '/%')
    or name ~ ('^[^/]+/' || auth.uid() || '-')
    or exists (
      select 1
      from tugas t
      join profiles p on p.id = auth.uid()
      where t.file_url = storage.objects.name
        and t.kelas = p.kelas
    )
    or exists (
      select 1
      from tugas_jawaban j
      where j.file_url = storage.objects.name
        and j.user_id = auth.uid()
    )
    or exists (
      select 1
      from tugas_jawaban j
      join tugas t on t.id = j.tugas_id
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

-- ===============================
-- STORAGE: certificates buckets (admin only)
-- ===============================
drop policy if exists "cert read admin" on storage.objects;
drop policy if exists "cert insert admin" on storage.objects;
drop policy if exists "cert delete admin" on storage.objects;
drop policy if exists "cert template read admin" on storage.objects;
drop policy if exists "cert template insert admin" on storage.objects;
drop policy if exists "cert template delete admin" on storage.objects;

create policy "cert read admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'certificates'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

create policy "cert insert admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'certificates'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

create policy "cert delete admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'certificates'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

create policy "cert template read admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'certificate-templates'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

create policy "cert template insert admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'certificate-templates'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

create policy "cert template delete admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'certificate-templates'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- ===============================
-- TABLE RLS: tugas
-- ===============================
alter table public.tugas enable row level security;

drop policy if exists "tugas admin all" on public.tugas;
drop policy if exists "tugas guru own" on public.tugas;
drop policy if exists "tugas siswa kelas" on public.tugas;

create policy "tugas admin all"
on public.tugas
for all
using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "tugas guru own"
on public.tugas
for all
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "tugas siswa kelas"
on public.tugas
for select
using (
  kelas = (select p.kelas from profiles p where p.id = auth.uid())
);

-- ===============================
-- TABLE RLS: tugas_jawaban
-- ===============================
alter table public.tugas_jawaban enable row level security;

drop policy if exists "jawaban admin all" on public.tugas_jawaban;
drop policy if exists "jawaban siswa own" on public.tugas_jawaban;
drop policy if exists "jawaban guru for tugas" on public.tugas_jawaban;

create policy "jawaban admin all"
on public.tugas_jawaban
for all
using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "jawaban siswa own"
on public.tugas_jawaban
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "jawaban guru for tugas"
on public.tugas_jawaban
for select
using (
  exists (
    select 1
    from tugas t
    where t.id = tugas_jawaban.tugas_id
      and t.created_by = auth.uid()
  )
);

create policy "jawaban guru nilai"
on public.tugas_jawaban
for update
using (
  exists (
    select 1
    from tugas t
    where t.id = tugas_jawaban.tugas_id
      and t.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from tugas t
    where t.id = tugas_jawaban.tugas_id
      and t.created_by = auth.uid()
  )
);
