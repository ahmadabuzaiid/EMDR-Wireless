// react-native-ble-plx writes/reads characteristic values as base64 strings.
// Small self-contained encoder/decoder so we don't need an extra polyfill dependency.
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: number[] | Uint8Array): string {
  let output = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output +=
      CHARS[(chunk >> 18) & 63] +
      CHARS[(chunk >> 12) & 63] +
      CHARS[(chunk >> 6) & 63] +
      CHARS[chunk & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    output += CHARS[(chunk >> 18) & 63] + CHARS[(chunk >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    output += CHARS[(chunk >> 18) & 63] + CHARS[(chunk >> 12) & 63] + CHARS[(chunk >> 6) & 63] + '=';
  }
  return output;
}

export function byteToBase64(byte: number): string {
  return bytesToBase64([byte & 0xff]);
}

export function base64ToBytes(base64: string): number[] {
  const clean = base64.replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of clean) {
    const idx = CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  return bytes;
}
