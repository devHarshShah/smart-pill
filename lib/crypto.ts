import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14;
const DEFAULT_AUTH_SECRET = 'dev-only-secret-change-in-production';

function getAuthSecret() {
  return process.env.AUTH_SECRET ?? DEFAULT_AUTH_SECRET;
}

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function hmacSha256(data: string, secret: string) {
  return createHmac('sha256', secret).update(data).digest();
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hashed = scryptSync(password, salt, 64);
  return `${base64UrlEncode(salt)}.${base64UrlEncode(hashed)}`;
}

export function verifyPassword(password: string, passwordHash: string) {
  const [saltPart, hashPart] = passwordHash.split('.');
  if (!saltPart || !hashPart) {
    return false;
  }

  const salt = base64UrlDecode(saltPart);
  const expectedHash = base64UrlDecode(hashPart);
  const candidateHash = scryptSync(password, salt, expectedHash.length);

  return timingSafeEqual(expectedHash, candidateHash);
}

export function createUserToken(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(hmacSha256(encodedPayload, getAuthSecret()));

  return `${encodedPayload}.${signature}`;
}

export function verifyUserToken(token: string): { userId: string } | null {
  const [encodedPayload, signaturePart] = token.split('.');
  if (!encodedPayload || !signaturePart) {
    return null;
  }

  const expectedSignature = base64UrlEncode(hmacSha256(encodedPayload, getAuthSecret()));
  const sigA = Buffer.from(signaturePart);
  const sigB = Buffer.from(expectedSignature);

  if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
    return null;
  }

  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8')) as {
      sub?: string;
      exp?: number;
    };
  } catch {
    return null;
  }

  if (!payload.sub || !payload.exp) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return null;
  }

  return { userId: payload.sub };
}

export function generateId() {
  return randomUUID();
}

export function generatePairCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}
