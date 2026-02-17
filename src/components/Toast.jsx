// src/components/Toast.jsx
import React, { useEffect, useMemo } from 'react'
import { useUIStore } from '../store/useUIStore'

const TYPE_STYLES = {
  success: {
    card: 'border-emerald-500 shadow-emerald-200',
    icon: 'bg-emerald-50 text-emerald-600'
  },
  error: {
    card: 'border-red-500 shadow-red-200',
    icon: 'bg-red-50 text-red-600'
  },
  warning: {
    card: 'border-amber-500 shadow-amber-200',
    icon: 'bg-amber-50 text-amber-700'
  },
  info: {
    card: 'border-blue-500 shadow-blue-200',
    icon: 'bg-blue-50 text-blue-600'
  },
  default: {
    card: 'border-slate-500 shadow-slate-200',
    icon: 'bg-slate-100 text-slate-700'
  }
}

const TYPE_ICON = {
  success: '✅',
  error: '⚠️',
  warning: '⚠️',
  info: 'ℹ️',
  default: '🔔'
}

const Toast = () => {
  const { toasts, removeToast } = useUIStore()
  const orderedToasts = useMemo(() => [...toasts].reverse(), [toasts])

  useEffect(() => {
    if (!toasts.length) return

    const timers = toasts.map((t) => {
      const duration = t.duration ?? 3500 // default 3.5 detik
      return setTimeout(() => removeToast(t.id), duration)
    })

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [toasts, removeToast])

  if (!toasts.length) return null

  return (
    <div className="pointer-events-none fixed z-[100] top-[max(12px,env(safe-area-inset-top))] left-3 right-3 sm:left-auto sm:right-4 sm:w-[360px] flex flex-col gap-2">
      {orderedToasts.map((t) => {
        const type = t.type || 'default'
        const style = TYPE_STYLES[type] || TYPE_STYLES.default
        const icon = TYPE_ICON[type] || TYPE_ICON.default

        return (
          <div
            key={t.id}
            className={`
              pointer-events-auto relative flex items-start gap-3 px-4 py-3 rounded-2xl
              bg-white/95 text-slate-900 backdrop-blur-sm
              border shadow-lg ${style.card}
              transition-all duration-200 ease-out animate-[toast-in_200ms_ease-out]
            `}
          >
            {/* Icon dengan background warna supaya jelas */}
            <div
              className={`
                mt-0.5 flex h-7 w-7 items-center justify-center
                rounded-full text-sm font-medium
                ${style.icon}
              `}
            >
              {icon}
            </div>

            <div className="flex-1">
              {t.title && (
                <div className="text-xs font-semibold text-slate-700 mb-0.5">
                  {t.title}
                </div>
              )}
              <div className="text-sm leading-snug text-slate-900">
                {t.message}
              </div>
            </div>

            <button
              onClick={() => removeToast(t.id)}
              className="ml-2 text-xs text-slate-500 hover:text-slate-800 hover:scale-110 transition-transform"
              aria-label="Close notification"
            >
              ✕
            </button>
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
      `}</style>
    </div>
  )
}

export default Toast
