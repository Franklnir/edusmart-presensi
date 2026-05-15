<?php

namespace Tests\Unit;

use App\Support\AcademicPeriod;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\TestCase;

class AcademicPeriodTest extends TestCase
{
    public function test_ganjil_semester_uses_july_to_december(): void
    {
        $period = AcademicPeriod::make('2025/2026', 'ganjil');

        $this->assertSame('2025/2026', $period['tahun_ajaran']);
        $this->assertSame('Ganjil', $period['semester']);
        $this->assertSame('2025-07-01', $period['starts_at']);
        $this->assertSame('2025-12-31', $period['ends_at']);
        $this->assertSame([7, 8, 9, 10, 11, 12], $period['month_numbers']);
        $this->assertSame('Juli 2025', $period['months'][0]['label']);
    }

    public function test_genap_semester_uses_january_to_june_of_end_year(): void
    {
        $period = AcademicPeriod::make('2025-2026', '2');

        $this->assertSame('2025/2026', $period['tahun_ajaran']);
        $this->assertSame('Genap', $period['semester']);
        $this->assertSame('2026-01-01', $period['starts_at']);
        $this->assertSame('2026-06-30', $period['ends_at']);
        $this->assertSame([1, 2, 3, 4, 5, 6], $period['month_numbers']);
        $this->assertSame('Juni 2026', $period['months'][5]['label']);
    }

    public function test_current_period_follows_school_year_cutover(): void
    {
        $june = AcademicPeriod::current(Carbon::create(2026, 6, 10, 8, 0, 0, 'Asia/Jakarta'));
        $july = AcademicPeriod::current(Carbon::create(2026, 7, 10, 8, 0, 0, 'Asia/Jakarta'));

        $this->assertSame('2025/2026', $june['tahun_ajaran']);
        $this->assertSame('Genap', $june['semester']);
        $this->assertSame('2026-06-30', $june['ends_at']);

        $this->assertSame('2026/2027', $july['tahun_ajaran']);
        $this->assertSame('Ganjil', $july['semester']);
        $this->assertSame('2026-07-01', $july['starts_at']);
    }

    public function test_custom_school_month_range_overrides_default_semester_months(): void
    {
        $settings = (object) [
            'tahun_ajaran' => '2026/2027',
            'semester_aktif' => 'Ganjil',
            'periode_mulai' => '2026-08-01',
            'periode_selesai' => '2026-11-30',
        ];

        $period = AcademicPeriod::fromSettings($settings);

        $this->assertSame('2026-08-01', $period['starts_at']);
        $this->assertSame('2026-11-30', $period['ends_at']);
        $this->assertTrue($period['custom_range']);
        $this->assertSame([8, 9, 10, 11], $period['month_numbers']);
        $this->assertSame('Agustus 2026 - November 2026', $period['range_label']);
    }
}
