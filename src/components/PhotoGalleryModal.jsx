import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { sanitizeExternalUrl, sanitizeMediaUrl } from '../utils/sanitize'

const normalizeItems = (items = []) => (
  Array.isArray(items)
    ? items.map((item) => String(item || '').trim()).filter(Boolean)
    : []
)

const resolveDrivePreviewUrl = (value = '') => {
  const raw = sanitizeMediaUrl(String(value || '').trim())
  if (!raw) return ''

  try {
    const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    const host = url.hostname.toLowerCase()
    if (host !== 'drive.google.com' && host !== 'docs.google.com') return ''

    const fileId = url.pathname.match(/\/file\/d\/([^/]+)/i)?.[1] || url.searchParams.get('id') || ''
    if (!fileId) return ''

    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
  } catch {
    return ''
  }
}

export default function PhotoGalleryModal({ items = [], initialIndex = 0, title = 'Galeri Foto', onClose }) {
  const files = useMemo(() => normalizeItems(items), [items])
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, files.length - 1)))
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const touchStartRef = useRef(null)
  const dragRef = useRef(null)
  const viewerRef = useRef(null)
  const zoomRef = useRef(1)

  useEffect(() => {
    setIndex(Math.max(0, Math.min(initialIndex, files.length - 1)))
  }, [files.length, initialIndex])

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [index])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  const current = files[index] || ''
  const drivePreviewUrl = resolveDrivePreviewUrl(current)
  const mediaUrl = sanitizeMediaUrl(current)
  const openUrl = sanitizeExternalUrl(current) || mediaUrl
  const canMove = files.length > 1

  const go = (delta) => {
    if (!files.length) return
    setIndex((prev) => (prev + delta + files.length) % files.length)
  }

  const updateZoom = (nextZoom) => {
    const value = Math.max(1, Math.min(4, Number(nextZoom) || 1))
    setZoom(value)
    if (value === 1) setPan({ x: 0, y: 0 })
  }

  useEffect(() => {
    const node = viewerRef.current
    if (!node || drivePreviewUrl) return undefined

    const onWheel = (event) => {
      event.preventDefault()
      const currentZoom = zoomRef.current
      updateZoom(currentZoom + (event.deltaY < 0 ? 0.15 : -0.15))
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivePreviewUrl, index])

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'ArrowLeft') go(-1)
      if (event.key === 'ArrowRight') go(1)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length, onClose])

  if (!files.length) return null

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/90 text-white">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Tutup galeri"
        onClick={onClose}
      />

      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{title}</div>
            <div className="text-xs text-white/70">
              {index + 1} dari {files.length}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!drivePreviewUrl && (
              <div className="hidden items-center gap-1 rounded-full border border-white/15 bg-white/10 p-1 sm:flex">
                <button
                  type="button"
                  onClick={() => updateZoom(zoom - 0.25)}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/15"
                  title="Perkecil"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-12 text-center text-xs font-bold">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => updateZoom(zoom + 0.25)}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/15"
                  title="Perbesar"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={resetView}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/15"
                  title="Reset zoom"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            )}
            {openUrl && (
              <a
                href={openUrl}
                target="_blank"
                rel="noreferrer"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
                title="Buka file"
              >
                <ExternalLink className="h-5 w-5" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
              title="Tutup"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div
          ref={viewerRef}
          className="relative min-h-0 flex-1"
          onPointerDown={(event) => {
            if (drivePreviewUrl || zoom <= 1) return
            event.currentTarget.setPointerCapture?.(event.pointerId)
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              panX: pan.x,
              panY: pan.y
            }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId || zoom <= 1) return
            setPan({
              x: drag.panX + event.clientX - drag.startX,
              y: drag.panY + event.clientY - drag.startY
            })
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
          }}
          onPointerCancel={() => {
            dragRef.current = null
          }}
          onTouchStart={(event) => {
            if (zoom > 1) return
            touchStartRef.current = event.changedTouches?.[0]?.clientX ?? null
          }}
          onTouchEnd={(event) => {
            if (zoom > 1) return
            const start = touchStartRef.current
            touchStartRef.current = null
            if (start == null) return
            const end = event.changedTouches?.[0]?.clientX ?? start
            const delta = end - start
            if (Math.abs(delta) < 45) return
            go(delta > 0 ? -1 : 1)
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center px-3 py-4 sm:px-16">
            {drivePreviewUrl ? (
              <iframe
                src={drivePreviewUrl}
                title={`${title} ${index + 1}`}
                className="h-full max-h-full w-full max-w-6xl rounded-xl border border-white/15 bg-white"
                allow="autoplay"
              />
            ) : (
              <img
                src={mediaUrl}
                alt={`${title} ${index + 1}`}
                className={`max-h-full max-w-full select-none rounded-xl object-contain transition-transform duration-75 ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
                draggable={false}
                onClick={() => updateZoom(zoom > 1 ? 1 : 2)}
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                  transformOrigin: 'center center'
                }}
              />
            )}
          </div>

          {canMove && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-white/10 hover:bg-white/20 sm:left-5"
                title="Foto sebelumnya"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-white/10 hover:bg-white/20 sm:right-5"
                title="Foto berikutnya"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
        </div>

        {canMove && (
          <div className="flex justify-center gap-2 border-t border-white/10 px-4 py-3">
            {files.map((item, itemIndex) => (
              <button
                key={`${item}-${itemIndex}`}
                type="button"
                onClick={() => setIndex(itemIndex)}
                className={`h-2.5 rounded-full transition-all ${
                  itemIndex === index ? 'w-8 bg-white' : 'w-2.5 bg-white/35 hover:bg-white/60'
                }`}
                aria-label={`Buka foto ${itemIndex + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
