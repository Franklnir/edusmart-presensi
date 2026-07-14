<?php

namespace App\Exceptions;

use RuntimeException;

class UploadException extends RuntimeException
{
    public function __construct(
        public readonly string $stableCode,
        string $message,
        public readonly int $httpStatus
    ) {
        parent::__construct($message);
    }
}
