<?php

namespace App\Support\Observability;

use Illuminate\Http\Request;
use Illuminate\Support\Str;

final class RequestId
{
    public const HEADER = 'X-Request-ID';

    public const CORRELATION_HEADER = 'X-Correlation-ID';

    public static function valid(?string $value): bool
    {
        return is_string($value)
            && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', trim($value)) === 1;
    }

    public static function resolve(Request $request): string
    {
        $candidate = trim((string) $request->header(self::HEADER, ''));
        $requestId = self::valid($candidate) ? strtolower($candidate) : Str::uuid()->toString();
        $request->attributes->set('request_id', $requestId);

        return $requestId;
    }

    public static function get(Request $request): string
    {
        $value = trim((string) $request->attributes->get('request_id', ''));

        return self::valid($value) ? strtolower($value) : self::resolve($request);
    }

    public static function correlationId(Request $request): ?string
    {
        $candidate = trim((string) $request->header(self::CORRELATION_HEADER, ''));
        if (! self::valid($candidate)) {
            return null;
        }

        $value = strtolower($candidate);
        $request->attributes->set('correlation_id', $value);

        return $value;
    }
}
