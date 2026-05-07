<?php

if (class_exists('ZipArchive', false)) {
    return;
}

class ZipArchive
{
    public const CREATE = 1;

    public const OVERWRITE = 8;

    public const ER_OPEN = 11;

    public const ER_NOZIP = 19;

    public int $numFiles = 0;

    private string $filename = '';

    private bool $writeMode = false;

    /**
     * @var array<int, array{name: string, contents: string, size: int, crc: int}>
     */
    private array $entries = [];

    public function open(string $filename, int $flags = 0): bool|int
    {
        $this->filename = $filename;
        $this->entries = [];
        $this->numFiles = 0;
        $this->writeMode = ($flags & self::CREATE) === self::CREATE
            || ($flags & self::OVERWRITE) === self::OVERWRITE;

        if ($this->writeMode) {
            if (($flags & self::OVERWRITE) === self::OVERWRITE && is_file($filename) && ! @unlink($filename)) {
                return self::ER_OPEN;
            }

            return true;
        }

        if (! is_file($filename) || ! is_readable($filename)) {
            return self::ER_OPEN;
        }

        return $this->readArchive($filename) ? true : self::ER_NOZIP;
    }

    public function addFromString(string $name, string $contents): bool
    {
        if (! $this->writeMode) {
            return false;
        }

        $name = $this->normalizeName($name);
        if ($name === '') {
            return false;
        }

        $this->entries[] = [
            'name' => $name,
            'contents' => $contents,
            'size' => strlen($contents),
            'crc' => (int) sprintf('%u', crc32($contents)),
        ];
        $this->numFiles = count($this->entries);

        return true;
    }

    public function addEmptyDir(string $dirname): bool
    {
        $dirname = rtrim($this->normalizeName($dirname), '/').'/';

        return $this->addFromString($dirname, '');
    }

    public function statIndex(int $index, int $flags = 0): array|false
    {
        if (! isset($this->entries[$index])) {
            return false;
        }

        $entry = $this->entries[$index];

        return [
            'name' => $entry['name'],
            'size' => $entry['size'],
            'comp_size' => strlen($entry['contents']),
            'crc' => $entry['crc'],
        ];
    }

    public function getFromIndex(int $index, int $len = 0, int $flags = 0): string|false
    {
        if (! isset($this->entries[$index])) {
            return false;
        }

        $contents = $this->entries[$index]['contents'];

        return $len > 0 ? substr($contents, 0, $len) : $contents;
    }

    public function getFromName(string $name, int $len = 0, int $flags = 0): string|false
    {
        $name = $this->normalizeName($name);
        foreach ($this->entries as $index => $entry) {
            if ($entry['name'] === $name) {
                return $this->getFromIndex($index, $len, $flags);
            }
        }

        return false;
    }

    public function extractTo(string $destination, array|string|null $entries = null): bool
    {
        $wanted = null;
        if (is_string($entries)) {
            $wanted = [$this->normalizeName($entries) => true];
        } elseif (is_array($entries)) {
            $wanted = array_fill_keys(array_map([$this, 'normalizeName'], $entries), true);
        }

        foreach ($this->entries as $entry) {
            if ($wanted !== null && ! isset($wanted[$entry['name']])) {
                continue;
            }

            $target = rtrim($destination, '/\\').DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $entry['name']);
            if (str_ends_with($entry['name'], '/')) {
                if (! is_dir($target) && ! mkdir($target, 0775, true) && ! is_dir($target)) {
                    return false;
                }

                continue;
            }

            $directory = dirname($target);
            if (! is_dir($directory) && ! mkdir($directory, 0775, true) && ! is_dir($directory)) {
                return false;
            }
            if (file_put_contents($target, $entry['contents']) === false) {
                return false;
            }
        }

        return true;
    }

    public function close(): bool
    {
        if (! $this->writeMode) {
            return true;
        }

        return $this->writeArchive($this->filename);
    }

    private function readArchive(string $filename): bool
    {
        $data = file_get_contents($filename);
        if (! is_string($data) || $data === '') {
            return false;
        }

        $eocdOffset = strrpos($data, "\x50\x4b\x05\x06");
        if ($eocdOffset === false || $eocdOffset + 22 > strlen($data)) {
            return false;
        }

        $entryCount = $this->u16($data, $eocdOffset + 10);
        $centralOffset = $this->u32($data, $eocdOffset + 16);
        $offset = $centralOffset;
        $entries = [];

        for ($i = 0; $i < $entryCount; $i++) {
            if ($offset + 46 > strlen($data) || substr($data, $offset, 4) !== "\x50\x4b\x01\x02") {
                return false;
            }

            $method = $this->u16($data, $offset + 10);
            $crc = $this->u32($data, $offset + 16);
            $compressedSize = $this->u32($data, $offset + 20);
            $size = $this->u32($data, $offset + 24);
            $nameLength = $this->u16($data, $offset + 28);
            $extraLength = $this->u16($data, $offset + 30);
            $commentLength = $this->u16($data, $offset + 32);
            $localOffset = $this->u32($data, $offset + 42);
            $name = substr($data, $offset + 46, $nameLength);
            $normalizedName = $this->normalizeName($name);
            if ($normalizedName === '') {
                return false;
            }

            if ($localOffset + 30 > strlen($data) || substr($data, $localOffset, 4) !== "\x50\x4b\x03\x04") {
                return false;
            }

            $localNameLength = $this->u16($data, $localOffset + 26);
            $localExtraLength = $this->u16($data, $localOffset + 28);
            $dataOffset = $localOffset + 30 + $localNameLength + $localExtraLength;
            $compressed = substr($data, $dataOffset, $compressedSize);

            if ($method === 0) {
                $contents = $compressed;
            } elseif ($method === 8) {
                $inflated = @gzinflate($compressed);
                if (! is_string($inflated)) {
                    return false;
                }
                $contents = $inflated;
            } else {
                return false;
            }

            $entries[] = [
                'name' => $normalizedName,
                'contents' => $contents,
                'size' => $size,
                'crc' => $crc,
            ];

            $offset += 46 + $nameLength + $extraLength + $commentLength;
        }

        $this->entries = $entries;
        $this->numFiles = count($entries);

        return true;
    }

    private function writeArchive(string $filename): bool
    {
        $directory = dirname($filename);
        if (! is_dir($directory) && ! mkdir($directory, 0775, true) && ! is_dir($directory)) {
            return false;
        }

        $local = '';
        $central = '';
        $offset = 0;
        [$dosTime, $dosDate] = $this->dosDateTime();

        foreach ($this->entries as $entry) {
            $name = $entry['name'];
            $contents = $entry['contents'];
            $size = strlen($contents);
            $crc = (int) sprintf('%u', crc32($contents));
            $nameLength = strlen($name);

            $localHeader = pack(
                'VvvvvvVVVvv',
                0x04034b50,
                20,
                0,
                0,
                $dosTime,
                $dosDate,
                $crc,
                $size,
                $size,
                $nameLength,
                0
            ).$name;

            $central .= pack(
                'VvvvvvvVVVvvvvvVV',
                0x02014b50,
                20,
                20,
                0,
                0,
                $dosTime,
                $dosDate,
                $crc,
                $size,
                $size,
                $nameLength,
                0,
                0,
                0,
                0,
                str_ends_with($name, '/') ? 16 : 32,
                $offset
            ).$name;

            $local .= $localHeader.$contents;
            $offset += strlen($localHeader) + $size;
        }

        $centralOffset = strlen($local);
        $centralSize = strlen($central);
        $entryCount = count($this->entries);
        $eocd = pack(
            'VvvvvVVv',
            0x06054b50,
            0,
            0,
            $entryCount,
            $entryCount,
            $centralSize,
            $centralOffset,
            0
        );

        return file_put_contents($filename, $local.$central.$eocd) !== false;
    }

    private function normalizeName(string $name): string
    {
        return ltrim(str_replace('\\', '/', trim($name)), '/');
    }

    private function u16(string $data, int $offset): int
    {
        $value = unpack('v', substr($data, $offset, 2));

        return (int) ($value[1] ?? 0);
    }

    private function u32(string $data, int $offset): int
    {
        $value = unpack('V', substr($data, $offset, 4));

        return (int) ($value[1] ?? 0);
    }

    private function dosDateTime(): array
    {
        $now = getdate();
        $time = ((int) $now['hours'] << 11) | ((int) $now['minutes'] << 5) | ((int) ($now['seconds'] / 2));
        $date = (((int) $now['year'] - 1980) << 9) | ((int) $now['mon'] << 5) | (int) $now['mday'];

        return [$time, $date];
    }
}
