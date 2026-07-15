<?php

namespace App\Support\Observability;

use App\Exceptions\UploadException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

final class ApiErrorResponse
{
    public static function fromException(Throwable $exception, Request $request): JsonResponse
    {
        $requestId = RequestId::get($request);
        $status = self::status($exception);
        $details = self::details($exception, $status);
        $payload = [
            'success' => false,
            'code' => self::code($exception, $status),
            'message' => self::message($exception, $status),
            'details' => $details,
            'request_id' => $requestId,
            // Compatibility alias for older consumers.
            'errors' => $details['errors'] ?? (object) [],
        ];
        $response = response()->json($payload, $status)->header(RequestId::HEADER, $requestId);
        if ($correlationId = $request->attributes->get('correlation_id')) {
            $response->header(RequestId::CORRELATION_HEADER, (string) $correlationId);
        }

        if ($retryAfter = self::retryAfter($exception)) {
            $response->header('Retry-After', (string) $retryAfter);
        }

        return $response;
    }

    private static function status(Throwable $exception): int
    {
        if ($exception instanceof UploadException) {
            return max(400, min(599, $exception->httpStatus));
        }
        if ($exception instanceof ValidationException) {
            return 422;
        }
        if ($exception instanceof AuthenticationException) {
            return 401;
        }
        if ($exception instanceof AuthorizationException) {
            return 403;
        }
        if ($exception instanceof MethodNotAllowedHttpException) {
            // Do not expose the supported-method list to API callers.
            return 404;
        }
        if ($exception instanceof HttpExceptionInterface) {
            return max(400, min(599, $exception->getStatusCode()));
        }

        return 500;
    }

    private static function code(Throwable $exception, int $status): string
    {
        if ($exception instanceof UploadException) {
            return strtoupper($exception->stableCode);
        }
        if ($exception instanceof ValidationException) {
            return 'VALIDATION_FAILED';
        }
        if ($exception instanceof AuthenticationException) {
            return 'AUTH_UNAUTHENTICATED';
        }
        if ($exception instanceof AuthorizationException) {
            return 'AUTH_FORBIDDEN';
        }

        return match ($status) {
            400 => 'BAD_REQUEST',
            401 => 'AUTH_UNAUTHENTICATED',
            403 => 'AUTH_FORBIDDEN',
            404 => 'RESOURCE_NOT_FOUND',
            409 => 'CONFLICT',
            422 => 'VALIDATION_FAILED',
            429 => 'RATE_LIMITED',
            default => 'INTERNAL_SERVER_ERROR',
        };
    }

    private static function message(Throwable $exception, int $status): string
    {
        if ($exception instanceof ValidationException) {
            return 'Data yang dikirim belum valid.';
        }
        if ($exception instanceof AuthenticationException) {
            return self::safeMessage($exception->getMessage(), 'Unauthenticated.');
        }
        if ($status >= 500) {
            return 'Terjadi kesalahan pada server. Silakan coba lagi.';
        }
        if ($exception instanceof MethodNotAllowedHttpException) {
            return 'Not Found';
        }
        if ($exception instanceof NotFoundHttpException || $status === 404) {
            return 'Data yang diminta tidak ditemukan.';
        }
        if ($exception instanceof AuthorizationException || $status === 403) {
            return self::safeMessage($exception->getMessage(), 'Akses ditolak.');
        }

        return self::safeMessage($exception->getMessage(), match ($status) {
            400 => 'Permintaan tidak valid.',
            409 => 'Permintaan bertentangan dengan kondisi data saat ini.',
            422 => 'Data yang dikirim belum valid.',
            429 => 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
            default => 'Permintaan tidak dapat diproses.',
        });
    }

    private static function details(Throwable $exception, int $status): array
    {
        if ($exception instanceof ValidationException) {
            return ['errors' => self::validatorErrors($exception->validator)];
        }
        if ($status === 429 && ($retryAfter = self::retryAfter($exception))) {
            return ['retry_after' => $retryAfter];
        }

        return [];
    }

    private static function validatorErrors(Validator $validator): array
    {
        return collect($validator->errors()->toArray())->map(
            fn (array $messages): array => array_slice(array_map(
                static fn ($message): string => self::safeMessage((string) $message, 'Nilai tidak valid.'),
                $messages
            ), 0, 5)
        )->all();
    }

    private static function retryAfter(Throwable $exception): ?int
    {
        if (! $exception instanceof HttpExceptionInterface) {
            return null;
        }
        $value = $exception->getHeaders()['Retry-After'] ?? null;

        return is_numeric($value) ? max(1, min(3600, (int) $value)) : null;
    }

    private static function safeMessage(string $message, string $fallback): string
    {
        $message = trim(preg_replace('/\s+/', ' ', $message) ?? '');
        if ($message === '' || strlen($message) > 500 || preg_match(
            '/(?:password|token|secret|authorization|cookie|sqlstate|select\s+.+\s+from|\/home\/|[A-Z]:\\\\)/i',
            $message
        ) === 1) {
            return $fallback;
        }

        return $message;
    }
}
