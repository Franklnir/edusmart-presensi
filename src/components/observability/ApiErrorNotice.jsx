import React, { useState } from 'react'
import { AlertCircle, Check, Copy, RefreshCw, X } from 'lucide-react'
import { getApiErrorMessage, isAbortError, isUnauthorizedError } from '../../lib/api/errors'

export default function ApiErrorNotice({ error, onRetry, onClose, fallback = 'Permintaan tidak dapat diproses.' }) {
  const [copied, setCopied] = useState(false)
  if (!error || isAbortError(error)) return null

  const requestId = error.requestId || ''
  const canRetry = typeof onRetry === 'function' && !isUnauthorizedError(error) && error.code !== 'REQUEST_ABORTED'

  const copyRequestId = async () => {
    if (!requestId || typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(requestId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard permission is optional */ }
  }

  return (
    <div role="alert" className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-950">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-black">{isUnauthorizedError(error) ? 'Sesi berakhir' : getApiErrorMessage(error, fallback)}</p>
        {error.code ? <p className="mt-1 text-xs font-bold text-rose-700">Kode: {error.code}</p> : null}
        {requestId ? (
          <button type="button" onClick={copyRequestId} className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-rose-700 underline underline-offset-2">
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Request ID disalin' : `Request ID: ${requestId}`}
          </button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {canRetry ? (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100">
            <RefreshCw size={14} /> Coba lagi
          </button>
        ) : null}
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Tutup pesan error" className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-100">
            <X size={16} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
