// src/components/Toast.jsx
import React, { useEffect, useMemo } from 'react'
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'

const TYPE_STYLES = {
  success: {
    card: 'border-emerald-200 shadow-emerald-950/10',
    icon: 'bg-emerald-100 text-emerald-700',
    bar: 'bg-emerald-500',
    title: 'Berhasil'
  },
  error: {
    card: 'border-rose-200 shadow-rose-950/10',
    icon: 'bg-rose-100 text-rose-700',
    bar: 'bg-rose-500',
    title: 'Gagal'
  },
  warning: {
    card: 'border-amber-200 shadow-amber-950/10',
    icon: 'bg-amber-100 text-amber-800',
    bar: 'bg-amber-500',
    title: 'Perhatian'
  },
  info: {
    card: 'border-sky-200 shadow-sky-950/10',
    icon: 'bg-sky-100 text-sky-700',
    bar: 'bg-sky-500',
    title: 'Informasi'
  },
  default: {
    card: 'border-slate-200 shadow-slate-950/10',
    icon: 'bg-slate-100 text-slate-700',
    bar: 'bg-slate-500',
    title: 'Notifikasi'
  }
}

const TYPE_ICON = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  default: Bell
}

const Toast = () => {
  const { toasts, removeToast } = useUIStore()
  const orderedToasts = useMemo(() => [...toasts].reverse(), [toasts])

  useEffect(() => {
    if (!toasts.length) return undefined

    const timers = toasts
      .map((toast) => {
        const duration = toast.duration ?? 4500
        if (duration <= 0) return null
        return setTimeout(() => removeToast(toast.id), duration)
      })
      .filter(Boolean)

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [toasts, removeToast])

  if (!toasts.length) return null

  return (
    <div className="pointer-events-none fixed z-[100] top-[max(12px,env(safe-area-inset-top))] left-3 right-3 sm:left-auto sm:right-4 sm:w-[390px] flex flex-col gap-2.5">
      {orderedToasts.map((toast) => {
        const type = toast.type || 'default'
        const style = TYPE_STYLES[type] || TYPE_STYLES.default
        const Icon = TYPE_ICON[type] || TYPE_ICON.default
        const duration = toast.duration ?? 4500

        return (
          <div
            key={toast.id}
            role={type === 'error' ? 'alert' : 'status'}
            className={`
              pointer-events-auto relative overflow-hidden rounded-2xl border bg-white/95
              px-4 py-3.5 text-slate-900 shadow-xl backdrop-blur-xl ${style.card}
              transition-all duration-200 ease-out animate-[toast-in_220ms_ease-out]
            `}
          >
            <div className="flex items-start gap-3 pr-7">
              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
                <Icon size={18} strokeWidth={2.4} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold leading-5 text-slate-950">
                  {toast.title || style.title}
                </div>
                <div className="mt-0.5 text-sm leading-5 text-slate-600">
                  {toast.message}
                </div>
              </div>

              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                aria-label="Tutup notifikasi"
              >
                <X size={16} />
              </button>
            </div>

            {duration > 0 && (
              <div className="absolute bottom-0 left-0 h-1 w-full bg-slate-100">
                <div
                  className={`h-full ${style.bar} animate-[toast-progress_linear_forwards]`}
                  style={{ animationDuration: `${duration}ms` }}
                />
              </div>
            )}
          </div>
        )
      })}
      <style>{`
        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes toast-progress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  )
}

export default Toast
