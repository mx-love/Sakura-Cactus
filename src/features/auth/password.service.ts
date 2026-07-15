import {
  PASSWORD_HASH_ALGORITHM,
  PASSWORD_HASH_BYTES,
  PASSWORD_HASH_ITERATIONS,
  PASSWORD_SALT_BYTES
} from './auth.constants';
import { base64UrlToBytes, bytesToBase64Url, constantTimeEqual, randomBytes } from './crypto.service';

const TEXT_ENCODER = new TextEncoder();

async function derivePasswordBytes(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    },
    keyMaterial,
    PASSWORD_HASH_BYTES * 8
  );

  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = await derivePasswordBytes(password, salt, PASSWORD_HASH_ITERATIONS);

  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_ITERATIONS.toString(),
    bytesToBase64Url(salt),
    bytesToBase64Url(hash)
  ].join('$');
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, hashValue] = storedHash.split('$');

  if (algorithm !== PASSWORD_HASH_ALGORITHM || !iterationsValue || !saltValue || !hashValue) {
    return false;
  }

  const iterations = Number.parseInt(iterationsValue, 10);

  if (!Number.isSafeInteger(iterations) || iterations < 100_000) {
    return false;
  }

  try {
    const salt = base64UrlToBytes(saltValue);
    const expectedHash = base64UrlToBytes(hashValue);
    const actualHash = await derivePasswordBytes(password, salt, iterations);

    return constantTimeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}
