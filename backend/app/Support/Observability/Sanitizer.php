<?php

namespace App\Support\Observability;

final class Sanitizer
{
    private const SENSITIVE = [
        'password', 'token', 'authorization', 'cookie', 'secret', 'credential',
        'access_token', 'refresh_token', 'answer_key', 'rfid_uid', 'signed_url',
    ];

    public static function value(mixed $value, int $depth = 0): mixed
    {
        if ($depth > 4) {
            return '[TRUNCATED]';
        }

        if (is_array($value)) {
            $result = [];
            foreach (array_slice($value, 0, 100, true) as $key => $item) {
                $keyString = strtolower((string) $key);
                $result[$key] = self::isSensitive($keyString)
                    ? '[REDACTED]'
                    : self::value($item, $depth + 1);
            }

            return $result;
        }

        if (is_string($value)) {
            return mb_substr($value, 0, 2000);
        }

        if (is_scalar($value) || $value === null) {
            return $value;
        }

        return '[REDACTED]';
    }

    private static function isSensitive(string $key): bool
    {
        foreach (self::SENSITIVE as $needle) {
            if (str_contains($key, $needle)) {
                return true;
            }
        }

        return false;
    }
}
