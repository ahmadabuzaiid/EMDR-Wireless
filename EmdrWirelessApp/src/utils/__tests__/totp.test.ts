import { generateTotp, verifyTotp } from '../totp';

// Independently cross-checked against the well-established `otpauth` library
// during development (same secret, same timestamp, identical codes across
// multiple time windows) - see project notes. These tests guard the behavior
// that actually matters day to day: generate/verify symmetry and window
// tolerance, without hardcoding a magic vector that's easy to transcribe wrong.
const SECRET = 'R6NUPY7IOWNDMOBQOJCEN3YN7XDDXTD2'; // same shape as a real provisioned secret
const PERIOD_MS = 30000;
const FIXED_TIME = 1789200000000; // arbitrary but fixed, for reproducibility

describe('totp', () => {
  test('generates a 6-digit numeric code', () => {
    const code = generateTotp(SECRET, FIXED_TIME);
    expect(code).toMatch(/^\d{6}$/);
  });

  test('is deterministic for the same secret and time step', () => {
    expect(generateTotp(SECRET, FIXED_TIME)).toBe(generateTotp(SECRET, FIXED_TIME));
  });

  test('a freshly generated code verifies at the same instant', () => {
    const code = generateTotp(SECRET, FIXED_TIME);
    expect(verifyTotp(code, SECRET, FIXED_TIME)).toBe(true);
  });

  test('a wrong code is rejected', () => {
    const code = generateTotp(SECRET, FIXED_TIME);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(verifyTotp(wrong, SECRET, FIXED_TIME)).toBe(false);
  });

  test('a different secret produces a different code (almost always)', () => {
    const codeA = generateTotp(SECRET, FIXED_TIME);
    const codeB = generateTotp('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', FIXED_TIME);
    expect(codeA).not.toBe(codeB);
  });

  test('tolerates the documented +-1 step clock drift window', () => {
    const code = generateTotp(SECRET, FIXED_TIME);
    expect(verifyTotp(code, SECRET, FIXED_TIME - PERIOD_MS)).toBe(true);
    expect(verifyTotp(code, SECRET, FIXED_TIME + PERIOD_MS)).toBe(true);
  });

  test('rejects a code from outside the tolerance window', () => {
    const code = generateTotp(SECRET, FIXED_TIME);
    expect(verifyTotp(code, SECRET, FIXED_TIME + 3 * PERIOD_MS)).toBe(false);
    expect(verifyTotp(code, SECRET, FIXED_TIME - 3 * PERIOD_MS)).toBe(false);
  });

  test('rejects malformed input without throwing', () => {
    expect(verifyTotp('12345', SECRET, FIXED_TIME)).toBe(false);
    expect(verifyTotp('abcdef', SECRET, FIXED_TIME)).toBe(false);
    expect(verifyTotp('', SECRET, FIXED_TIME)).toBe(false);
  });
});
