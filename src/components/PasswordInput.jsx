import React, { forwardRef, useMemo, useState } from 'react'

function EyeIcon({ off = false, className = '' }) {
  if (off) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={className}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.58 10.58a2 2 0 102.83 2.83M9.88 5.08A10.94 10.94 0 0112 4.9c5.05 0 8.27 4.25 9.08 5.5-.45.7-1.64 2.32-3.5 3.71M6.61 6.61C4.32 8.2 2.83 10.22 2 11.4c.58.85 1.68 2.3 3.28 3.63 1.94 1.63 4.22 2.47 6.72 2.47a11.2 11.2 0 003.15-.45"
        />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"
      />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  )
}

const PasswordInput = forwardRef(function PasswordInput(
  {
    className = '',
    containerClassName = '',
    buttonClassName = '',
    ariaLabelShow = 'Tampilkan password',
    ariaLabelHide = 'Sembunyikan password',
    style,
    disabled,
    ...props
  },
  ref
) {
  const [visible, setVisible] = useState(false)

  const inputStyle = useMemo(() => {
    const merged = { ...(style || {}) }
    if (!Object.prototype.hasOwnProperty.call(merged, 'paddingRight')) {
      merged.paddingRight = '2.5rem'
    }
    return merged
  }, [style])

  return (
    <div className={`relative ${containerClassName}`.trim()}>
      <input
        {...props}
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={className}
        style={inputStyle}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        className={`absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 disabled:opacity-50 ${buttonClassName}`.trim()}
        aria-label={visible ? ariaLabelHide : ariaLabelShow}
        title={visible ? ariaLabelHide : ariaLabelShow}
      >
        <EyeIcon off={visible} className="h-5 w-5" />
      </button>
    </div>
  )
})

export default PasswordInput
