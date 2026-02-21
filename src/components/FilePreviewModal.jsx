import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { sanitizeExternalUrl, sanitizeMediaUrl } from '../utils/sanitize'

const MIN_SCALE = 0.2
const MAX_SCALE = 4
const STEP = 0.2

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function isHttpUrl(v = '') {
  return /^https?:\/\//i.test(String(v || ''))
}

function resolveUrl(value) {
  if (!value) return null
  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost'
    const rawInput = String(value || '').trim()
    const normalizedInput = /^(drive\.google\.com|docs\.google\.com|youtu\.be|(?:www\.)?youtube\.com)\//i.test(rawInput)
      ? `https://${rawInput}`
      : rawInput
    const safeValue = sanitizeMediaUrl(normalizedInput)
    if (!safeValue) return null
    const normalized = /^(drive\.google\.com|docs\.google\.com|youtu\.be|(?:www\.)?youtube\.com)\//i.test(safeValue)
      ? `https://${safeValue}`
      : safeValue
    return new URL(normalized, base)
  } catch {
    return null
  }
}

function getSafeExtension(url) {
  if (!url) return ''
  try {
    // Support absolute URL dan relative URL (/api/storage/object?...).
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost'
    const u = new URL(url, base)
    const queryPath = u.searchParams.get('path') || ''
    const path = queryPath || u.pathname || ''
    const clean = path.split('?')[0].split('#')[0]
    const ext = clean.split('.').pop()?.toLowerCase() || ''
    return ext
  } catch {
    // bukan URL valid, treat sebagai path biasa (dan coba baca query ?path=)
    const raw = String(url || '')
    const pathMatch = raw.match(/[?&]path=([^&]+)/i)
    const decodedPath = pathMatch?.[1] ? decodeURIComponent(pathMatch[1]) : raw
    const clean = decodedPath.split('?')[0].split('#')[0]
    const ext = clean.split('.').pop()?.toLowerCase() || ''
    return ext
  }
}

function parseYouTubeStartToSeconds(raw) {
  if (!raw) return 0
  const input = String(raw).trim()
  if (!input) return 0
  if (/^\d+$/.test(input)) return Number.parseInt(input, 10) || 0

  const match = input.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i)
  if (!match) return 0
  const h = Number.parseInt(match[1] || '0', 10) || 0
  const m = Number.parseInt(match[2] || '0', 10) || 0
  const s = Number.parseInt(match[3] || '0', 10) || 0
  return h * 3600 + m * 60 + s
}

function getYouTubeEmbedUrl(url) {
  const resolved = resolveUrl(url)
  if (!resolved) return ''
  const host = resolved.hostname.toLowerCase()

  let videoId = ''
  if (host === 'youtu.be') {
    videoId = resolved.pathname.split('/').filter(Boolean)[0] || ''
  } else if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
    const parts = resolved.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') videoId = resolved.searchParams.get('v') || ''
    if (!videoId && parts[0] === 'embed') videoId = parts[1] || ''
    if (!videoId && parts[0] === 'shorts') videoId = parts[1] || ''
    if (!videoId && parts[0] === 'live') videoId = parts[1] || ''
  }

  if (!videoId) return ''

  const start =
    parseYouTubeStartToSeconds(resolved.searchParams.get('t')) ||
    parseYouTubeStartToSeconds(resolved.searchParams.get('start'))
  const startQuery = start > 0 ? `&start=${start}` : ''

  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1${startQuery}`
}

function getGoogleDriveEmbedUrl(url) {
  const resolved = resolveUrl(url)
  if (!resolved) return ''
  const host = resolved.hostname.toLowerCase()
  const parts = resolved.pathname.split('/').filter(Boolean)

  if (host === 'drive.google.com') {
    const byPath = resolved.pathname.match(/\/file\/d\/([^/]+)/i)?.[1] || ''
    const byParam = resolved.searchParams.get('id') || ''
    const fileId = byPath || byParam
    if (!fileId) return ''
    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
  }

  if (host === 'docs.google.com') {
    const docType = parts[0] || ''
    const dIndex = parts.indexOf('d')
    const fileId = dIndex >= 0 ? parts[dIndex + 1] || '' : ''
    if (!fileId) return ''

    if (['document', 'spreadsheets', 'presentation'].includes(docType)) {
      return `https://docs.google.com/${docType}/d/${encodeURIComponent(fileId)}/preview`
    }
  }

  return ''
}

function getGoogleDocsViewerUrl(url) {
  const resolved = resolveUrl(url)
  if (!resolved || !isHttpUrl(resolved.toString())) return ''
  return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(resolved.toString())}`
}

function detectFileType(fileUrl) {
  if (getYouTubeEmbedUrl(fileUrl)) return 'youtube'
  if (getGoogleDriveEmbedUrl(fileUrl)) return 'drive'

  const ext = getSafeExtension(fileUrl)
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['mp4', 'webm', 'ogg', 'mov', 'mkv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio'
  if (['doc', 'docx'].includes(ext)) return 'document'
  if (['xls', 'xlsx'].includes(ext)) return 'spreadsheet'
  if (['ppt', 'pptx'].includes(ext)) return 'presentation'
  return 'unknown'
}

const FilePreviewModal = ({ fileUrl, onClose }) => {
  const containerRef = useRef(null)
  const imageRef = useRef(null)

  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const posStartRef = useRef({ x: 0, y: 0 })

  const previewSource = useMemo(() => {
    const resolved = resolveUrl(fileUrl)
    const sourceUrl = resolved ? resolved.toString() : sanitizeMediaUrl(String(fileUrl || ''))
    const detectedType = detectFileType(sourceUrl)

    if (detectedType === 'youtube') {
      return {
        type: 'youtube',
        sourceUrl,
        previewUrl: getYouTubeEmbedUrl(sourceUrl),
        canDownload: false
      }
    }

    if (detectedType === 'drive') {
      return {
        type: 'drive',
        sourceUrl,
        previewUrl: getGoogleDriveEmbedUrl(sourceUrl),
        canDownload: true
      }
    }

    if (['document', 'spreadsheet', 'presentation'].includes(detectedType)) {
      return {
        type: detectedType,
        sourceUrl,
        previewUrl: getGoogleDocsViewerUrl(sourceUrl) || sourceUrl,
        canDownload: true
      }
    }

    return {
      type: detectedType,
      sourceUrl,
      previewUrl: sourceUrl,
      canDownload: true
    }
  }, [fileUrl])

  const fileType = previewSource.type
  const openUrl = useMemo(() => sanitizeExternalUrl(previewSource.sourceUrl) || sanitizeMediaUrl(previewSource.sourceUrl), [previewSource.sourceUrl])
  const downloadUrl = useMemo(() => sanitizeMediaUrl(previewSource.sourceUrl), [previewSource.sourceUrl])

  // reset saat file berganti
  useEffect(() => {
    setScale(1)
    setPos({ x: 0, y: 0 })
    setDragging(false)
  }, [fileUrl])

  // ESC untuk close
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const clampPosition = useCallback(
    (x, y, nextScale = scale) => {
      const container = containerRef.current
      const img = imageRef.current
      if (!container || !img) return { x, y }

      // ukuran container
      const cw = container.clientWidth
      const ch = container.clientHeight

      // ukuran gambar yang sudah dirender (termasuk scale) lalu kita normalisasi
      const rect = img.getBoundingClientRect()
      const baseW = rect.width / (nextScale || 1)
      const baseH = rect.height / (nextScale || 1)

      // kalau gambar masih muat di container, kunci posisi ke tengah
      const scaledW = baseW * nextScale
      const scaledH = baseH * nextScale

      const maxX = Math.max(0, (scaledW - cw) / 2)
      const maxY = Math.max(0, (scaledH - ch) / 2)

      return {
        x: clamp(x, -maxX, maxX),
        y: clamp(y, -maxY, maxY)
      }
    },
    [scale]
  )

  const resetZoom = () => {
    setScale(1)
    setPos({ x: 0, y: 0 })
  }

  const zoomTo = useCallback(
    (nextScale, originClientX, originClientY) => {
      const container = containerRef.current
      if (!container) {
        setScale(nextScale)
        return
      }

      const rect = container.getBoundingClientRect()
      const cx = originClientX - rect.left
      const cy = originClientY - rect.top

      // transform: translate(tx,ty) scale(s)
      // want: point under cursor stays fixed
      const s = scale
      const tx = pos.x
      const ty = pos.y
      const ns = nextScale

      // new translation
      const ntx = cx - ((cx - tx) * ns) / s
      const nty = cy - ((cy - ty) * ns) / s

      const clamped = clampPosition(ntx, nty, ns)
      setScale(ns)
      setPos(clamped)
    },
    [scale, pos.x, pos.y, clampPosition]
  )

  const zoomIn = () => {
    const ns = clamp(scale + STEP, MIN_SCALE, MAX_SCALE)
    // zoom ke tengah container biar stabil
    const c = containerRef.current?.getBoundingClientRect()
    if (c) zoomTo(ns, c.left + c.width / 2, c.top + c.height / 2)
    else setScale(ns)
  }

  const zoomOut = () => {
    const ns = clamp(scale - STEP, MIN_SCALE, MAX_SCALE)
    const c = containerRef.current?.getBoundingClientRect()
    if (c) zoomTo(ns, c.left + c.width / 2, c.top + c.height / 2)
    else setScale(ns)
  }

  const handleWheel = (e) => {
    if (fileType !== 'image') return
    e.preventDefault()

    const delta = e.deltaY > 0 ? -STEP : STEP
    const ns = clamp(scale + delta, MIN_SCALE, MAX_SCALE)

    if (ns === 1) {
      setScale(1)
      setPos({ x: 0, y: 0 })
      return
    }

    zoomTo(ns, e.clientX, e.clientY)
  }

  const onPointerDown = (e) => {
    if (fileType !== 'image') return
    if (scale <= 1) return

    setDragging(true)
    containerRef.current?.setPointerCapture?.(e.pointerId)

    dragStartRef.current = { x: e.clientX, y: e.clientY }
    posStartRef.current = { ...pos }
  }

  const onPointerMove = (e) => {
    if (!dragging) return
    if (scale <= 1) return

    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y

    const nx = posStartRef.current.x + dx
    const ny = posStartRef.current.y + dy

    const clamped = clampPosition(nx, ny, scale)
    setPos(clamped)
  }

  const onPointerUp = (e) => {
    if (!dragging) return
    setDragging(false)
    try {
      containerRef.current?.releasePointerCapture?.(e.pointerId)
    } catch {
      // ignore
    }
  }

  const renderPreview = () => {
    switch (fileType) {
      case 'image':
        return (
          <div
            ref={containerRef}
            className="flex justify-center items-center h-full overflow-hidden select-none"
            onWheel={handleWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ touchAction: 'none', cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
          >
            <img
              ref={imageRef}
              src={previewSource.sourceUrl}
              alt="Preview"
              className="max-w-full max-h-full object-contain will-change-transform"
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                transformOrigin: 'center center',
                transition: dragging ? 'none' : 'transform 120ms ease-out'
              }}
              onLoad={() => {
                // saat load, rapikan posisi agar tidak "nyangkut" clamp
                setPos((p) => clampPosition(p.x, p.y, scale))
              }}
              onError={(e) => {
                e.currentTarget.onerror = null
                e.currentTarget.src =
                  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMyMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIxODAiIGZpbGw9IiNGM0Y0RjYiLz48cGF0aCBkPSJNODAgMTEwTDE2MCA2MEwyNDAgMTEwIiBzdHJva2U9IiM5Q0EwQkYiIHN0cm9rZS13aWR0aD0iNiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PHRleHQgeD0iMTYwIiB5PSIxNTAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM2QjcyODAiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtZmFtaWx5PSJBcmlhbCI+R2FnYWwgbG9hZCBpbWFnZTwvdGV4dD48L3N2Zz4='
              }}
            />
          </div>
        )

      case 'pdf':
        return (
          <div ref={containerRef} className="w-full h-full bg-white">
            <iframe src={previewSource.previewUrl} className="w-full h-full border-0" title="PDF Preview" />
          </div>
        )

      case 'video':
        return (
          <div className="w-full h-full bg-black flex items-center justify-center p-4">
            <video
              src={previewSource.sourceUrl}
              controls
              className="max-w-full max-h-full rounded-lg bg-black"
              preload="metadata"
            />
          </div>
        )

      case 'audio':
        return (
          <div className="w-full h-full bg-slate-900 flex items-center justify-center p-4">
            <audio src={previewSource.sourceUrl} controls className="w-full max-w-xl" preload="metadata" />
          </div>
        )

      case 'youtube':
        return (
          <div className="w-full h-full bg-black">
            <iframe
              src={previewSource.previewUrl}
              className="w-full h-full border-0"
              title="YouTube Preview"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        )

      case 'drive':
      case 'document':
      case 'spreadsheet':
      case 'presentation':
        return (
          <div className="w-full h-full bg-white">
            <iframe
              src={previewSource.previewUrl}
              className="w-full h-full border-0"
              title="Document Preview"
              allowFullScreen
            />
          </div>
        )

      default:
        return (
          <div className="w-full h-full bg-slate-900 flex flex-col">
            <div className="px-4 py-2 text-xs text-slate-300 border-b border-slate-700">
              Mencoba menampilkan file di dalam overlay...
            </div>
            <div className="flex-1">
              <iframe src={previewSource.previewUrl} className="w-full h-full border-0 bg-white" title="File Preview" />
            </div>
            <div className="px-4 py-3 border-t border-slate-700 bg-slate-900 text-slate-200 text-sm flex items-center justify-between">
              <span>Jika tidak tampil, unduh file.</span>
              <a
                href={downloadUrl || '#'}
                download
                onClick={(e) => { if (!downloadUrl) e.preventDefault() }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
              >
                Download File
              </a>
            </div>
          </div>
        )
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => onClose?.()}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-6xl h-full max-h-[95vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-200 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-slate-800">Preview File</h3>

            {fileType === 'image' && (
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
                <button
                  onClick={zoomOut}
                  className="w-8 h-8 flex items-center justify-center bg-white rounded-md shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
                  disabled={scale <= MIN_SCALE}
                  type="button"
                >
                  <span className="text-lg font-bold">−</span>
                </button>

                <span className="text-sm font-medium text-slate-700 min-w-12 text-center">
                  {Math.round(scale * 100)}%
                </span>

                <button
                  onClick={zoomIn}
                  className="w-8 h-8 flex items-center justify-center bg-white rounded-md shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
                  disabled={scale >= MAX_SCALE}
                  type="button"
                >
                  <span className="text-lg font-bold">+</span>
                </button>

                {scale !== 1 && (
                  <button
                    onClick={resetZoom}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm font-semibold hover:bg-blue-200 transition-colors ml-2"
                    type="button"
                  >
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => onClose?.()}
            className="w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-slate-600 font-bold"
            type="button"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden bg-slate-900">{renderPreview()}</div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-slate-200 bg-white rounded-b-2xl">
          <div className="text-sm text-slate-600">
            {fileType === 'image' && 'Scroll untuk zoom • Drag untuk geser • ESC untuk tutup'}
            {fileType === 'youtube' && 'Mode video YouTube • ESC untuk tutup'}
            {fileType === 'drive' && 'Preview Google Drive • ESC untuk tutup'}
          </div>

          <div className="flex gap-3">
            <a
              href={openUrl || '#'}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => { if (!openUrl) e.preventDefault() }}
              className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-semibold"
            >
              Buka Tab Baru
            </a>

            {previewSource.canDownload && (
              <a
                href={downloadUrl || '#'}
                download
                onClick={(e) => { if (!downloadUrl) e.preventDefault() }}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-semibold"
              >
                Download
              </a>
            )}

            <button
              onClick={() => onClose?.()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
              type="button"
            >
              Tutup Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FilePreviewModal
