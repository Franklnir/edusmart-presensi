import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

const mutationOptions = (method, body = {}, signal) => {
  const key = body.idempotency_key || generateRequestId()
  return {
    method,
    headers: { 'Idempotency-Key': key },
    body: { ...body, idempotency_key: key },
    signal
  }
}

const toBase64 = (bytes) => {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

const sha256 = async (file) => {
  if (!globalThis.crypto?.subtle || typeof file?.arrayBuffer !== 'function') return null
  const contents = await file.arrayBuffer()
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(contents))
  return toBase64(new Uint8Array(digest))
}

export const sendUploadInstruction = (instruction, file, { signal, onProgress } = {}) => (
  new Promise((resolve, reject) => {
    const method = String(instruction?.method || '').toUpperCase()
    if (!['PUT', 'POST'].includes(method) || !instruction?.url) {
      reject(new Error('Instruksi upload dari server tidak valid.'))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open(method, instruction.url, true)
    Object.entries(instruction.headers || {}).forEach(([name, value]) => xhr.setRequestHeader(name, value))

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onerror = () => reject(new Error('Provider storage tidak dapat dijangkau.'))
    xhr.onabort = () => reject(Object.assign(new Error('Upload dibatalkan.'), { code: 'UPLOAD_ABORTED' }))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100)
        resolve()
      } else {
        reject(new Error(`Provider storage menolak upload (${xhr.status}).`))
      }
    }

    const abort = () => xhr.abort()
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })

    if (method === 'POST') {
      const form = new FormData()
      Object.entries(instruction.fields || {}).forEach(([name, value]) => form.append(name, value))
      form.append('file', file)
      xhr.send(form)
    } else {
      xhr.send(file)
    }
  })
)

export const uploadService = {
  async createSession(file, { purpose, assignmentId, quizId, signal } = {}) {
    const checksum = await sha256(file)
    const payload = {
      purpose,
      assignment_id: assignmentId || undefined,
      quiz_id: quizId || undefined,
      filename: file.name,
      content_type: file.type,
      size: file.size,
      checksum_sha256: checksum || undefined
    }
    const result = await apiClient('/api/v2/uploads', mutationOptions('POST', payload, signal))
    return result.payload?.data || result.data
  },

  async completeSession(sessionId, { signal } = {}) {
    const result = await apiClient(
      `/api/v2/uploads/${encodeURIComponent(sessionId)}/complete`,
      mutationOptions('POST', {}, signal)
    )
    return result.payload?.data?.attachment || result.data?.attachment
  },

  async cancelSession(sessionId) {
    if (!sessionId) return
    await apiClient(`/api/v2/uploads/${encodeURIComponent(sessionId)}`, mutationOptions('DELETE'))
  },

  async uploadFile(file, options = {}) {
    let sessionId = null
    try {
      const created = await this.createSession(file, options)
      sessionId = created.upload.id
      await sendUploadInstruction(created.instruction, file, options)
      return await this.completeSession(sessionId, options)
    } catch (error) {
      if (sessionId) {
        await this.cancelSession(sessionId).catch(() => {})
      }
      throw error
    }
  },

  async getAttachment(id) {
    const result = await apiClient(`/api/v2/attachments/${encodeURIComponent(id)}`)
    return result.payload?.data || result.data
  },

  async getDownloadInstruction(id) {
    const result = await apiClient(`/api/v2/attachments/${encodeURIComponent(id)}/download`)
    return result.payload?.data?.instruction || result.data?.instruction
  },

  async resolveDownloadUrl(id, { signal } = {}) {
    const instruction = await this.getDownloadInstruction(id)
    if (!instruction || instruction.method !== 'GET') throw new Error('Instruksi download tidak valid.')
    if (Object.keys(instruction.headers || {}).length === 0) return instruction.url

    const response = await fetch(instruction.url, { headers: instruction.headers, signal, credentials: 'omit' })
    if (!response.ok) throw new Error('Attachment gagal diunduh.')
    return URL.createObjectURL(await response.blob())
  },

  async deleteAttachment(id) {
    const result = await apiClient(
      `/api/v2/attachments/${encodeURIComponent(id)}`,
      mutationOptions('DELETE')
    )
    return result.payload || result.data
  }
}
