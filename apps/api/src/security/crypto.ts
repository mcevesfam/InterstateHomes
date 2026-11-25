import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function getEncryptionKey(): Buffer {
  const configured = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!configured) {
    const allowFallback =
      process.env.DEMO_MODE === 'true' ||
      process.env.NODE_ENV === 'test' ||
      (!process.env.DATABASE_URL?.trim() && process.env.NODE_ENV !== 'production');
    if (!allowFallback) {
      throw new Error('APP_ENCRYPTION_KEY must be configured when running in Postgres/production mode.');
    }
  }
  const raw =
    configured ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (storedBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(storedBuf, derived);
}

export function encryptSensitive(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSensitive(ciphertext: string): string {
  const [ivB64, tagB64, dataB64] = ciphertext.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload');
  }
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** Masks a W-9 SSN/EIN everywhere in UI, lists, exports, and emails (Section 4.3 & 8.2). */
export function maskTin(tin: string): { masked: string; last4: string } {
  const digits = tin.replace(/\D/g, '');
  const last4 = digits.slice(-4).padStart(4, '*');
  return {
    masked: `***-**-${last4}`,
    last4,
  };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function generateTotpCode(secret: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff)) %
    1_000_000;
  return String(code).padStart(6, '0');
}

export function verifyTotpToken(
  secret: string,
  token: string,
  timestampMs = Date.now(),
  windowSteps = 1
): boolean {
  const normalized = token.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const candidate = generateTotpCode(secret, timestampMs + delta * 30_000);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))) {
      return true;
    }
  }
  return false;
}
