<?php

namespace Tests\Unit;

use App\Support\AcademicScopeRegistry;
use PHPUnit\Framework\TestCase;

class AcademicScopeRegistryTest extends TestCase
{
    public function test_tables_have_one_explicit_academic_scope(): void
    {
        $this->assertSame(AcademicScopeRegistry::YEAR, AcademicScopeRegistry::scopeFor('jadwal'));
        $this->assertSame(AcademicScopeRegistry::YEAR, AcademicScopeRegistry::scopeFor('kelas_struktur'));
        $this->assertSame(AcademicScopeRegistry::YEAR, AcademicScopeRegistry::scopeFor('organisasi'));
        $this->assertSame(AcademicScopeRegistry::TERM, AcademicScopeRegistry::scopeFor('tugas'));
        $this->assertSame(AcademicScopeRegistry::TERM, AcademicScopeRegistry::scopeFor('quizzes'));
        $this->assertSame(AcademicScopeRegistry::TERM, AcademicScopeRegistry::scopeFor('absensi'));
        $this->assertSame(AcademicScopeRegistry::TERM, AcademicScopeRegistry::scopeFor('guru_mapel_bobot'));
        $this->assertSame(AcademicScopeRegistry::PARENT_SNAPSHOT, AcademicScopeRegistry::scopeFor('quiz_submissions'));
        $this->assertSame(AcademicScopeRegistry::CURRENT, AcademicScopeRegistry::scopeFor('kelas'));
        $this->assertSame(AcademicScopeRegistry::GLOBAL, AcademicScopeRegistry::scopeFor('profiles'));
    }

    public function test_no_table_is_registered_in_multiple_scopes(): void
    {
        $allTables = AcademicScopeRegistry::allRegisteredTables();

        $this->assertSame($allTables, array_values(array_unique($allTables)));
    }
}
