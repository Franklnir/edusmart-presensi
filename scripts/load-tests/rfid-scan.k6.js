import http from 'k6/http'
import { check, fail, sleep } from 'k6'
import exec from 'k6/execution'

const baseUrl = String(__ENV.BASE_URL || '').replace(/\/+$/, '')
const tenantSlug = String(__ENV.TENANT_SLUG || '').trim()
const sharedKey = String(__ENV.RFID_SHARED_KEY || '').trim()
const deviceSecret = String(__ENV.RFID_DEVICE_SECRET || '').trim()
const singleDeviceId = String(__ENV.RFID_DEVICE_ID || 'LOADTEST_RFID_01').trim()
const deviceIds = String(__ENV.RFID_DEVICE_IDS || '')
  .split(/[,\n]/)
  .map((item) => item.trim())
  .filter(Boolean)
const cardUids = String(__ENV.RFID_CARD_UIDS || '')
  .split(/[,\n]/)
  .map((item) => item.trim())
  .filter(Boolean)
const mode = String(__ENV.RFID_MODE || 'auto').trim()
const allowProduction = String(__ENV.ALLOW_PRODUCTION_LOAD_TEST || '').toLowerCase() === 'true'
const students = Number(__ENV.STUDENTS || cardUids.length || 0)

if (!baseUrl || !tenantSlug || !cardUids.length || students < 1) {
  fail('BASE_URL, TENANT_SLUG, RFID_CARD_UIDS, dan STUDENTS wajib diisi.')
}

if (!sharedKey && !deviceSecret) {
  fail('Isi RFID_SHARED_KEY atau RFID_DEVICE_SECRET untuk autentikasi RFID.')
}

if (cardUids.length < students) {
  fail(`RFID_CARD_UIDS hanya berisi ${cardUids.length} kartu, tetapi STUDENTS=${students}.`)
}

if (!allowProduction && /(^|\.)sismu\.biz\.id$/i.test(new URL(baseUrl).hostname)) {
  fail('Load test ke production diblokir. Gunakan staging atau isi ALLOW_PRODUCTION_LOAD_TEST=true dengan sadar.')
}

export const options = {
  scenarios: {
    rfid_scan_wave: {
      executor: 'per-vu-iterations',
      vus: students,
      iterations: 1,
      maxDuration: String(__ENV.MAX_DURATION || '3m'),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1200'],
  },
}

function studentIndex() {
  return (exec.vu.idInTest - 1) % students
}

function deviceIdFor(index) {
  return deviceIds[index] || singleDeviceId
}

export default function () {
  const index = studentIndex()
  const deviceId = deviceIdFor(index)
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-RFID-Device': deviceId,
  }

  if (sharedKey) {
    headers['X-RFID-Key'] = sharedKey
  }
  if (deviceSecret) {
    headers['X-RFID-Secret'] = deviceSecret
  }

  const response = http.post(
    `${baseUrl}/api/rfid/scan`,
    JSON.stringify({
      tenant_slug: tenantSlug,
      device_id: deviceId,
      card_uid: cardUids[index],
      event_id: `loadtest-${Date.now()}-${index}-${exec.vu.idInTest}`,
      mode,
    }),
    { headers, tags: { flow: 'rfid' } },
  )

  check(response, {
    'rfid response valid': (result) => [200, 207, 422].includes(result.status),
    'rfid tidak server error': (result) => result.status < 500,
  })

  sleep(Math.random() * 0.2)
}
