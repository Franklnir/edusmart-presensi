<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Api\ReportController as LegacyReportController;

/**
 * V2 report facade.
 *
 * The report query implementation is shared with the already tenant-scoped
 * report domain. Keeping the V2 contract at a separate route lets consumers
 * leave the legacy URL without introducing a generic database proxy.
 */
class TeacherReportController extends LegacyReportController
{
}
