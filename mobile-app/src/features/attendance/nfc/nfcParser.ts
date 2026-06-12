const URI_PREFIXES: Record<number, string> = {
  0x00: '',
  0x01: 'http://www.',
  0x02: 'https://www.',
  0x03: 'http://',
  0x04: 'https://',
  0x05: 'tel:',
  0x06: 'mailto:',
  0x07: 'ftp://anonymous:anonymous@',
  0x08: 'ftp://ftp.',
  0x09: 'ftps://',
  0x0a: 'sftp://',
  0x0b: 'smb://',
  0x0c: 'nfs://',
  0x0d: 'ftp://',
  0x0e: 'dav://',
  0x0f: 'news:',
  0x10: 'telnet://',
  0x11: 'imap:',
  0x12: 'rtsp://',
  0x13: 'urn:',
  0x14: 'pop:',
  0x15: 'sip:',
  0x16: 'sips:',
  0x17: 'tftp:',
  0x18: 'btspp://',
  0x19: 'btl2cap://',
  0x1a: 'btgoep://',
  0x1b: 'tcpobex://',
  0x1c: 'irdaobex://',
  0x1d: 'file://',
  0x1e: 'urn:epc:id:',
  0x1f: 'urn:epc:tag:',
  0x20: 'urn:epc:pat:',
  0x21: 'urn:epc:raw:',
  0x22: 'urn:epc:',
  0x23: 'urn:nfc:',
};

const TOKEN_KEYS = [
  'card_uid',
  'cardUid',
  'rfid_uid',
  'rfidUid',
  'uid',
  'token',
  'tag_id',
  'tagId',
  'card_id',
  'cardId',
  'id',
];

type NdefRecordLike = {
  tnf?: number;
  type?: number[] | string | null;
  payload?: number[] | Uint8Array | null;
};

export type NfcTagLike = {
  id?: string | number[] | Uint8Array | null;
  ndefMessage?: NdefRecordLike[] | null;
};

export type NfcParseResult = {
  value: string;
  source: 'ndef-text' | 'ndef-uri' | 'ndef-json' | 'tag-id' | 'unknown';
};

export function parseNfcTag(tag: NfcTagLike | null | undefined): NfcParseResult {
  const records = tag?.ndefMessage;

  if (Array.isArray(records)) {
    for (const record of records) {
      const payload = toByteArray(record?.payload);
      if (payload.length === 0) continue;

      const typeChar = recordTypeChar(record);
      if (typeChar === 'T') {
        const text = decodeNdefText(payload);
        const jsonToken = extractJsonToken(text);
        if (jsonToken) return { value: jsonToken, source: 'ndef-json' };

        const normalized = normalizeToken(text);
        if (normalized) return { value: normalized, source: 'ndef-text' };
      }

      if (typeChar === 'U') {
        const uri = decodeNdefUri(payload);
        const token = normalizeToken(extractTokenFromUri(uri) || uri);
        if (token) return { value: token, source: 'ndef-uri' };
      }

      const rawText = decodeTextBytes(payload);
      const rawJsonToken = extractJsonToken(rawText);
      if (rawJsonToken) return { value: rawJsonToken, source: 'ndef-json' };

      const rawToken = normalizeToken(rawText);
      if (rawToken) return { value: rawToken, source: 'ndef-text' };
    }
  }

  const tagId = normalizeTagId(tag?.id);
  if (tagId) {
    return { value: tagId, source: 'tag-id' };
  }

  return { value: '', source: 'unknown' };
}

export function normalizeToken(value: string | null | undefined): string {
  const cleaned = String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();

  if (!cleaned) return '';

  if (/^[0-9a-fA-F][0-9a-fA-F:\-\s]+$/.test(cleaned)) {
    return cleaned.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  }

  return cleaned.replace(/\s+/g, ' ').toUpperCase();
}

function recordTypeChar(record: NdefRecordLike): string | null {
  if (typeof record.type === 'string') return record.type;
  if (!Array.isArray(record.type) || record.type.length !== 1) return null;

  return String.fromCharCode(record.type[0]);
}

function decodeNdefText(payload: number[]): string {
  if (payload.length < 2) return '';

  const statusByte = payload[0];
  const isUtf16 = (statusByte & 0x80) !== 0;
  const langCodeLength = statusByte & 0x3f;
  const textStart = 1 + langCodeLength;

  if (textStart >= payload.length) return '';

  return decodeTextBytes(payload.slice(textStart), isUtf16 ? 'utf-16' : 'utf-8');
}

function decodeNdefUri(payload: number[]): string {
  if (payload.length < 2) return '';

  const prefix = URI_PREFIXES[payload[0]] ?? '';
  return `${prefix}${decodeTextBytes(payload.slice(1))}`.trim();
}

function decodeTextBytes(bytes: number[], encoding: 'utf-8' | 'utf-16' = 'utf-8'): string {
  if (bytes.length === 0) return '';

  if (encoding === 'utf-16') {
    return decodeUtf16(bytes);
  }

  try {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    }
  } catch {
    // Fall through to ASCII-safe decode below.
  }

  try {
    return decodeURIComponent(bytes.map(byte => `%${byte.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function decodeUtf16(bytes: number[]): string {
  if (bytes.length < 2) return '';

  let littleEndian = false;
  let start = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    littleEndian = true;
    start = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    start = 2;
  }

  const chars: number[] = [];
  for (let index = start; index + 1 < bytes.length; index += 2) {
    chars.push(littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1]);
  }

  return String.fromCharCode(...chars);
}

function extractJsonToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return '';

  try {
    const decoded = JSON.parse(trimmed);
    return normalizeToken(findTokenValue(decoded));
  } catch {
    return '';
  }
}

function findTokenValue(value: unknown): string {
  if (!value || typeof value !== 'object') return '';

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTokenValue(item);
      if (found) return found;
    }
    return '';
  }

  const record = value as Record<string, unknown>;
  for (const key of TOKEN_KEYS) {
    const token = record[key];
    if (typeof token === 'string' || typeof token === 'number') {
      return String(token);
    }
  }

  for (const item of Object.values(record)) {
    const found = findTokenValue(item);
    if (found) return found;
  }

  return '';
}

function extractTokenFromUri(uri: string): string {
  const query = uri.split('?')[1]?.split('#')[0] ?? '';
  if (!query) return '';

  for (const part of query.split('&')) {
    const [rawKey, rawValue = ''] = part.split('=');
    const key = decodeUriPart(rawKey);
    if (TOKEN_KEYS.includes(key)) {
      return decodeUriPart(rawValue);
    }
  }

  return '';
}

function decodeUriPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function normalizeTagId(value: NfcTagLike['id']): string {
  if (typeof value === 'string') return normalizeToken(value);

  const bytes = toByteArray(value);
  if (bytes.length === 0) return '';

  return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function toByteArray(value: number[] | Uint8Array | string | null | undefined): number[] {
  if (Array.isArray(value)) return value.map(byte => Number(byte) & 0xff);
  if (value instanceof Uint8Array) return Array.from(value);
  if (typeof value === 'string') return Array.from(value).map(char => char.charCodeAt(0) & 0xff);

  return [];
}
