<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('tenant_mqtt_configs')) {
            return;
        }

        foreach ([
            'scan_topic_template' => 'scan',
            'response_topic_template' => 'response',
            'mode_topic_template' => 'mode',
        ] as $column => $suffix) {
            if (! Schema::hasColumn('tenant_mqtt_configs', $column)) {
                continue;
            }

            \Illuminate\Support\Facades\DB::table('tenant_mqtt_configs')
                ->where(function ($query) use ($column) {
                    $query->whereNull($column)
                        ->orWhere($column, '')
                        ->orWhere($column, 'not like', '%{device}%');
                })
                ->get(['id', $column])
                ->each(function ($row) use ($column, $suffix): void {
                    $current = trim((string) ($row->{$column} ?? ''));
                    if ($current === '') {
                        $current = "edusmart/{tenant}/rfid/{$suffix}";
                    }
                    $next = str_ends_with($current, "/rfid/{$suffix}")
                        ? substr($current, 0, -strlen("/rfid/{$suffix}"))."/rfid/{device}/{$suffix}"
                        : $current.'/{device}';

                    \Illuminate\Support\Facades\DB::table('tenant_mqtt_configs')
                        ->where('id', $row->id)
                        ->update([
                            $column => $next,
                            'updated_at' => now(),
                        ]);
                });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('tenant_mqtt_configs')) {
            return;
        }

        foreach ([
            'scan_topic_template' => 'scan',
            'response_topic_template' => 'response',
            'mode_topic_template' => 'mode',
        ] as $column => $suffix) {
            if (! Schema::hasColumn('tenant_mqtt_configs', $column)) {
                continue;
            }

            \Illuminate\Support\Facades\DB::table('tenant_mqtt_configs')
                ->where($column, 'like', '%/{device}/'.$suffix)
                ->get(['id', $column])
                ->each(function ($row) use ($column, $suffix): void {
                    $next = str_replace('/{device}/'.$suffix, '/'.$suffix, (string) $row->{$column});
                    \Illuminate\Support\Facades\DB::table('tenant_mqtt_configs')
                        ->where('id', $row->id)
                        ->update([
                            $column => $next,
                            'updated_at' => now(),
                        ]);
                });
        }
    }
};
