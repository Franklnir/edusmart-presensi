<?php

namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\JsonResponse;

class IdempotencyService
{
    /**
     * Handle idempotent request using a closure.
     *
     * @param Request $request
     * @param string $idempotencyKey
     * @param callable $callback
     * @return JsonResponse|mixed
     */
    public function handle(Request $request, string $idempotencyKey, callable $callback)
    {
        $tenantId = $request->attributes->get('tenant_id', 'no_tenant');
        $userId = $request->user() ? $request->user()->id : 'guest';
        $endpoint = $request->path();
        
        // Buat hash dari payload
        $payloadHash = md5(json_encode($request->except(['idempotency_key'])));

        // Kunci cache
        $cacheKey = "idemp_{$tenantId}_{$userId}_{$idempotencyKey}";

        // Gunakan Cache atomic lock untuk mencegah race condition (waktu tunggu 5 detik)
        $lock = Cache::lock("lock_{$cacheKey}", 10);

        if ($lock->get()) {
            try {
                // Cek apakah hasil sudah ada di cache
                if (Cache::has($cacheKey)) {
                    $cachedData = Cache::get($cacheKey);
                    
                    if ($cachedData['hash'] !== $payloadHash) {
                        return response()->json([
                            'success' => false,
                            'code' => 'IDEMPOTENCY_CONFLICT',
                            'message' => 'Permintaan sebelumnya dengan Idempotency-Key yang sama menggunakan data yang berbeda.',
                            'error' => 'Conflict with previous idempotent request payload.',
                            'request_id' => $request->header('X-Request-ID')
                        ], 409);
                    }

                    return response()->json($cachedData['response'], $cachedData['status_code']);
                }

                // Eksekusi logic utama
                $response = $callback();

                if ($response instanceof JsonResponse) {
                    $statusCode = $response->getStatusCode();
                    // Hanya simpan cache untuk response 2xx (berhasil)
                    if ($statusCode >= 200 && $statusCode < 300) {
                        $dataToCache = [
                            'hash' => $payloadHash,
                            'status_code' => $statusCode,
                            'response' => $response->getData(true)
                        ];
                        // Simpan selama 24 jam
                        Cache::put($cacheKey, $dataToCache, 86400);
                    }
                }

                return $response;
            } finally {
                $lock->release();
            }
        } else {
            // Gagal mendapatkan lock (artinya request paralel sedang diproses)
            return response()->json([
                'success' => false,
                'code' => 'IDEMPOTENCY_PROCESSING',
                'message' => 'Permintaan sedang diproses, silakan coba lagi.',
                'error' => 'Concurrent request in progress.',
                'request_id' => $request->header('X-Request-ID')
            ], 409);
        }
    }
}
