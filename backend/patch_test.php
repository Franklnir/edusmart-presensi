<?php
$content = file_get_contents('tests/Feature/Api/V2/ReportCardControllerTest.php');
$content = str_replace("->dump()->assertOk()", "->assertOk()", $content);
$content = str_replace("->dump()->assertStatus(403)", "->assertStatus(403)", $content);
$content = str_replace("clone \$student->id", "\$student->id", $content);
file_put_contents('tests/Feature/Api/V2/ReportCardControllerTest.php', $content);
