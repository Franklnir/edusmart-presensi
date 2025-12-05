// src/components/Toast.jsx
import React, { useEffect } from 'react'
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
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-full max-w-xs sm:max-w-sm">
      {toasts.map((t) => {
        const type = t.type || 'default'
        const style = TYPE_STYLES[type] || TYPE_STYLES.default
        const icon = TYPE_ICON[type] || TYPE_ICON.default

        return (
          <div
            key={t.id}
            className={`
              relative flex items-start gap-3 px-4 py-3 rounded-2xl
              bg-white/95 text-slate-900 backdrop-blur-sm
              ${style.card}
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
    </div>
  )
}

export default Toast
