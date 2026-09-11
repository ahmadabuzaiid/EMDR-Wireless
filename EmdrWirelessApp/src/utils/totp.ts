import { hmac } from '@noble/hashes/hmac.js';
// sha1 lives under "legacy" in @noble/hashes v2+ (considered legacy/insecure for new
// designs) - it's still exactly what RFC 6238 / every authenticator app expects here.
import { sha1 } from '@noble/hashes/legacy.js';
import { base32Decode } from './base32';

// RFC 6238 TOTP: SHA1, 30s period, 6 digits - the defaults every
// authenticator app (Bitwarden, Google Authenticator, Proton) assumes.
const PERIOD_SECONDS = 30;
const DIGITS = 6;

function counterToBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  // JS numbers are safe integers well past any realistic counter value here,
  // so a plain division/modulo per byte is enough - no BigInt needed.
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

function generateTotpForCounter(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const digest = hmac(sha1, key, counterToBytes(counter));

  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
  return otp;
}

export function generateTotp(secretBase32: string, timestampMs: number = Date.now()): string {
  const counter = Math.floor(timestampMs / 1000 / PERIOD_SECONDS);
  return generateTotpForCounter(secretBase32, counter);
}

// Accepts a code generated one step before/after "now" to tolerate normal
// clock drift between the phone and the authenticator app - standard TOTP practice.
export function verifyTotp(
  code: string,
  secretBase32: string,
  timestampMs: number = Date.now(),
  windowSteps: number = 1,
): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;

  const counter = Math.floor(timestampMs / 1000 / PERIOD_SECONDS);
  for (let errorWindow = -windowSteps; errorWindow <= windowSteps; errorWindow++) {
    if (generateTotpForCounter(secretBase32, counter + errorWindow) === normalized) {
      return true;
    }
  }
  return false;
}
