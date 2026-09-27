import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from './crypto';

const key = randomBytes(32).toString('base64');

describe('encryptSecret / decryptSecret', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const b = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects tampered ciphertext', () => {
    const payload = encryptSecret('secret', key);
    const parts = payload.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    const payload = encryptSecret('secret', key);
    expect(() => decryptSecret(payload, randomBytes(32).toString('base64'))).toThrow();
  });
});

describe('helpers', () => {
  it('produces url-safe tokens and stable hashes', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
