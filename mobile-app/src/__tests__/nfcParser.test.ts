import { parseNfcTag } from '@/features/attendance/nfc/nfcParser';

function bytes(value: string): number[] {
  return Array.from(value).map(char => char.charCodeAt(0));
}

it('parses NDEF text records and normalizes card UID', () => {
  const parsed = parseNfcTag({
    ndefMessage: [{
      tnf: 1,
      type: [84],
      payload: [0x02, ...bytes('en'), ...bytes('ab cd')],
    }],
  });

  expect(parsed).toEqual({ value: 'ABCD', source: 'ndef-text' });
});

it('extracts card_uid from JSON text payloads', () => {
  const parsed = parseNfcTag({
    ndefMessage: [{
      tnf: 1,
      type: [84],
      payload: [0x02, ...bytes('en'), ...bytes(JSON.stringify({ card_uid: '04:a1:b2:c3' }))],
    }],
  });

  expect(parsed).toEqual({ value: '04A1B2C3', source: 'ndef-json' });
});

it('extracts token query values from URI records', () => {
  const parsed = parseNfcTag({
    ndefMessage: [{
      tnf: 1,
      type: [85],
      payload: [0x04, ...bytes('sismu.biz.id/nfc?token=card-123')],
    }],
  });

  expect(parsed).toEqual({ value: 'CARD-123', source: 'ndef-uri' });
});

it('falls back to tag id when NDEF payload is empty', () => {
  const parsed = parseNfcTag({ id: [0x04, 0xa1, 0xb2, 0xc3], ndefMessage: [] });

  expect(parsed).toEqual({ value: '04A1B2C3', source: 'tag-id' });
});

it('rejects empty tags', () => {
  expect(parseNfcTag(null)).toEqual({ value: '', source: 'unknown' });
});
