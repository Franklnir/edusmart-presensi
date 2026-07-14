import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiClient = vi.fn()
vi.mock('../../lib/api/client', () => ({ apiClient }))
vi.mock('../../lib/api/requestId', () => ({ generateRequestId: () => 'upload-key' }))

const { uploadService } = await import('../uploadService')

class FakeXhr {
  static last = null

  constructor() {
    FakeXhr.last = this
    this.headers = {}
    this.upload = {}
    this.status = 200
  }

  open(method, url) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name, value) {
    this.headers[name] = value
  }

  send(body) {
    this.body = body
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
    this.onload()
  }

  abort() {
    this.onabort?.()
  }
}

describe('Upload API V2 service', () => {
  beforeEach(() => {
    apiClient.mockReset()
    globalThis.XMLHttpRequest = FakeXhr
  })

  it('follows server PUT instruction, reports progress, and returns attachment id', async () => {
    apiClient
      .mockResolvedValueOnce({ payload: { data: {
        upload: { id: 'session-1' },
        instruction: {
          method: 'PUT',
          url: 'https://objects.test/signed',
          headers: { 'Content-Type': 'application/pdf' },
          fields: {},
          expires_at: '2026-07-14T10:00:00Z'
        }
      } } })
      .mockResolvedValueOnce({ payload: { data: { attachment: { id: 'attachment-1' } } } })

    const progress = vi.fn()
    const file = new File(['test'], 'answer.pdf', { type: 'application/pdf' })
    const attachment = await uploadService.uploadFile(file, {
      purpose: 'submission_attachment',
      assignmentId: 12,
      onProgress: progress
    })

    expect(FakeXhr.last.method).toBe('PUT')
    expect(FakeXhr.last.url).toBe('https://objects.test/signed')
    expect(FakeXhr.last.headers).toEqual({ 'Content-Type': 'application/pdf' })
    expect(FakeXhr.last.body).toBe(file)
    expect(progress).toHaveBeenCalledWith(50)
    expect(progress).toHaveBeenCalledWith(100)
    expect(attachment).toEqual({ id: 'attachment-1' })
    expect(apiClient.mock.calls.map(([path]) => path)).toEqual([
      '/api/v2/uploads',
      '/api/v2/uploads/session-1/complete'
    ])
  })

  it('uses server POST fields instead of assuming PUT semantics', async () => {
    apiClient
      .mockResolvedValueOnce({ payload: { data: {
        upload: { id: 'session-post' },
        instruction: {
          method: 'POST',
          url: 'https://objects.test/form',
          headers: {},
          fields: { key: 'server-owned-key', policy: 'signed-policy' }
        }
      } } })
      .mockResolvedValueOnce({ payload: { data: { attachment: { id: 'attachment-post' } } } })

    await uploadService.uploadFile(new File(['x'], 'photo.png', { type: 'image/png' }), {
      purpose: 'assignment_attachment'
    })

    expect(FakeXhr.last.method).toBe('POST')
    expect(FakeXhr.last.body).toBeInstanceOf(FormData)
    expect(FakeXhr.last.body.get('key')).toBe('server-owned-key')
    expect(FakeXhr.last.body.get('policy')).toBe('signed-policy')
  })

  it('uses authorized attachment routes for download and deletion', async () => {
    apiClient
      .mockResolvedValueOnce({ payload: { data: { instruction: { method: 'GET', url: 'https://objects.test/read', headers: {} } } } })
      .mockResolvedValueOnce({ payload: { success: true } })

    await expect(uploadService.resolveDownloadUrl('attachment-1')).resolves.toBe('https://objects.test/read')
    await uploadService.deleteAttachment('attachment-1')

    expect(apiClient.mock.calls.map(([path]) => path)).toEqual([
      '/api/v2/attachments/attachment-1/download',
      '/api/v2/attachments/attachment-1'
    ])
    expect(apiClient.mock.calls[1][1].headers).toEqual({ 'Idempotency-Key': 'upload-key' })
  })
})
