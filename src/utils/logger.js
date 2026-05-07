// src/utils/logger.js
const isDev = import.meta.env.DEV
const enableClientErrorLogs =
  import.meta.env.VITE_ENABLE_CLIENT_ERROR_LOGS === 'true'

// ====== Named helpers (dipakai di mana-mana) ======
export const logDebug = (...args) => {
  if (isDev) console.debug(...args)
}

export const logInfo = (...args) => {
  if (isDev) console.info(...args)
}

export const logWarn = (...args) => {
  if (isDev) console.warn(...args)
}

export const logError = (...args) => {
  // Error penting boleh muncul di dev,
  // dan kalau di .env kamu set: VITE_ENABLE_CLIENT_ERROR_LOGS=true
  if (isDev || enableClientErrorLogs) {
    console.error(...args)
  }
}

// ====== Default export (kalau mau pakai logger.debug, dll) ======
const logger = {
  debug: logDebug,
  info: logInfo,
  warn: logWarn,
  error: logError
}

export default logger
