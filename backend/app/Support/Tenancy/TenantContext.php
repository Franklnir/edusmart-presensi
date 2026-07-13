<?php

namespace App\Support\Tenancy;

class TenantContext
{
    private ?string $tenantId = null;

    private ?string $tenantSlug = null;

    public function set(string $tenantId, ?string $tenantSlug = null): void
    {
        $tenantId = trim($tenantId);
        if ($tenantId === '') {
            throw new \InvalidArgumentException('Tenant context tidak boleh kosong.');
        }
        if ($this->tenantId !== null && $this->tenantId !== $tenantId) {
            throw new \LogicException('Tenant context tidak boleh diganti di tengah request.');
        }

        $this->tenantId = $tenantId;
        $this->tenantSlug = strtolower(trim((string) $tenantSlug)) ?: null;
    }

    public function id(): ?string
    {
        return $this->tenantId;
    }

    public function requireId(): string
    {
        if ($this->tenantId === null) {
            throw new \LogicException('Tenant context belum diinisialisasi.');
        }

        return $this->tenantId;
    }

    public function slug(): ?string
    {
        return $this->tenantSlug;
    }

    public function clear(): void
    {
        $this->tenantId = null;
        $this->tenantSlug = null;
    }
}
