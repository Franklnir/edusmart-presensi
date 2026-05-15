<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private function isPostgres(): bool
    {
        return DB::getDriverName() === 'pgsql';
    }

    private function uuidPrimary(Blueprint $table, string $name = 'id'): void
    {
        $column = $table->uuid($name)->primary();
        if ($this->isPostgres()) {
            $column->default(DB::raw('gen_random_uuid()'));
        }
    }

    private function jsonbDefault()
    {
        return $this->isPostgres() ? DB::raw("'{}'::jsonb") : DB::raw("'{}'");
    }

    public function up(): void
    {
        // Required for gen_random_uuid()
        if ($this->isPostgres()) {
            DB::statement('create extension if not exists "pgcrypto"');
        }

        Schema::create('_policy_backup', function (Blueprint $table) {
            $table->timestampTz('saved_at')->useCurrent();
            $table->text('schemaname')->nullable();
            $table->text('tablename')->nullable();
            $table->text('policyname')->nullable();
            $table->text('roles')->nullable();
            $table->text('cmd')->nullable();
            $table->text('qual')->nullable();
            $table->text('with_check')->nullable();
        });

        Schema::create('admin_users', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->timestampTz('created_at')->useCurrent();
            $table->foreign('id')->references('id')->on('users')->cascadeOnDelete();
        });

        Schema::create('allowed_registrations', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->text('email');
            $table->enum('role', ['siswa', 'guru', 'admin']);
            $table->text('full_name')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestampTz('created_at')->useCurrent();
        });

        Schema::create('anggota_eksku1', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->timestampTz('created_at')->useCurrent();
        });

        Schema::create('audit_log', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->text('table_name');
            $table->text('record_id')->nullable();
            $table->enum('action', ['INSERT', 'UPDATE', 'DELETE']);
            $table->jsonb('old_data')->nullable();
            $table->jsonb('new_data')->nullable();
            $table->uuid('user_id')->nullable();
            $table->text('user_role')->nullable();
            $table->timestampTz('timestamp')->useCurrent();
        });

        Schema::create('kelas', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('nama');
            $table->text('grade')->nullable();
            $table->text('suffix')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();
        });

        Schema::create('mata_pelajaran', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('nama');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();
        });

        Schema::create('profiles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->text('email');
            $table->text('nama')->nullable();
            $table->enum('role', ['siswa', 'guru', 'admin'])->nullable();
            $table->text('kelas')->nullable();
            $table->text('jk')->nullable();
            $table->integer('usia')->nullable();
            $table->text('telp')->nullable();
            $table->text('photo_url')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->text('nis')->nullable();
            $table->text('agama')->nullable();
            $table->text('jabatan')->nullable();
            $table->text('alamat')->nullable();
            $table->text('status')->default('active');
            $table->text('alasan_nonaktif')->nullable();
            $table->timestampTz('disabled_at')->nullable();
            $table->date('tanggal_lahir')->nullable();
            $table->timestampTz('updated_at')->useCurrent();
            $table->text('rfid_uid')->unique()->nullable();
            $table->boolean('kelas_change_used')->default(false);
            $table->text('no_hp_siswa')->nullable();
            $table->text('no_hp_wali')->nullable();
            $table->timestampTz('deleted_at')->nullable();
            $table->text('photo_path')->nullable();
            $table->timestampTz('photo_updated_at')->nullable();

            $table->foreign('id')->references('id')->on('users')->cascadeOnDelete();
        });

        Schema::table('audit_log', function (Blueprint $table) {
            $table->foreign('user_id')->references('id')->on('profiles')->nullOnDelete();
        });

        Schema::create('settings', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->text('nama_sekolah')->nullable();
            $table->text('logo_url')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->text('logourl')->nullable();
            $table->boolean('registrasisiswaaktif')->default(true);
            $table->boolean('registrasiguruaktif')->default(false);
            $table->boolean('registrasiadminaktif')->default(false);
            $table->text('tahun_ajaran')->nullable();
            $table->text('semester_aktif')->nullable();
            $table->text('email')->nullable();
            $table->text('telepon')->nullable();
            $table->text('alamat')->nullable();
            $table->boolean('registrasi_siswa_aktif')->default(true);
            $table->boolean('registrasi_guru_aktif')->default(false);
            $table->boolean('registrasi_admin_aktif')->default(false);
            $table->timestampTz('updated_at')->useCurrent();
            $table->boolean('scan_manual_enabled')->default(false);
            $table->boolean('scan_always_active')->default(true);
            $table->time('manual_jam_masuk_mulai')->nullable();
            $table->time('manual_jam_masuk_selesai')->nullable();
            $table->time('manual_jam_pulang_mulai')->nullable();
            $table->time('manual_jam_pulang_selesai')->nullable();
            $table->text('visi')->nullable();
            $table->text('misi')->nullable();
            $table->text('link_instagram')->nullable();
            $table->text('link_facebook')->nullable();
            $table->text('link_youtube')->nullable();
            $table->text('link_tiktok')->nullable();
            $table->boolean('auto_alpha_enabled')->default(true);
            $table->text('logo_path')->nullable();
            $table->timestampTz('logo_updated_at')->nullable();
        });

        Schema::create('struktur_sekolah', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('jabatan');
            $table->uuid('guru_id')->nullable();
            $table->text('guru_nama')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('guru_id')->references('id')->on('profiles');
        });

        Schema::create('kelas_struktur', function (Blueprint $table) {
            $table->text('kelas_id')->primary();
            $table->uuid('wali_guru_id')->nullable();
            $table->text('wali_guru_nama')->nullable();
            $table->text('ketua_siswa_id')->nullable();
            $table->text('ketua_siswa_nama')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('kelas_id')->references('id')->on('kelas')->cascadeOnDelete();
            $table->foreign('wali_guru_id')->references('id')->on('profiles');
        });

        Schema::create('organisasi', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('nama');
            $table->text('visi')->nullable();
            $table->text('misi')->nullable();
            $table->uuid('pembina_guru_id')->nullable();
            $table->text('pembina_guru_nama')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('pembina_guru_id')->references('id')->on('profiles');
        });

        Schema::create('organisasi_anggota', function (Blueprint $table) {
            $table->increments('id');
            $table->text('organisasi_id')->nullable();
            $table->text('siswa_id');
            $table->text('nama');
            $table->text('kelas')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->text('jabatan')->default('Anggota');
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('organisasi_id')->references('id')->on('organisasi')->cascadeOnDelete();
        });

        Schema::create('osis_anggota', function (Blueprint $table) {
            $table->increments('id');
            $table->uuid('siswa_id')->unique();
            $table->text('nama');
            $table->text('kelas')->nullable();
            $table->text('status')->default('aktif');
            $table->text('bagian')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('siswa_id')->references('id')->on('profiles')->cascadeOnDelete();
        });

        Schema::create('ekskul', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('nama');
            $table->text('keterangan')->nullable();
            $table->text('hari')->nullable();
            $table->time('jam_mulai')->nullable();
            $table->time('jam_selesai')->nullable();
            $table->uuid('pembina_guru_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('pembina_guru_id')->references('id')->on('profiles');
        });

        Schema::create('ekskul_anggota', function (Blueprint $table) {
            $table->increments('id');
            $table->text('ekskul_id')->nullable();
            $table->uuid('user_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('ekskul_id')->references('id')->on('ekskul')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('profiles')->cascadeOnDelete();
        });

        Schema::create('anggota_ekskul', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->bigInteger('ekskul_id')->nullable();
            $table->uuid('user_id')->nullable();

            $table->foreign('user_id')->references('id')->on('profiles')->cascadeOnDelete();
        });

        Schema::create('pengumuman', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('judul');
            $table->text('keterangan')->nullable();
            $table->text('target')->default('semua');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();
        });

        Schema::create('jadwal', function (Blueprint $table) {
            $table->text('id');
            $table->text('kelas_id');
            $table->text('hari');
            $table->text('mapel');
            $table->uuid('guru_id')->nullable();
            $table->text('guru_nama')->nullable();
            $table->time('jam_mulai');
            $table->time('jam_selesai');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->primary(['id', 'kelas_id']);
            $table->foreign('kelas_id')->references('id')->on('kelas')->cascadeOnDelete();
            $table->foreign('guru_id')->references('id')->on('profiles');
        });

        Schema::create('jam_kosong', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->date('tanggal');
            $table->text('kelas');
            $table->text('mapel');
            $table->time('jam_mulai');
            $table->time('jam_selesai');
            $table->text('alasan');
            $table->text('guru_pengganti')->nullable();
            $table->uuid('created_by');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('created_by')->references('id')->on('profiles')->cascadeOnDelete();
        });

        Schema::create('absensi', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->text('kelas');
            $table->date('tanggal');
            $table->uuid('uid');
            $table->text('mapel');
            $table->enum('status', ['Hadir', 'Izin', 'Sakit', 'Alpha']);
            $table->text('nama')->nullable();
            $table->timestampTz('waktu')->useCurrent();
            $table->text('komentar')->nullable();
            $table->text('oleh')->nullable();
            $table->uuid('dikonfirmasi')->nullable();

            $table->foreign('uid')->references('id')->on('profiles')->cascadeOnDelete();
        });

        Schema::create('absensi_ajuan', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->text('kelas');
            $table->date('tanggal');
            $table->uuid('uid');
            $table->text('nama');
            $table->text('alasan');
            $table->text('mapel');
            $table->timestampTz('created_at')->useCurrent();
            $table->enum('status_guru', ['pending', 'terima', 'sakit', 'tolak'])->default('pending');
            $table->enum('kategori_final', ['Izin', 'Sakit', 'Alpha'])->nullable();
            $table->uuid('guru_id')->nullable();
            $table->text('guru_nama')->nullable();
            $table->timestampTz('waktu_respon')->nullable();

            $table->foreign('uid')->references('id')->on('profiles')->cascadeOnDelete();
            $table->foreign('guru_id')->references('id')->on('profiles');
        });

        Schema::create('absensi_settings', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->text('kelas');
            $table->date('tanggal');
            $table->text('mapel');
            $table->enum('mode', ['manual', 'otomatis'])->default('manual');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();
        });

        Schema::create('absensi_rfid_settings', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->boolean('rfid_aktif')->default(false);
            $table->time('rfid_mulai')->nullable();
            $table->time('rfid_selesai')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();
        });

        Schema::create('absensi_eskul', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->text('ekskul_id')->nullable();
            $table->uuid('user_id')->nullable();
            $table->date('tanggal');
            $table->enum('status', ['Hadir', 'Izin', 'Alpha']);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('ekskul_id')->references('id')->on('ekskul');
            $table->foreign('user_id')->references('id')->on('profiles');
        });

        Schema::create('absensi_scan_temp', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->date('tanggal');
            $table->uuid('siswa_id');
            $table->text('kelas');
            $table->enum('sesi', ['masuk', 'pulang']);
            $table->timestampTz('scan_at')->useCurrent();
            $table->text('source')->nullable();
            $table->text('card_uid')->nullable();
            $table->integer('mapel_count')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('siswa_id')->references('id')->on('profiles')->cascadeOnDelete();
        });

        Schema::create('rfid_scans', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->text('card_uid');
            $table->text('device_id')->nullable();
            $table->enum('status', ['raw', 'processed', 'error'])->default('raw');
            $table->timestampTz('created_at')->useCurrent();
        });

        Schema::create('certificates', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->uuid('user_id')->nullable();
            $table->text('nama_penerima');
            $table->text('email')->nullable();
            $table->text('kelas')->nullable();
            $table->text('event');
            $table->date('event_date')->nullable();
            $table->text('file_url');
            $table->boolean('sent')->default(false);
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('issued_at')->useCurrent();

            $table->foreign('user_id')->references('id')->on('profiles')->cascadeOnDelete();
        });

        Schema::create('templat_sertifikat_publik', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->text('nama');
            $table->text('deskripsi')->nullable();
            $table->text('background_url');
            $table->text('text_color')->default('#000000');
            $table->text('font_family')->default('Helvetica');
            $table->integer('font_size')->default(24);
            $table->integer('nama_x')->default(420);
            $table->integer('nama_y')->default(260);
            $table->integer('event_x')->default(420);
            $table->integer('event_y')->default(310);
            $table->integer('tanggal_x')->default(420);
            $table->integer('tanggal_y')->default(380);
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();
            $table->jsonb('fields')->default($this->jsonbDefault());

            $table->foreign('created_by')->references('id')->on('users');
        });

        Schema::create('tugas', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->text('kelas');
            $table->text('judul');
            $table->text('mapel');
            $table->timestampTz('deadline')->nullable();
            $table->text('keterangan')->nullable();
            $table->text('file_url')->nullable();
            $table->text('link')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('created_by')->references('id')->on('profiles');
        });

        Schema::create('tugas_jawaban', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->bigInteger('tugas_id')->nullable();
            $table->uuid('user_id')->nullable();
            $table->text('file_url')->nullable();
            $table->text('link_url')->nullable();
            $table->text('file_name')->nullable();
            $table->timestampTz('waktu_submit')->useCurrent();
            $table->text('status')->nullable();
            $table->integer('nilai')->nullable();
            $table->timestampTz('dinilai_at')->nullable();
            $table->uuid('dinilai_oleh')->nullable();

            $table->foreign('tugas_id')->references('id')->on('tugas')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('profiles')->cascadeOnDelete();
            $table->foreign('dinilai_oleh')->references('id')->on('profiles');
        });

        Schema::create('printed_cards', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->uuid('student_id');
            $table->timestampTz('printed_at')->useCurrent();
            $table->text('printed_by');
            $table->text('class_id');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('student_id')->references('id')->on('profiles')->cascadeOnDelete();
        });

        Schema::create('registration_otps', function (Blueprint $table) {
            $this->uuidPrimary($table);
            $table->text('email');
            $table->enum('role', ['siswa', 'guru', 'admin']);
            $table->text('otp_code');
            $table->timestampTz('expires_at');
            $table->boolean('used')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->integer('attempt_count')->default(0);
        });

        if ($this->isPostgres()) {
            DB::statement('alter table profiles add constraint profiles_no_hp_siswa_len check (no_hp_siswa is null or length(no_hp_siswa) <= 14)');
            DB::statement('alter table profiles add constraint profiles_no_hp_wali_len check (no_hp_wali is null or length(no_hp_wali) <= 14)');
            DB::statement('alter table tugas_jawaban add constraint tugas_jawaban_nilai_check check (nilai is null or (nilai >= 0 and nilai <= 100))');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('registration_otps');
        Schema::dropIfExists('printed_cards');
        Schema::dropIfExists('tugas_jawaban');
        Schema::dropIfExists('tugas');
        Schema::dropIfExists('templat_sertifikat_publik');
        Schema::dropIfExists('certificates');
        Schema::dropIfExists('rfid_scans');
        Schema::dropIfExists('absensi_scan_temp');
        Schema::dropIfExists('absensi_eskul');
        Schema::dropIfExists('absensi_rfid_settings');
        Schema::dropIfExists('absensi_settings');
        Schema::dropIfExists('absensi_ajuan');
        Schema::dropIfExists('absensi');
        Schema::dropIfExists('jam_kosong');
        Schema::dropIfExists('jadwal');
        Schema::dropIfExists('pengumuman');
        Schema::dropIfExists('anggota_ekskul');
        Schema::dropIfExists('ekskul_anggota');
        Schema::dropIfExists('ekskul');
        Schema::dropIfExists('osis_anggota');
        Schema::dropIfExists('organisasi_anggota');
        Schema::dropIfExists('organisasi');
        Schema::dropIfExists('kelas_struktur');
        Schema::dropIfExists('struktur_sekolah');
        Schema::dropIfExists('settings');
        Schema::dropIfExists('profiles');
        Schema::dropIfExists('mata_pelajaran');
        Schema::dropIfExists('kelas');
        Schema::dropIfExists('audit_log');
        Schema::dropIfExists('anggota_eksku1');
        Schema::dropIfExists('allowed_registrations');
        Schema::dropIfExists('admin_users');
        Schema::dropIfExists('_policy_backup');
    }
};
