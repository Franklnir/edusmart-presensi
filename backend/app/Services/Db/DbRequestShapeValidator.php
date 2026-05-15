<?php

namespace App\Services\Db;

use Illuminate\Http\Request;

class DbRequestShapeValidator
{
    private const MAX_DB_FILTER_FIELDS = 40;

    private const MAX_DB_ORDER_FIELDS = 8;

    private const MAX_DB_PAYLOAD_ROWS = 500;

    private const MAX_DB_STRING_VALUE_LENGTH = 20000;

    public function validate(Request $request, callable $sanitizeIdentifier, callable $isSelectableColumn): ?string
    {
        $table = (string) $request->input('table', '');
        $columns = $request->input('columns');
        if ($columns !== null && ! is_string($columns)) {
            return 'Format columns tidak valid';
        }
        if (is_string($columns) && strlen($columns) > 4000) {
            return 'Panjang columns melebihi batas';
        }

        $filters = $request->input('filters', []);
        if (! is_array($filters)) {
            return 'Format filters tidak valid';
        }

        foreach (['eq', 'neq', 'is', 'gt', 'gte', 'lt', 'lte', 'in', 'ilike'] as $op) {
            if (! isset($filters[$op])) {
                continue;
            }
            if (! is_array($filters[$op])) {
                return "Format filters.{$op} tidak valid";
            }
            if (count($filters[$op]) > self::MAX_DB_FILTER_FIELDS) {
                return "Jumlah filters.{$op} melebihi batas";
            }

            foreach ($filters[$op] as $field => $value) {
                $column = is_string($field) ? $sanitizeIdentifier($field) : null;
                if ($column === null) {
                    return 'Nama kolom filter tidak valid';
                }
                if (! $isSelectableColumn($table, $column)) {
                    return 'Kolom filter tidak diizinkan';
                }
                if (! $this->isReasonableDbValue($value, 0)) {
                    return 'Nilai filter tidak valid';
                }
            }
        }

        $order = $request->input('order', []);
        if ($order !== null && ! is_array($order)) {
            return 'Format order tidak valid';
        }
        $orderItems = is_array($order) && isset($order['field']) ? [$order] : (is_array($order) ? $order : []);
        if (count($orderItems) > self::MAX_DB_ORDER_FIELDS) {
            return 'Jumlah order melebihi batas';
        }

        foreach ($orderItems as $item) {
            if (! is_array($item)) {
                return 'Format item order tidak valid';
            }
            $field = (string) ($item['field'] ?? '');
            $column = $sanitizeIdentifier($field);
            if ($field === '' || $column === null) {
                return 'Kolom order tidak valid';
            }
            if (! $isSelectableColumn($table, $column)) {
                return 'Kolom order tidak diizinkan';
            }
        }

        $limit = $request->input('limit');
        if ($limit !== null && (! is_numeric($limit) || (int) $limit < 0)) {
            return 'Nilai limit tidak valid';
        }

        $offset = $request->input('offset');
        if ($offset !== null && (! is_numeric($offset) || (int) $offset < 0)) {
            return 'Nilai offset tidak valid';
        }

        $action = strtolower((string) $request->input('action', 'select'));
        if (in_array($action, ['insert', 'upsert'], true)) {
            $payload = $request->input('payload');
            if ($payload === null) {
                return null;
            }

            if (is_array($payload) && array_is_list($payload) && count($payload) > self::MAX_DB_PAYLOAD_ROWS) {
                return 'Jumlah payload melebihi batas';
            }

            if (! $this->isReasonableDbValue($payload, 0)) {
                return 'Payload tidak valid';
            }
        }

        if ($action === 'update') {
            $payload = $request->input('payload');
            if ($payload !== null && (! is_array($payload) || ! $this->isReasonableDbValue($payload, 0))) {
                return 'Payload update tidak valid';
            }
        }

        return null;
    }

    private function isReasonableDbValue($value, int $depth): bool
    {
        if ($depth > 4) {
            return false;
        }

        if ($value === null || is_bool($value) || is_int($value) || is_float($value)) {
            return true;
        }

        if (is_string($value)) {
            return strlen($value) <= self::MAX_DB_STRING_VALUE_LENGTH;
        }

        if (is_array($value)) {
            if (count($value) > 500) {
                return false;
            }

            foreach ($value as $key => $item) {
                if (is_string($key) && strlen($key) > 120) {
                    return false;
                }
                if (! $this->isReasonableDbValue($item, $depth + 1)) {
                    return false;
                }
            }

            return true;
        }

        return false;
    }
}
