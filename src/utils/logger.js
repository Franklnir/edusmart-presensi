// src/utils/logger.js
const isDev = import.meta.env.DEV
const enableClientErrorLogs =
  import.meta.env.VITE_ENABLE_CLIENT_ERROR_LOGS === 'true'

const logger = {
  // Dipakai untuk debug biasa (hanya di dev)
  debug: (...args) => {
    if (isDev) console.debug(...args)
  },
  log: (...args) => {
    if (isDev) console.log(...args)
  },
  info: (...args) => {
    if (isDev) console.info(...args)
  },
  warn: (...args) => {
    if (isDev) console.warn(...args)
  },

  // Error penting: boleh tampil di dev,
  // dan di production kalau kamu set VITE_ENABLE_CLIENT_ERROR_LOGS=true
  error: (...args) => {
    if (isDev || enableClientErrorLogs) {
      console.error(...args)
    }
  }
}

export default logger
