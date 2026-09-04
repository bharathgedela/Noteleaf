import { describe, expect, it } from 'vitest';
import { createVaultSalt, decryptVaultPayload, deriveVaultKey, encryptVaultPayload, verifyVaultKey, vaultVerifier } from './crypto.js';

describe('page vault cryptography', () => {
  it('encrypts and authenticates page data with a derived key', async () => {
    const key = await deriveVaultKey('correct horse battery staple', createVaultSalt());
    const encrypted = encryptVaultPayload(JSON.stringify({ title: 'Accounts', markdown: 'secret' }), key, 'page-1');
    expect(encrypted).not.toContain('Accounts');
    expect(decryptVaultPayload(encrypted, key, 'page-1')).toContain('Accounts');
    expect(() => decryptVaultPayload(encrypted, key, 'page-2')).toThrow();
  });

  it('validates a password-derived key without storing the password', async () => {
    const salt = createVaultSalt();
    const correct = await deriveVaultKey('a strong password', salt);
    const wrong = await deriveVaultKey('the wrong password', salt);
    const verifier = vaultVerifier(correct);
    expect(verifyVaultKey(correct, verifier)).toBe(true);
    expect(verifyVaultKey(wrong, verifier)).toBe(false);
  });
});
