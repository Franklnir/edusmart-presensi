// src/lib/api/requestId.js
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

let lastRequestId = null

export const isValidRequestId = (value) => (
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
)

export const generateRequestId = () => {
  const requestId = generateUUID().toLowerCase()
  lastRequestId = requestId
  return requestId
}

export const setLastRequestId = (requestId) => {
  if (isValidRequestId(requestId)) lastRequestId = requestId.toLowerCase()
  return lastRequestId
}

export const getLastRequestId = () => lastRequestId
