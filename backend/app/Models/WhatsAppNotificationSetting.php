<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WhatsAppNotificationSetting extends Model
{
    use HasFactory;

    protected $table = 'whatsapp_notification_settings';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'tenant_id',
        'integration_id',
        'is_enabled',
        'send_attendance',
        'send_profile_updates',
        'send_assignment_updates',
        'send_extracurricular_updates',
        'send_grade_updates',
        'recipient_mode',
    ];

    protected $casts = [
        'is_enabled' => 'boolean',
        'send_attendance' => 'boolean',
        'send_profile_updates' => 'boolean',
        'send_assignment_updates' => 'boolean',
        'send_extracurricular_updates' => 'boolean',
        'send_grade_updates' => 'boolean',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function integration(): BelongsTo
    {
        return $this->belongsTo(WhatsAppIntegration::class, 'integration_id');
    }
}
