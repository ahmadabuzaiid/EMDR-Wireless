import { bytesToBase64, byteToBase64, base64ToBytes } from '../base64';

describe('base64', () => {
  test('round-trips arbitrary byte sequences of every length mod 3', () => {
    const cases: number[][] = [
      [],
      [1],
      [1, 2],
      [1, 2, 3],
      [1, 2, 3, 4],
      [1, 2, 3, 4, 5],
      [0, 255, 128, 42, 200, 7],
    ];
    for (const bytes of cases) {
      const encoded = bytesToBase64(bytes);
      expect(base64ToBytes(encoded)).toEqual(bytes);
    }
  });

  test('byteToBase64 matches bytesToBase64 for a single byte', () => {
    for (const value of [0, 1, 40, 150, 200, 255]) {
      expect(byteToBase64(value)).toBe(bytesToBase64([value]));
    }
  });

  test('matches a known encoding', () => {
    // "Man" -> "TWFu" is the canonical base64 worked example
    const bytes = [0x4d, 0x61, 0x6e];
    expect(bytesToBase64(bytes)).toBe('TWFu');
    expect(base64ToBytes('TWFu')).toEqual(bytes);
  });

  test('this is exactly the payload shape the BLE protocol sends', () => {
    // [PROTOCOL_VERSION, r, g, b] - the LED color write payload
    const payload = [1, 255, 0, 128];
    const roundTripped = base64ToBytes(bytesToBase64(payload));
    expect(roundTripped).toEqual(payload);
  });
});
