import { describe, expect, it } from 'vitest'
import {
  buildApiUrl,
  isSuperAdminRuntimeHost,
  resolveApiBaseUrl
} from '../url'

describe('tenant-aware API URL resolver', () => {
  it('keeps production tenant API requests on the active subdomain', () => {
    const options = {
      rawApiUrl: 'https://sismu.biz.id',
      rootDomain: 'sismu.biz.id',
      runtimeHost: 'sman3bogor.sismu.biz.id',
      runtimeProtocol: 'https:'
    }

    expect(resolveApiBaseUrl(options)).toBe('https://sman3bogor.sismu.biz.id')
    expect(buildApiUrl('/api/v2/academic-context', options)).toBe(
      'https://sman3bogor.sismu.biz.id/api/v2/academic-context'
    )
  })

  it('does not rewrite an API host outside the configured tenant root', () => {
    expect(resolveApiBaseUrl({
      rawApiUrl: 'https://api.example.net',
      rootDomain: 'sismu.biz.id',
      runtimeHost: 'demo.sismu.biz.id',
      runtimeProtocol: 'https:'
    })).toBe('https://api.example.net')
  })

  it('recognizes only the dedicated platform admin host', () => {
    const shared = {
      rootDomain: 'sismu.biz.id',
      adminSubdomain: 'admin26'
    }

    expect(isSuperAdminRuntimeHost({
      ...shared,
      runtimeHost: 'admin26.sismu.biz.id'
    })).toBe(true)
    expect(isSuperAdminRuntimeHost({
      ...shared,
      runtimeHost: 'sman3bogor.sismu.biz.id'
    })).toBe(false)
  })
})
