import type { ConfigService } from '@nestjs/config';
import {
  KycCredentialEncryptionError,
  KycProviderSecretEncryptionService,
} from '../src/kyc-verification/kyc-provider-secret-encryption.service';

type KeyringConfig = { json: string | undefined; active: string | undefined };

function encryptionService(values: KeyringConfig): KycProviderSecretEncryptionService {
  const config = {
    get: (name: string) =>
      name === 'KYC_PROVIDER_ENCRYPTION_KEYRING_JSON'
        ? values.json
        : name === 'KYC_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION'
          ? values.active
          : undefined,
  } as unknown as ConfigService;
  return new KycProviderSecretEncryptionService(config);
}

const base64Key = (byte: number) => Buffer.alloc(32, byte).toString('base64');

describe('KYC provider credential encryption keyring', () => {
  it('AES-GCM encrypts and authenticates a credential with environment-bound associated data', () => {
    const key = base64Key(7);
    const service = encryptionService({ json: JSON.stringify({ v1: key }), active: 'v1' });
    const encrypted = service.encrypt('synthetic-prem-bly-api-key', 'sandbox');

    expect(encrypted.envelope).toMatch(/^MNKPS1:v1:/);
    expect(encrypted.envelope).not.toContain('synthetic-prem-bly-api-key');
    expect(encrypted.fingerprint).toBe('****-key');
    expect(service.decrypt(encrypted.envelope, 'sandbox', encrypted.keyVersion)).toBe(
      'synthetic-prem-bly-api-key',
    );
    expect(() => service.decrypt(encrypted.envelope, 'production', encrypted.keyVersion)).toThrow(
      KycCredentialEncryptionError,
    );
  });

  it('retains old key versions for decryption while new credentials use the active version', () => {
    const old = base64Key(8);
    const active = base64Key(9);
    const oldService = encryptionService({ json: JSON.stringify({ v1: old }), active: 'v1' });
    const oldEnvelope = oldService.encrypt('synthetic-old-credential-123', 'production');
    const rotatedService = encryptionService({
      json: JSON.stringify({ v1: old, v2: active }),
      active: 'v2',
    });

    expect(rotatedService.decrypt(oldEnvelope.envelope, 'production', 'v1')).toBe(
      'synthetic-old-credential-123',
    );
    expect(rotatedService.encrypt('synthetic-new-credential-456', 'production').keyVersion).toBe(
      'v2',
    );
    expect(() => rotatedService.decrypt(oldEnvelope.envelope, 'production', 'v2')).toThrow(
      KycCredentialEncryptionError,
    );
  });

  it('fails closed when the keyring is missing, malformed, or lacks the active version', () => {
    for (const service of [
      encryptionService({ json: undefined, active: 'v1' }),
      encryptionService({ json: '{not-json', active: 'v1' }),
      encryptionService({ json: JSON.stringify({ v1: 'not-base64-key' }), active: 'v1' }),
      encryptionService({ json: JSON.stringify({ v1: base64Key(1) }), active: 'v2' }),
    ]) {
      expect(service.status().available).toBe(false);
      expect(() => service.encrypt('synthetic-credential-123', 'sandbox')).toThrow(
        KycCredentialEncryptionError,
      );
    }
  });

  it('rejects invalid plaintext before encryption', () => {
    const service = encryptionService({ json: JSON.stringify({ v1: base64Key(2) }), active: 'v1' });
    for (const credential of ['', 'short', 'synthetic-credential\nline']) {
      expect(() => service.encrypt(credential, 'sandbox')).toThrow(KycCredentialEncryptionError);
    }
  });
});
