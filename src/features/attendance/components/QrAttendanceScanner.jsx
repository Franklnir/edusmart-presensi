import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, Loader2, QrCode, ScanLine, XCircle } from 'lucide-react'
import { extractQrToken } from '../utils/qrToken'

const loadJsQrDecoder = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Scanner QR hanya tersedia di browser.'))
  }
  if (typeof window.jsQR === 'function') {
    return Promise.resolve(window.jsQR)
  }
  return import('jsqr').then((mod) => mod.default || mod)
}

export const QrSuccessOverlay = ({ data, onClose }) => {
  if (!data) return null

  const detailRows = [
    ['Nama', data.nama],
    ['Mata Pelajaran', data.mapel],
    ['Guru', data.guru],
    ['Jam Absensi', data.jam_absensi],
    ['Hari', data.hari],
    ['Tanggal', data.tanggal],
    ['Bulan', data.bulan],
    ['Tahun', data.tahun]
  ]

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/55 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-emerald-100 shadow-2xl overflow-hidden animate-[qr-success-pop_220ms_ease-out]">
        <div className="px-6 pt-7 pb-5 text-center bg-gradient-to-b from-emerald-50 to-white">
          <div className="mx-auto h-20 w-20 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center animate-[qr-check-pulse_900ms_ease-out]">
            <CheckCircle2 className="h-12 w-12" strokeWidth={2.4} />
          </div>
          <h2 className="mt-4 text-xl font-bold text-slate-900">Absensi Berhasil</h2>
          <p className="mt-1 text-sm text-slate-600">Kehadiran kamu sudah tercatat.</p>
        </div>

        <div className="px-6 pb-5 space-y-2">
          {detailRows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
              <span className="text-sm font-bold text-slate-900 text-right">{value || '-'}</span>
            </div>
          ))}
        </div>

        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 transition-colors"
          >
            Selesai
          </button>
        </div>
      </div>
      <style>{`
        @keyframes qr-success-pop {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes qr-check-pulse {
          0% { transform: scale(0.72); opacity: 0; }
          55% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

export const QrScannerPanel = ({ onSubmitToken, isSubmitting, lastError }) => {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(0)
  const zoomRef = useRef(1)
  const processingRef = useRef(false)
  const [cameraState, setCameraState] = useState('idle')
  const [cameraError, setCameraError] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [zoomValue, setZoomValue] = useState(1)
  const [zoomRange, setZoomRange] = useState({ min: 1, max: 3, step: 0.1 })
  const [supportsHardwareZoom, setSupportsHardwareZoom] = useState(false)

  const applyCameraZoom = useCallback(async (nextZoom) => {
    const normalized = Math.min(
      zoomRange.max,
      Math.max(zoomRange.min, Number(nextZoom) || 1)
    )
    zoomRef.current = normalized
    setZoomValue(normalized)

    const track = streamRef.current?.getVideoTracks?.()?.[0]
    if (!track || !supportsHardwareZoom) return

    try {
      await track.applyConstraints({
        advanced: [{ zoom: normalized }]
      })
    } catch {
      setSupportsHardwareZoom(false)
    }
  }, [supportsHardwareZoom, zoomRange.max, zoomRange.min])

  const handleZoomChange = useCallback((event) => {
    void applyCameraZoom(event.target.value)
  }, [applyCameraZoom])

  const stopCamera = useCallback((updateState = true) => {
    try {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current)
      }
      streamRef.current?.getTracks?.().forEach((track) => track.stop())
    } catch {
      // ignore camera stop errors
    }
    frameRef.current = 0
    streamRef.current = null
    zoomRef.current = 1
    setZoomValue(1)
    setSupportsHardwareZoom(false)
    setZoomRange({ min: 1, max: 3, step: 0.1 })
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    if (updateState) {
      setCameraState((prev) => (prev === 'active' || prev === 'starting' ? 'idle' : prev))
    }
  }, [])

  const submitDecodedValue = useCallback(
    async (value) => {
      if (processingRef.current) return
      const token = extractQrToken(value)
      if (!token) {
        setCameraError('QR tidak berisi token absensi yang valid.')
        return
      }

      processingRef.current = true
      stopCamera()
      await onSubmitToken(token)
      window.setTimeout(() => {
        processingRef.current = false
      }, 1200)
    },
    [onSubmitToken, stopCamera]
  )

  const scanFrame = useCallback(
    async (scanner) => {
      if (processingRef.current) return
      const video = videoRef.current
      if (!video) return

      try {
        if (video.readyState >= 2) {
          let rawValue = ''

          if (scanner?.type === 'native') {
            const codes = await scanner.detector.detect(video)
            rawValue = codes?.[0]?.rawValue || ''
          } else if (scanner?.type === 'jsqr') {
            const canvas = canvasRef.current
            const width = video.videoWidth || 0
            const height = video.videoHeight || 0
            if (canvas && width > 0 && height > 0) {
              const targetWidth = Math.min(640, width)
              const zoom = Math.max(1, Number(zoomRef.current) || 1)
              const cropWidth = Math.max(1, Math.round(width / zoom))
              const cropHeight = Math.max(1, Math.round(height / zoom))
              const cropX = Math.max(0, Math.round((width - cropWidth) / 2))
              const cropY = Math.max(0, Math.round((height - cropHeight) / 2))
              const targetHeight = Math.max(1, Math.round((cropHeight / cropWidth) * targetWidth))
              canvas.width = targetWidth
              canvas.height = targetHeight
              const context = canvas.getContext('2d', { willReadFrequently: true })
              context.drawImage(
                video,
                cropX,
                cropY,
                cropWidth,
                cropHeight,
                0,
                0,
                targetWidth,
                targetHeight
              )
              const imageData = context.getImageData(0, 0, targetWidth, targetHeight)
              const result = scanner.decode(imageData.data, targetWidth, targetHeight, {
                inversionAttempts: 'attemptBoth'
              })
              rawValue = result?.data || ''
            }
          }

          if (rawValue) {
            await submitDecodedValue(rawValue)
            return
          }
        }
      } catch {
        // frame tertentu bisa gagal diproses; lanjutkan scan frame berikutnya
      }

      frameRef.current = window.requestAnimationFrame(() => {
        void scanFrame(scanner)
      })
    },
    [submitDecodedValue]
  )

  const startCamera = useCallback(async () => {
    if (cameraState === 'starting' || cameraState === 'active') return
    setCameraError('')
    setCameraState('starting')

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Akses kamera tidak tersedia di browser ini. Buka lewat HTTPS/localhost, Chrome/Edge terbaru, atau tempel kode QR secara manual.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }
        },
        audio: false
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      const videoTrack = stream.getVideoTracks?.()?.[0]
      const capabilities = videoTrack?.getCapabilities?.() || {}
      const zoomCapability = capabilities?.zoom
      let hasHardwareZoom = false
      if (
        videoTrack &&
        zoomCapability &&
        Number.isFinite(Number(zoomCapability.max)) &&
        Number(zoomCapability.max) > 1
      ) {
        const min = Math.max(1, Number(zoomCapability.min) || 1)
        const max = Math.min(6, Math.max(min, Number(zoomCapability.max) || 3))
        const step = Number(zoomCapability.step) > 0 ? Number(zoomCapability.step) : 0.1
        setZoomRange({ min, max, step })
        setSupportsHardwareZoom(true)
        zoomRef.current = min
        setZoomValue(min)
        hasHardwareZoom = true
      } else {
        setZoomRange({ min: 1, max: 3, step: 0.1 })
        setSupportsHardwareZoom(false)
        zoomRef.current = 1
        setZoomValue(1)
      }

      let scanner = null
      if (typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function') {
        try {
          if (hasHardwareZoom) {
            scanner = {
              type: 'native',
              detector: new window.BarcodeDetector({ formats: ['qr_code'] })
            }
          }
        } catch {
          scanner = null
        }
      }

      if (!scanner) {
        const jsQR = await loadJsQrDecoder()
        scanner = {
          type: 'jsqr',
          decode: jsQR
        }
      }

      setCameraState('active')
      frameRef.current = window.requestAnimationFrame(() => {
        void scanFrame(scanner)
      })
    } catch (err) {
      try {
        streamRef.current?.getTracks?.().forEach((track) => track.stop())
      } catch {
        // ignore cleanup errors
      }
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      setCameraState('error')
      setCameraError(
        err?.message ||
        'Tidak bisa membuka kamera. Pastikan izin kamera aktif, akses lewat HTTPS, lalu coba lagi atau tempel kode QR.'
      )
    }
  }, [cameraState, scanFrame])

  useEffect(() => () => stopCamera(false), [stopCamera])

  const handleManualSubmit = async (event) => {
    event.preventDefault()
    await submitDecodedValue(manualToken)
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr),minmax(320px,0.8fr)] gap-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden shadow-sm">
        <div className="relative aspect-[4/3] bg-slate-950">
          <video
            ref={videoRef}
            className="h-full w-full object-cover transition-transform duration-150"
            style={{
              transform: supportsHardwareZoom ? 'none' : `scale(${zoomValue})`
            }}
            muted
            playsInline
          />
          <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
          {cameraState !== 'active' && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950">
              <div className="text-center px-6">
                <div className="mx-auto h-16 w-16 rounded-2xl bg-white/10 text-white grid place-items-center mb-4">
                  <ScanLine className="h-9 w-9" />
                </div>
                <div className="text-white font-bold">Kamera scanner QR</div>
                <div className="text-slate-300 text-sm mt-1">Arahkan kamera ke QR yang tampil di layar guru.</div>
              </div>
            </div>
          )}
          {cameraState === 'active' && (
            <div className="absolute inset-0 pointer-events-none grid place-items-center">
              <div
                className="rounded-[30px] border-[5px] border-emerald-400 shadow-[0_0_0_9999px_rgba(2,6,23,0.34)]"
                style={{
                  width: 'min(78vw, 420px)',
                  height: 'min(78vw, 420px)',
                  maxWidth: '76%',
                  maxHeight: '82%'
                }}
              />
            </div>
          )}
        </div>

        <div className="bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={startCamera}
              disabled={isSubmitting || cameraState === 'starting' || cameraState === 'active'}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-bold text-white"
            >
              {cameraState === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {cameraState === 'starting' ? 'Membuka kamera' : 'Mulai Scan'}
            </button>
            <button
              type="button"
              onClick={() => stopCamera()}
              disabled={cameraState !== 'active'}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-bold text-slate-700"
            >
              <XCircle className="h-4 w-4" />
              Stop
            </button>
            <div className="ml-auto text-xs font-semibold text-slate-500">
              {cameraState === 'active' ? 'Scanner aktif' : 'Scanner standby'}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="qr-camera-zoom" className="text-xs font-bold uppercase tracking-wide text-slate-600">
                Zoom Kamera
              </label>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-sm">
                {zoomValue.toFixed(1)}x
              </span>
            </div>
            <input
              id="qr-camera-zoom"
              type="range"
              min={zoomRange.min}
              max={zoomRange.max}
              step={zoomRange.step}
              value={zoomValue}
              onChange={handleZoomChange}
              disabled={cameraState !== 'active'}
              className="w-full accent-emerald-500 disabled:opacity-50"
            />
            <p className="mt-2 text-[11px] text-slate-500">
              {supportsHardwareZoom
                ? 'Menggunakan zoom kamera perangkat.'
                : 'Zoom visual aktif. Arahkan QR ke kotak hijau besar.'}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 grid place-items-center">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Scan QR dari guru</h3>
            <p className="text-xs text-slate-500">Sistem akan validasi kelas, sekolah, jadwal, dan jam pelajaran.</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          QR akan otomatis ditolak jika sudah lewat jam pelajaran, token kedaluwarsa, atau bukan untuk sekolah dan kelas kamu.
        </div>

        {(cameraError || lastError) && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {cameraError || lastError}
          </div>
        )}

        <form onSubmit={handleManualSubmit} className="mt-5 space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            Tempel kode QR jika kamera tidak tersedia
          </label>
          <textarea
            value={manualToken}
            onChange={(event) => setManualToken(event.target.value)}
            rows={4}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Tempel hasil scan QR di sini"
          />
          <button
            type="submit"
            disabled={isSubmitting || !manualToken.trim()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed px-4 py-3 text-sm font-bold text-white"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Proses Absensi QR
          </button>
        </form>
      </div>
    </div>
  )
}
