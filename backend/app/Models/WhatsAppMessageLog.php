<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WhatsAppMessageLog extends Model
{
    use HasFactory;

    protected $table = 'whatsapp_message_logs';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'tenant_id',
        'integration_id',
        'category',
        'event_key',
        'source_table',
        'source_record_id',
        'target_profile_id',
        'target_name',
        'target_phone',
        'normalized_phone',
        'message_text',
        'status',
        'attempt_count',
        'provider_message_id',
        'provider_status',
        'provider_response',
        'last_error',
        'queued_at',
        'sent_at',
        'failed_at',
    ];

    protected $casts = [
        'attempt_count' => 'integer',
        'queued_at' => 'datetime',
        'sent_at' => 'datetime',
        'failed_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function integration(): BelongsTo
    {
        return $this->belongsTo(WhatsAppIntegration::class, 'integration_id');
    }
}
