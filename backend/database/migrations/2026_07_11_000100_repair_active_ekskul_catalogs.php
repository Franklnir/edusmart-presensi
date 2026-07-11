<?php

use App\Services\Academic\ExtracurricularPeriodService;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        app(ExtracurricularPeriodService::class)->repairEmptyActiveCatalogs();
    }

    public function down(): void
    {
        // Data repair is additive. Keep period snapshots intact on rollback.
    }
};
