<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Api\PresenceController as LegacyPresenceController;

/** V2 transport for quiz-page presence without exposing the legacy endpoint. */
class QuizPresenceController extends LegacyPresenceController {}
