// src/components/Toast.jsx
import React, { useEffect } from 'react'
import { useUIStore } from '../store/useUIStore'

const Toast = () => {
  const { toasts, removeToast } = useUIStore()

  useEffect(() => {
    if (!toasts.length) return

    // bikin timeout hanya untuk toast yang baru muncul
    const timers = toasts.map((t) =>
      setTimeout(() => removeToast(t.id), 3000)
    )

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [toasts, removeToast])

  if (!toasts.length) return null

  return (
    <div className="fixed top-4 right-4 space-y-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-2 rounded shadow text-sm text-white ${
            t.type === 'error' ? 'bg-red-500' : 'bg-green-500'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

export default Toast
