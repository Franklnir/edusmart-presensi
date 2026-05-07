// src/utils/sanitize.js
// Defense-in-depth: sanitize user input sebelum dikirim ke server

/**
 * Strip HTML tags dan trim whitespace dari teks input.
 * Mencegah stored XSS jika backend tidak meng-escape HTML.
 */
export const sanitizeText = (input) => {
    if (input === null || input === undefined) return ''
    const text = String(input)
    // Strip semua HTML tags
    const stripped = text.replace(/<[^>]*>/g, '')
    // Normalize whitespace berlebihan
    return stripped.replace(/\s+/g, ' ').trim()
}

/**
 * Validasi URL — hanya izinkan http:// dan https://.
 * Mencegah javascript: URI, data: URI, vbscript:, dan protocol berbahaya lainnya.
 */
export const sanitizeUrl = (url) => {
    if (!url || typeof url !== 'string') return ''
    const trimmed = url.trim()
    if (!trimmed) return ''

    // Hanya izinkan http dan https
    try {
        const parsed = new URL(trimmed)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return ''
        }
        return parsed.toString()
    } catch {
        // Jika bukan URL absolut, cek apakah relative path (aman)
        if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
            return trimmed
        }
        return ''
    }
}

/**
 * Sanitasi URL untuk media preview.
 * Mengizinkan:
 * - http/https
 * - relative path
 * - blob:
 * - data:image/* dan data:application/pdf
 */
export const sanitizeMediaUrl = (url) => {
    if (!url || typeof url !== 'string') return ''
    const trimmed = url.trim()
    if (!trimmed) return ''

    if (/^blob:/i.test(trimmed)) return trimmed
    if (/^data:image\//i.test(trimmed)) return trimmed
    if (/^data:application\/pdf/i.test(trimmed)) return trimmed

    return sanitizeUrl(trimmed)
}

/**
 * Validasi URL eksternal.
 * Dipakai untuk href target _blank agar tidak menerima javascript:, data:, file:, dll.
 */
export const sanitizeExternalUrl = (url) => {
    const normalized = sanitizeUrl(url)
    if (!normalized) return ''
    if (normalized.startsWith('/')) return ''
    return normalized
}

/**
 * Sanitize nama file — hapus karakter berbahaya.
 * Mencegah path traversal (../) dan karakter shell injection.
 */
export const sanitizeFileName = (name) => {
    if (!name || typeof name !== 'string') return 'file'
    return String(name)
        .replace(/\.\./g, '')           // Hapus path traversal
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Hapus karakter file system berbahaya
        .replace(/\s+/g, '_')            // Spasi → underscore
        .slice(0, 200)                   // Batas panjang
        .trim() || 'file'
}

/**
 * Sanitize input untuk field yang bisa masuk ke query/database.
 * Menghapus karakter kontrol dan zero-width characters.
 */
export const sanitizeInput = (input) => {
    if (input === null || input === undefined) return ''
    return String(input)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // kontrol chars
        .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')         // zero-width chars
        .trim()
}
