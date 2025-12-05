// src/utils/logger.js

// true saat `npm run dev`, false saat build production
const isDev = import.meta.env.DEV

// Kalau kamu mau error tetap muncul di production,
// set VITE_ENABLE_CLIENT_ERROR_LOGS=true di env.
const enableClientErrorLogs =
  import.meta.env.VITE_ENABLE_CLIENT_ERROR_LOGS === 'true'

// NAMED EXPORTS (bisa di-import { logDebug, logError })
export const logDebug = (...args) => {
  if (isDev) {
    console.debug(...args)
  }
}

export const logInfo = (...args) => {
  if (isDev) {
    console.info(...args)
  }
}

export const logWarn = (...args) => {
  if (isDev) {
    console.warn(...args)
  }
}

export const logError = (...args) => {
  if (isDev || enableClientErrorLogs) {
    console.error(...args)
  }
}

// OPTIONAL: default export kalau mau import logger aja
const logger = {
  debug: logDebug,
  info: logInfo,
  warn: logWarn,
  error: logError
}

export default logger
