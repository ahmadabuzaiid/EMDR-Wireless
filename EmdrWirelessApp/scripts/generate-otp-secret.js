#!/usr/bin/env node
// One-off dev utility: generates a random TOTP secret and writes/updates .env.
// This script runs in plain Node (not shipped in the app), so it's fine to use
// Node's built-in crypto here even though the app itself can't.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += ALPHABET[(value >> bits) & 31];
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

const secret = base32Encode(crypto.randomBytes(20)); // 160-bit secret, standard for SHA1 TOTP
const issuer = 'EMDR Therapy Kits';
const account = 'activation';
const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
  `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

const envPath = path.join(__dirname, '..', '.env');
const envContents = `OTP_SECRET=${secret}\n`;
fs.writeFileSync(envPath, envContents);

console.log('Wrote a new random OTP_SECRET to .env');
console.log('');
console.log('Secret (base32):', secret);
console.log('');
console.log('To add it to Bitwarden (or Google Authenticator / Proton), either scan a QR');
console.log('code generated from the URI below, or manually add a TOTP item with this secret,');
console.log('SHA1, 6 digits, 30s period:');
console.log('');
console.log(otpauthUri);
console.log('');
console.log('Re-run this script any time to rotate the secret - it overwrites .env.');
