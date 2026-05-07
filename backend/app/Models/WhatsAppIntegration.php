<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class WhatsAppIntegration extends Model
{
    use HasFactory;

    protected $table = 'whatsapp_integrations';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'tenant_id',
        'provider',
        'instance_name',
        'status',
        'connection_state',
        'qr_code',
        'pairing_code',
        'connected_phone',
        'connected_name',
        'last_connected_at',
        'last_disconnected_at',
        'qr_updated_at',
        'last_synced_at',
        'last_webhook_at',
        'last_webhook_event',
        'last_error',
        'webhook_secret',
        'is_enabled',
    ];

    protected $hidden = [
        'webhook_secret',
    ];

    protected $casts = [
        'is_enabled' => 'boolean',
        'last_connected_at' => 'datetime',
        'last_disconnected_at' => 'datetime',
        'qr_updated_at' => 'datetime',
        'last_synced_at' => 'datetime',
        'last_webhook_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function notificationSettings(): HasOne
    {
        return $this->hasOne(WhatsAppNotificationSetting::class, 'integration_id');
    }

    public function messageLogs(): HasMany
    {
        return $this->hasMany(WhatsAppMessageLog::class, 'integration_id');
    }

    public function isConnected(): bool
    {
        $status = strtolower(trim((string) $this->status));
        $state = strtolower(trim((string) $this->connection_state));

        return in_array($status, ['connected', 'open'], true)
            || in_array($state, ['connected', 'open'], true);
    }
}
