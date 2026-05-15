<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
CREATE OR REPLACE FUNCTION public.absensi_rfid_auto(
  p_card_uid text,
  p_device_id text DEFAULT null,
  p_tenant_id uuid DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz;
  v_now_jakarta timestamp;
  v_today date;
  v_time time;
  v_dow int;
  v_hari text;
  v_card_uid text;

  v_profile profiles%rowtype;
  v_jadwal jadwal%rowtype;
  v_absensi absensi%rowtype;
  v_settings settings%rowtype;
  v_rfid_settings absensi_rfid_settings%rowtype;

  v_manual_enabled boolean;
  v_mode text;
  v_sesi text;
  v_jam_mulai time;
  v_jam_selesai time;
  v_scan_id bigint;
BEGIN
  v_card_uid := upper(regexp_replace(coalesce(p_card_uid, ''), '\s+', '', 'g'));
  IF v_card_uid = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_card_uid',
      'message', 'card_uid wajib diisi'
    );
  END IF;

  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'tenant_required',
      'message', 'tenant_id wajib diisi'
    );
  END IF;

  v_now := now();
  v_now_jakarta := (v_now AT TIME ZONE 'Asia/Jakarta');
  v_today := v_now_jakarta::date;
  v_time := v_now_jakarta::time;
  v_dow := extract(dow from v_now_jakarta);

  v_hari := CASE v_dow
    WHEN 0 THEN 'Minggu'
    WHEN 1 THEN 'Senin'
    WHEN 2 THEN 'Selasa'
    WHEN 3 THEN 'Rabu'
    WHEN 4 THEN 'Kamis'
    WHEN 5 THEN 'Jumat'
    WHEN 6 THEN 'Sabtu'
  END;

  INSERT INTO rfid_scans(card_uid, device_id, status, tenant_id)
  VALUES (v_card_uid, p_device_id, 'error', p_tenant_id)
  RETURNING id INTO v_scan_id;

  SELECT *
    INTO v_rfid_settings
  FROM absensi_rfid_settings
  WHERE tenant_id = p_tenant_id
  ORDER BY created_at, id
  LIMIT 1;

  IF FOUND AND NOT coalesce(v_rfid_settings.rfid_aktif, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'rfid_disabled',
      'message', 'Fitur RFID sedang non-aktif',
      'card_uid', v_card_uid,
      'device_id', p_device_id,
      'waktu', v_now
    );
  END IF;

  IF FOUND
     AND coalesce(v_rfid_settings.rfid_aktif, false)
     AND v_rfid_settings.rfid_mulai IS NOT NULL
     AND v_rfid_settings.rfid_selesai IS NOT NULL
     AND NOT (v_time BETWEEN v_rfid_settings.rfid_mulai AND v_rfid_settings.rfid_selesai)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'outside_rfid_window',
      'message', 'Di luar rentang jam RFID',
      'card_uid', v_card_uid,
      'device_id', p_device_id,
      'waktu', v_now
    );
  END IF;

  SELECT *
    INTO v_settings
  FROM settings
  WHERE tenant_id = p_tenant_id
  ORDER BY id
  LIMIT 1;

  v_manual_enabled := coalesce(v_settings.scan_always_active, false)
    OR coalesce(v_settings.scan_manual_enabled, false);

  SELECT *
    INTO v_profile
  FROM profiles
  WHERE tenant_id = p_tenant_id
    AND upper(regexp_replace(coalesce(rfid_uid, ''), '\s+', '', 'g')) = v_card_uid
    AND deleted_at IS NULL
    AND coalesce(lower(status), 'active') NOT IN ('nonaktif', 'inactive', 'disabled')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'rfid_not_registered',
      'message', 'Kartu belum terdaftar di tenant ini',
      'card_uid', v_card_uid,
      'device_id', p_device_id,
      'waktu', v_now
    );
  END IF;

  IF v_manual_enabled THEN
    v_mode := 'manual';

    IF v_settings.manual_jam_masuk_mulai IS NOT NULL
       AND v_settings.manual_jam_masuk_selesai IS NOT NULL
       AND v_time BETWEEN v_settings.manual_jam_masuk_mulai AND v_settings.manual_jam_masuk_selesai
    THEN
      v_sesi := 'masuk';
      v_jam_mulai := v_settings.manual_jam_masuk_mulai;
      v_jam_selesai := v_settings.manual_jam_masuk_selesai;
    ELSIF v_settings.manual_jam_pulang_mulai IS NOT NULL
       AND v_settings.manual_jam_pulang_selesai IS NOT NULL
       AND v_time BETWEEN v_settings.manual_jam_pulang_mulai AND v_settings.manual_jam_pulang_selesai
    THEN
      v_sesi := 'pulang';
      v_jam_mulai := v_settings.manual_jam_pulang_mulai;
      v_jam_selesai := v_settings.manual_jam_pulang_selesai;
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'no_manual_window',
        'message', 'Di luar jam manual masuk/pulang',
        'nama', v_profile.nama,
        'kelas', v_profile.kelas,
        'card_uid', v_card_uid,
        'device_id', p_device_id,
        'waktu', v_now
      );
    END IF;

    SELECT *
      INTO v_absensi
    FROM absensi
    WHERE tenant_id = p_tenant_id
      AND uid = v_profile.id
      AND tanggal = v_today
      AND mapel = v_sesi
      AND kelas = v_profile.kelas
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'already_scanned',
        'message', 'Siswa sudah scan pada sesi ini',
        'nama', v_profile.nama,
        'kelas', v_profile.kelas,
        'mapel', v_sesi,
        'card_uid', v_card_uid,
        'device_id', p_device_id,
        'waktu', v_now
      );
    END IF;

    INSERT INTO absensi(
      tenant_id, kelas, tanggal, uid, mapel, status,
      nama, waktu, komentar, oleh
    )
    VALUES (
      p_tenant_id,
      v_profile.kelas,
      v_today,
      v_profile.id,
      v_sesi,
      'Hadir',
      v_profile.nama,
      v_now,
      concat('RFID MANUAL dari device ', coalesce(p_device_id, '-')),
      'rfid_manual'
    )
    RETURNING * INTO v_absensi;

    UPDATE rfid_scans
    SET status = 'processed'
    WHERE id = v_scan_id;

    RETURN jsonb_build_object(
      'success', true,
      'mode', v_mode,
      'nama', v_profile.nama,
      'kelas', v_profile.kelas,
      'mapel', v_sesi,
      'status', v_absensi.status,
      'jam_mulai', v_jam_mulai,
      'jam_selesai', v_jam_selesai,
      'waktu_absen', v_absensi.waktu,
      'absen_id', v_absensi.id,
      'no_hp_wali', coalesce(v_profile.no_hp_wali, ''),
      'card_uid', v_card_uid,
      'device_id', p_device_id
    );
  END IF;

  v_mode := 'otomatis';

  SELECT *
    INTO v_jadwal
  FROM jadwal
  WHERE tenant_id = p_tenant_id
    AND lower(kelas_id) = lower(coalesce(v_profile.kelas, ''))
    AND lower(hari) = lower(v_hari)
    AND jam_mulai <= v_time
    AND jam_selesai >= v_time
  ORDER BY jam_mulai
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_schedule_now',
      'message', 'Tidak ada jadwal aktif pada jam ini',
      'nama', v_profile.nama,
      'kelas', v_profile.kelas,
      'card_uid', v_card_uid,
      'device_id', p_device_id,
      'waktu', v_now
    );
  END IF;

  SELECT *
    INTO v_absensi
  FROM absensi
  WHERE tenant_id = p_tenant_id
    AND uid = v_profile.id
    AND tanggal = v_today
    AND mapel = v_jadwal.mapel
    AND kelas = v_profile.kelas
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'already_scanned',
      'message', 'Siswa sudah scan untuk mapel ini',
      'nama', v_profile.nama,
      'kelas', v_profile.kelas,
      'mapel', v_jadwal.mapel,
      'card_uid', v_card_uid,
      'device_id', p_device_id,
      'waktu', v_now
    );
  END IF;

  INSERT INTO absensi(
    tenant_id, kelas, tanggal, uid, mapel, status,
    nama, waktu, komentar, oleh
  )
  VALUES (
    p_tenant_id,
    v_profile.kelas,
    v_today,
    v_profile.id,
    v_jadwal.mapel,
    'Hadir',
    v_profile.nama,
    v_now,
    concat('RFID otomatis dari device ', coalesce(p_device_id, '-')),
    'rfid_auto'
  )
  RETURNING * INTO v_absensi;

  UPDATE rfid_scans
  SET status = 'processed'
  WHERE id = v_scan_id;

  RETURN jsonb_build_object(
    'success', true,
    'mode', v_mode,
    'nama', v_profile.nama,
    'kelas', v_profile.kelas,
    'mapel', v_jadwal.mapel,
    'status', v_absensi.status,
    'jam_mulai', v_jadwal.jam_mulai,
    'jam_selesai', v_jadwal.jam_selesai,
    'waktu_absen', v_absensi.waktu,
    'absen_id', v_absensi.id,
    'no_hp_wali', coalesce(v_profile.no_hp_wali, ''),
    'card_uid', v_card_uid,
    'device_id', p_device_id
  );
END;
$$;
SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared('DROP FUNCTION IF EXISTS public.absensi_rfid_auto(text, text, uuid);');
    }
};
