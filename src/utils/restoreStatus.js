const numberFormatter = new Intl.NumberFormat('id-ID')

const toNumber = (value, fallback = 0) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

const formatNumber = (value) => numberFormatter.format(toNumber(value))

const joinParts = (parts) => parts.filter(Boolean).join(', ')

export const buildRestoreStatusToast = (result, { fallbackAction = 'restore' } = {}) => {
  const summary = result?.summary || {}
  const dryRun = Boolean(summary?.dry_run)
  const incoming = toNumber(summary?.incoming_rows)
  const inserted = toNumber(dryRun ? summary?.would_insert : summary?.inserted)
  const updated = toNumber(dryRun ? summary?.would_update : summary?.updated)
  const skipped = toNumber(summary?.skipped)
  const conflicts = toNumber(summary?.conflicts)
  const errors = toNumber(summary?.errors)
  const deleted = toNumber(summary?.deleted_before_restore)
  const tablesApplied = toNumber(summary?.tables_applied)
  const changed = inserted + updated + deleted

  let type = 'success'
  let title = dryRun ? 'Dry-Run Restore Selesai' : 'Restore Berhasil'

  if (errors > 0) {
    type = 'error'
    title = dryRun ? 'Dry-Run Menemukan Error' : 'Restore Bermasalah'
  } else if (conflicts > 0 || skipped > 0) {
    type = changed > 0 || dryRun ? 'warning' : 'info'
    title = dryRun ? 'Dry-Run Selesai dengan Catatan' : 'Restore Selesai dengan Catatan'
  } else if (!dryRun && changed <= 0) {
    type = 'info'
    title = 'Restore Tanpa Perubahan'
  } else if (dryRun && inserted + updated <= 0) {
    type = 'info'
    title = 'Dry-Run Tanpa Perubahan'
  }

  const actionLabel = dryRun ? 'Simulasi' : 'Restore'
  const operationParts = dryRun
    ? [
        `${formatNumber(inserted)} akan ditambahkan`,
        `${formatNumber(updated)} akan diperbarui`
      ]
    : [
        `${formatNumber(inserted)} ditambahkan`,
        `${formatNumber(updated)} diperbarui`,
        deleted > 0 ? `${formatNumber(deleted)} dihapus sebelum restore` : ''
      ]

  const statusParts = [
    `${formatNumber(incoming)} baris dicek`,
    tablesApplied > 0 ? `${formatNumber(tablesApplied)} tabel diproses` : '',
    joinParts(operationParts),
    skipped > 0 ? `${formatNumber(skipped)} dilewati` : '',
    conflicts > 0 ? `${formatNumber(conflicts)} konflik` : '',
    errors > 0 ? `${formatNumber(errors)} error` : ''
  ]

  let message = `${actionLabel}: ${joinParts(statusParts)}.`

  if (!dryRun && changed <= 0 && errors <= 0) {
    message = incoming > 0
      ? `Restore selesai, tetapi tidak ada data baru yang ditambahkan atau diperbarui. ${joinParts(statusParts)}.`
      : 'Restore selesai, tetapi file tidak berisi baris data untuk diproses.'
  }

  if (dryRun && inserted + updated <= 0 && errors <= 0) {
    message = incoming > 0
      ? `Dry-run selesai, tidak ada data baru yang perlu ditambahkan atau diperbarui. ${joinParts(statusParts)}.`
      : 'Dry-run selesai, tetapi file tidak berisi baris data untuk diproses.'
  }

  return {
    type,
    title,
    message: message || `${fallbackAction} selesai.`,
    duration: errors > 0 || conflicts > 0 || skipped > 0 ? 9000 : 6500
  }
}
