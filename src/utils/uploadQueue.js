export const getResponsiveUploadConcurrency = ({ min = 1, max = 3 } = {}) => {
  if (typeof navigator === 'undefined') return Math.max(min, Math.min(max, 2))

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  if (connection?.saveData) return min
  if (['slow-2g', '2g'].includes(connection?.effectiveType)) return min

  const cores = Number(navigator.hardwareConcurrency || 0)
  if (cores >= 8) return Math.max(min, max)
  if (cores >= 4) return Math.max(min, Math.min(max, 2))
  return min
}

export const createAggregateProgress = (total, onProgress) => {
  const count = Math.max(1, Number(total) || 1)
  const values = Array.from({ length: count }, () => 0)

  return (index, value) => {
    const safeIndex = Math.max(0, Math.min(count - 1, Number(index) || 0))
    values[safeIndex] = Math.max(0, Math.min(100, Number(value) || 0))
    const aggregate = values.reduce((sum, item) => sum + item, 0) / count
    if (typeof onProgress === 'function') onProgress(Math.round(aggregate))
  }
}

export const runConcurrentQueue = async (items, worker, options = {}) => {
  const list = Array.from(items || [])
  if (list.length === 0) return []

  const concurrency = Math.max(
    1,
    Math.min(Number(options.concurrency || 1), list.length)
  )
  const results = new Array(list.length)
  const errors = []
  let nextIndex = 0
  let aborted = false

  const runners = Array.from({ length: concurrency }, async () => {
    while (!aborted) {
      const index = nextIndex
      nextIndex += 1
      if (index >= list.length) return

      try {
        results[index] = await worker(list[index], index)
      } catch (error) {
        aborted = true
        errors.push(error)
        if (typeof options.onError === 'function') options.onError(error)
        throw error
      }
    }
  })

  await Promise.allSettled(runners)
  if (errors.length > 0) throw errors[0]
  return results
}
