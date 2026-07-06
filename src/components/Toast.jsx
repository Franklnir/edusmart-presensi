// src/components/Toast.jsx
import React, { useEffect, useMemo } from 'react'
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'

const TYPE_STYLES = {
  success: {
    card: 'border-emerald-100 shadow-emerald-950/10',
    rail: 'bg-emerald-500',
    glow: 'bg-emerald-500/10',
    icon: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    bar: 'bg-emerald-500',
    title: 'Berhasil'
  },
  error: {
    card: 'border-rose-100 shadow-rose-950/10',
    rail: 'bg-rose-500',
    glow: 'bg-rose-500/10',
    icon: 'bg-rose-50 text-rose-700 ring-rose-100',
    bar: 'bg-rose-500',
    title: 'Gagal'
  },
  warning: {
    card: 'border-amber-100 shadow-amber-950/10',
    rail: 'bg-amber-500',
    glow: 'bg-amber-500/10',
    icon: 'bg-amber-50 text-amber-800 ring-amber-100',
    bar: 'bg-amber-500',
    title: 'Perhatian'
  },
  info: {
    card: 'border-sky-100 shadow-sky-950/10',
    rail: 'bg-sky-500',
    glow: 'bg-sky-500/10',
    icon: 'bg-sky-50 text-sky-700 ring-sky-100',
    bar: 'bg-sky-500',
    title: 'Informasi'
  },
  default: {
    card: 'border-slate-200 shadow-slate-950/10',
    rail: 'bg-slate-500',
    glow: 'bg-slate-500/10',
    icon: 'bg-slate-50 text-slate-700 ring-slate-100',
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
    <div
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed z-[100] top-[max(14px,env(safe-area-inset-top))] left-3 right-3 flex flex-col gap-2.5 sm:left-auto sm:right-5 sm:w-[400px]"
    >
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
              toast-card pointer-events-auto relative overflow-hidden rounded-[1.15rem] border bg-white/95
              px-4 py-3.5 text-slate-900 shadow-[0_22px_70px_rgba(15,23,42,0.14)]
              backdrop-blur-xl ${style.card}
              transition-all duration-200 ease-out animate-[toast-in_220ms_ease-out]
            `}
          >
            <div className={`absolute inset-y-0 left-0 w-1 ${style.rail}`} />
            <div className={`pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full blur-2xl ${style.glow}`} />

            <div className="relative flex items-start gap-3 pr-7">
              <div
                className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-1 ${style.icon} ${type === 'success' ? 'toast-success-check' : ''}`}
              >
                <Icon size={18} strokeWidth={2.4} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-[0.83rem] font-extrabold leading-5 text-slate-950">
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
              <div className="absolute bottom-0 left-0 h-0.5 w-full bg-slate-100/90">
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
            transform: translateY(-10px) scale(0.98);
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
        .toast-success-check {
          position: relative;
          animation: toast-success-pop 420ms cubic-bezier(.2,.9,.2,1.25) both;
        }
        .toast-success-check::after {
          content: "";
          position: absolute;
          inset: -5px;
          border-radius: 999px;
          border: 2px solid rgba(16, 185, 129, 0.45);
          animation: toast-success-ring 780ms ease-out both;
        }
        @keyframes toast-success-pop {
          0% { transform: scale(.72); opacity: .6; }
          65% { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes toast-success-ring {
          0% { transform: scale(.72); opacity: .72; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .toast-card,
          .toast-success-check,
          .toast-success-check::after {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}

export default Toast
