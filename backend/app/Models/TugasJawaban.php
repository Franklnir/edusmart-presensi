<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TugasJawaban extends Model
{
    use HasFactory;

    protected $table = 'tugas_jawaban';

    // The primary key is likely bigIncrements as defined in migration
    protected $primaryKey = 'id';

    public $timestamps = false; // We use custom timestamps like waktu_submit

    protected $guarded = ['id'];

    protected $casts = [
        'waktu_submit' => 'datetime',
        'dinilai_at' => 'datetime',
        'file_urls' => 'array',
        'attachment_ids' => 'array',
    ];

    public function tugas(): BelongsTo
    {
        return $this->belongsTo(Tugas::class, 'tugas_id');
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(Profile::class, 'user_id');
    }

    public function grader(): BelongsTo
    {
        return $this->belongsTo(Profile::class, 'dinilai_oleh');
    }
}
