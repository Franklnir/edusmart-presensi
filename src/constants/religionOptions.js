export const RELIGION_OPTIONS = [
  'Islam',
  'Kristen',
  'Katolik',
  'Hindu',
  'Buddha',
  'Konghucu',
  'Kepercayaan'
]

export const religionSelectOptions = (currentValue = '') => {
  const current = String(currentValue || '').trim()
  const values = current && !RELIGION_OPTIONS.includes(current)
    ? [...RELIGION_OPTIONS, current]
    : RELIGION_OPTIONS

  return [
    { value: '', label: 'Pilih Agama' },
    ...values.map((value) => ({ value, label: value }))
  ]
}
