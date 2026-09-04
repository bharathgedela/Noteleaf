import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
const KEY_BYTES = 32;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const VERIFIER_CONTEXT = 'noteleaf-vault-verifier-v1';

export interface EncryptedEnvelope {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function createVaultSalt(): string {
  return randomBytes(16).toString('base64');
}

export async function deriveVaultKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, Buffer.from(salt, 'base64'), KEY_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}

export function vaultVerifier(key: Buffer): string {
  return createHmac('sha256', key).update(VERIFIER_CONTEXT).digest('base64');
}

export function verifyVaultKey(key: Buffer, verifier: string): boolean {
  const expected = Buffer.from(verifier, 'base64');
  const actual = Buffer.from(vaultVerifier(key), 'base64');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function encryptVaultPayload(plaintext: string, key: Buffer, associatedData: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return JSON.stringify(envelope);
}

export function decryptVaultPayload(encrypted: string, key: Buffer, associatedData: string): string {
  const envelope = JSON.parse(encrypted) as Partial<EncryptedEnvelope>;
  if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.ciphertext) throw new Error('Encrypted page data is invalid');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
