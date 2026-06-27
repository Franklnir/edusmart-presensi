<?php

namespace App\Services\Backup;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;

class BackupNotificationService
{
    public function backupSucceeded(string $tenantId, array $result = [], bool $auto = false): void
    {
        if (! $this->enabled('success')) {
            return;
        }

        $tenant = $this->tenantContext($tenantId);
        $subject = '[SISMU Backup] Backup Berhasil - '.$tenant['name'];
        $summary = (array) ($result['summary'] ?? []);
        $body = $this->body($tenant, [
            'Status' => 'Berhasil',
            'Jenis' => $auto ? 'Backup otomatis' : 'Backup bulanan',
            'Bulan dibuat' => (string) ($summary['created'] ?? 0),
            'Bulan diperbarui' => (string) ($summary['updated'] ?? 0),
            'Bulan dilewati' => (string) ($summary['skipped'] ?? 0),
            'Gagal' => (string) ($summary['failed'] ?? 0),
            'Pesan' => (string) ($summary['message'] ?? 'Backup berhasil diproses.'),
        ]);

        $this->send($tenantId, $subject, $body);
    }

    public function backupFailed(string $tenantId, string $message, array $context = []): void
    {
        if (! $this->enabled('failure')) {
            return;
        }

        $tenant = $this->tenantContext($tenantId);
        $subject = '[SISMU Backup] Backup Gagal - '.$tenant['name'];
        $body = $this->body($tenant, [
            'Status' => 'Gagal',
            'Jenis' => (bool) ($context['auto'] ?? false) ? 'Backup otomatis' : 'Backup bulanan',
            'Bulan' => (string) ($context['month'] ?? '-'),
            'Pesan error' => $message,
            'Instruksi' => 'Cek status backup dan Google Drive di menu Backup. Jika Drive perlu perhatian, sambungkan ulang Google Drive.',
        ]);

        $this->send($tenantId, $subject, $body);
    }

    public function googleDriveRecovered(string $tenantId, array $result = []): void
    {
        if (! $this->enabled('drive_attention')) {
            return;
        }

        $tenant = $this->tenantContext($tenantId);
        $subject = '[SISMU Backup] Google Drive Berhasil Dipulihkan - '.$tenant['name'];
        $body = $this->body($tenant, [
            'Status' => 'Google Drive connected',
            'Pesan' => (string) ($result['message'] ?? 'Google Drive berhasil dipulihkan otomatis.'),
            'Instruksi' => 'Tidak perlu tindakan tambahan. Backup otomatis dapat berjalan kembali.',
        ]);

        $this->send($tenantId, $subject, $body);
    }

    public function googleDriveNeedsAttention(string $tenantId, array|string $result): void
    {
        if (! $this->enabled('drive_attention')) {
            return;
        }

        $payload = is_array($result) ? $result : ['last_error' => (string) $result];
        $tenant = $this->tenantContext($tenantId);
        $subject = '[SISMU Backup] Google Drive Perlu Disambungkan Ulang - '.$tenant['name'];
        $body = $this->body($tenant, [
            'Status' => 'Perlu perhatian',
            'Pesan error' => (string) ($payload['last_error'] ?? $payload['message'] ?? 'Google Drive perlu perhatian.'),
            'Perlu sambungkan ulang' => (bool) ($payload['requires_reconnect'] ?? true) ? 'Ya' : 'Belum tentu',
            'Instruksi' => 'Buka menu Backup atau Pengaturan Google Drive, lalu klik Sambungkan ulang Google Drive jika diminta.',
        ]);

        $this->send($tenantId, $subject, $body);
    }

    private function enabled(string $event): bool
    {
        if (! (bool) config('backup.notify_email_enabled', false)) {
            return false;
        }

        return match ($event) {
            'success' => (bool) config('backup.notify_on_success', false),
            'failure' => (bool) config('backup.notify_on_failure', true),
            'drive_attention' => (bool) config('backup.notify_on_drive_attention', true),
            default => false,
        };
    }

    private function send(string $tenantId, string $subject, string $body): void
    {
        $recipients = $this->tenantAdminEmails($tenantId);
        $superRecipients = (bool) config('backup.notify_super_admin', true)
            ? $this->superAdminEmails()
            : [];

        $to = array_values(array_unique($recipients));
        $bcc = array_values(array_diff(array_unique($superRecipients), $to));
        if (empty($to) && ! empty($bcc)) {
            $to[] = array_shift($bcc);
        }
        if (empty($to)) {
            Log::warning('backup_email_notification_skipped_no_recipient', [
                'tenant_id' => $tenantId,
                'subject' => $subject,
            ]);

            return;
        }

        try {
            Mail::raw($body, function ($message) use ($to, $bcc, $subject) {
                $message->to($to)->subject($subject);
                if (! empty($bcc)) {
                    $message->bcc($bcc);
                }
            });
        } catch (\Throwable $e) {
            Log::warning('backup_email_notification_failed', [
                'tenant_id' => $tenantId,
                'subject' => $subject,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function body(array $tenant, array $lines): string
    {
        $base = [
            'Nama sekolah' => $tenant['name'],
            'Tenant ID' => $tenant['id'],
            'Slug' => $tenant['slug'] ?: '-',
            'Waktu server' => now('Asia/Jakarta')->format('Y-m-d H:i:s').' WIB',
        ];

        $text = "Notifikasi backup SISMU\n\n";
        foreach (array_merge($base, $lines) as $label => $value) {
            $text .= $label.': '.$this->lineValue($value)."\n";
        }

        return $text;
    }

    private function lineValue(mixed $value): string
    {
        if ($value instanceof Carbon) {
            return $value->copy()->timezone('Asia/Jakarta')->format('Y-m-d H:i:s').' WIB';
        }
        if (is_bool($value)) {
            return $value ? 'Ya' : 'Tidak';
        }
        if (is_scalar($value) || $value === null) {
            return trim((string) $value) !== '' ? (string) $value : '-';
        }

        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '-';
    }

    private function tenantContext(string $tenantId): array
    {
        $tenantId = trim($tenantId);
        $tenant = Schema::hasTable('tenants')
            ? DB::table('tenants')->where('id', $tenantId)->first(['id', 'name', 'slug'])
            : null;

        $schoolName = null;
        if (
            Schema::hasTable('settings')
            && Schema::hasColumn('settings', 'tenant_id')
            && Schema::hasColumn('settings', 'nama_sekolah')
        ) {
            $schoolName = DB::table('settings')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->value('nama_sekolah');
        }

        return [
            'id' => $tenantId,
            'name' => trim((string) ($schoolName ?: $tenant?->name ?: 'Sekolah')),
            'slug' => trim((string) ($tenant?->slug ?? '')),
        ];
    }

    private function tenantAdminEmails(string $tenantId): array
    {
        if (
            ! Schema::hasTable('profiles')
            || ! Schema::hasColumn('profiles', 'email')
            || ! Schema::hasColumn('profiles', 'role')
        ) {
            return [];
        }

        $query = DB::table('profiles')
            ->where('role', 'admin')
            ->whereNotNull('email');

        if (Schema::hasColumn('profiles', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query
            ->pluck('email')
            ->map(fn ($email) => strtolower(trim((string) $email)))
            ->filter(fn ($email) => filter_var($email, FILTER_VALIDATE_EMAIL))
            ->unique()
            ->values()
            ->all();
    }

    private function superAdminEmails(): array
    {
        $emails = array_map('strtolower', (array) config('superadmin.emails', []));

        if (
            Schema::hasTable('super_admins')
            && Schema::hasTable('profiles')
            && Schema::hasColumn('super_admins', 'user_id')
            && Schema::hasColumn('profiles', 'id')
            && Schema::hasColumn('profiles', 'email')
        ) {
            $rows = DB::table('super_admins as s')
                ->join('profiles as p', 'p.id', '=', 's.user_id')
                ->whereNotNull('p.email')
                ->pluck('p.email')
                ->all();
            $emails = array_merge($emails, array_map('strtolower', array_map('trim', $rows)));
        }

        return array_values(array_unique(array_filter($emails, fn ($email) => filter_var($email, FILTER_VALIDATE_EMAIL))));
    }
}
