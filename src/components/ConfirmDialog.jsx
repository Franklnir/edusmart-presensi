import React, { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'

const TONE = {
  danger: {
    icon: XCircle,
    iconClass: 'bg-rose-100 text-rose-700',
    buttonClass: 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-300'
  },
  success: {
    icon: CheckCircle2,
    iconClass: 'bg-emerald-100 text-emerald-700',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-300'
  },
  info: {
    icon: Info,
    iconClass: 'bg-sky-100 text-sky-700',
    buttonClass: 'bg-sky-600 hover:bg-sky-700 focus:ring-sky-300'
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'bg-amber-100 text-amber-700',
    buttonClass: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-300'
  }
}

export default function ConfirmDialog() {
  const { confirmation, resolveConfirmation, closeConfirmation } = useUIStore()

  useEffect(() => {
    if (!confirmation) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeConfirmation()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmation, closeConfirmation])

  if (!confirmation) return null

  const tone = TONE[confirmation.tone] || TONE.warning
  const Icon = tone.icon

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl"
      >
        <div className="flex items-start gap-4 px-6 pt-6">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tone.iconClass}`}>
            <Icon size={24} strokeWidth={2.4} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-lg font-bold text-slate-950">
              {confirmation.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {confirmation.message}
            </p>
          </div>
        </div>

        {confirmation.details?.length > 0 && (
          <div className="mx-6 mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <ul className="space-y-2 text-sm text-slate-600">
              {confirmation.details.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={closeConfirmation}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            {confirmation.cancelText}
          </button>
          <button
            type="button"
            onClick={() => resolveConfirmation(true)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 ${tone.buttonClass}`}
          >
            {confirmation.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
