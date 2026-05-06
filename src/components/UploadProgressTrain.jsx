import React from 'react'
import { CloudUpload, TrainFront } from 'lucide-react'

const toneClasses = {
  blue: 'upload-train--blue',
  purple: 'upload-train--purple',
  emerald: 'upload-train--emerald',
  red: 'upload-train--red'
}

export default function UploadProgressTrain({
  label = 'Mengupload file...',
  detail = 'File sedang dikirim ke storage.',
  tone = 'blue',
  className = ''
}) {
  const toneClass = toneClasses[tone] || toneClasses.blue
  const badgeLabel = tone === 'emerald' ? 'DRIVE' : tone === 'red' ? 'VPS' : 'UPLOAD'

  return (
    <div
      className={`upload-train ${toneClass} ${className}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="upload-train__header">
        <span className="upload-train__icon" aria-hidden="true">
          <CloudUpload size={14} strokeWidth={2.4} />
        </span>
        <span className="upload-train__copy">
          <span className="upload-train__label">{label}</span>
          <span className="upload-train__detail">{detail}</span>
        </span>
        <span className="upload-train__percent" aria-hidden="true">{badgeLabel}</span>
      </div>

      <div className="upload-train__battery-shell" aria-hidden="true">
        <div className="upload-train__rail">
          <div className="upload-train__fill" />
          <div className="upload-train__cells">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="upload-train__engine">
            <TrainFront size={14} strokeWidth={2.6} />
          </div>
        </div>
        <span className="upload-train__battery-cap" />
      </div>
    </div>
  )
}
