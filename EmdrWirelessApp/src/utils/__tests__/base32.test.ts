import { base32Decode, base32Encode } from '../base32';

describe('base32', () => {
  test('round-trips arbitrary byte sequences', () => {
    const cases: number[][] = [
      [],
      [0],
      [255],
      [1, 2, 3, 4, 5],
      [0, 0, 0, 0],
      [255, 254, 253, 252, 251, 250],
    ];
    for (const bytes of cases) {
      const encoded = base32Encode(new Uint8Array(bytes));
      const decoded = Array.from(base32Decode(encoded));
      expect(decoded).toEqual(bytes);
    }
  });

  test('decodes a known RFC 4648 test vector', () => {
    // "foobar" -> MZXW6YTBOI======  (padding stripped by our decoder either way)
    const bytes = Array.from(base32Decode('MZXW6YTBOI'));
    const text = String.fromCharCode(...bytes);
    expect(text).toBe('foobar');
  });

  test('is case-insensitive and tolerates surrounding whitespace', () => {
    const upper = base32Decode('MZXW6YTBOI');
    const lower = base32Decode(' mzxw6ytboi ');
    expect(Array.from(lower)).toEqual(Array.from(upper));
  });

  test('ignores "=" padding', () => {
    const withPadding = base32Decode('MZXW6YTBOI======');
    const withoutPadding = base32Decode('MZXW6YTBOI');
    expect(Array.from(withPadding)).toEqual(Array.from(withoutPadding));
  });

  test('rejects invalid characters', () => {
    expect(() => base32Decode('!!!!')).toThrow();
  });
});
