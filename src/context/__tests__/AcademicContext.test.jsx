import React from 'react'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: {
    authState: 'guest',
    profile: null,
    settings: null
  },
  getActiveContext: vi.fn()
}))

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: (selector) => selector(mocks.auth)
}))

vi.mock('../../services/academicContextService', () => ({
  academicContextService: {
    getActiveContext: mocks.getActiveContext
  }
}))

const { AcademicContextProvider } = await import('../AcademicContext')
const { queryClient } = await import('../../lib/queryClient')

describe('AcademicContextProvider request lifecycle', () => {
  beforeEach(() => {
    queryClient.clear()
    mocks.getActiveContext.mockReset()
    mocks.getActiveContext.mockResolvedValue({
      data: { tahun_ajaran: '2026/2027', semester: 'Ganjil' }
    })
    mocks.auth.authState = 'guest'
    mocks.auth.profile = null
    mocks.auth.settings = null
  })

  it('does not request an authenticated academic context for a guest page', async () => {
    render(
      <AcademicContextProvider>
        <div>public page</div>
      </AcademicContextProvider>
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.getActiveContext).not.toHaveBeenCalled()
  })

  it('loads the academic context after an authenticated tenant profile exists', async () => {
    mocks.auth.authState = 'authenticated'
    mocks.auth.profile = {
      id: 'user-1',
      tenant_id: 'tenant-1',
      role: 'admin'
    }

    render(
      <AcademicContextProvider>
        <div>admin page</div>
      </AcademicContextProvider>
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.getActiveContext).toHaveBeenCalledTimes(1)
  })
})
