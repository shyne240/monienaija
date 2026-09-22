import { BadRequestException } from '@nestjs/common';

import { PasswordHashVerificationService } from '../src/customer-authentication/password-hash-verification.service';
import { PasswordHashAlgorithm } from '../src/customer-authentication/customer-authentication.enums';
import { PinHashService } from '../src/customer-authentication/pin-hash.service';

describe('PinHashService', () => {
  const pinHashService = new PinHashService();
  const verifier = new PasswordHashVerificationService();

  it('generates a PBKDF2-SHA512 hash with server-controlled parameters', () => {
    const { encodedHash, algorithm, iterations } = pinHashService.hashPin('13579');
    expect(algorithm).toBe('PBKDF2');
    expect(iterations).toBeGreaterThanOrEqual(10_000);
    const parts = encodedHash.split('$');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('PBKDF2');
    expect(parts[1]).toBe('sha512');
    expect(parts[2]).toBe(String(iterations));
    expect(encodedHash.length).toBeLessThanOrEqual(512);
  });

  it('verifies the correct PIN through the existing constant-time verifier', () => {
    const { encodedHash } = pinHashService.hashPin('2468');
    const result = verifier.verify('2468', PasswordHashAlgorithm.PBKDF2, encodedHash);
    expect(result.verified).toBe(true);
    expect(result.failure).toBeUndefined();
  });

  it('rejects an incorrect PIN', () => {
    const { encodedHash } = pinHashService.hashPin('2468');
    const result = verifier.verify('2469', PasswordHashAlgorithm.PBKDF2, encodedHash);
    expect(result.verified).toBe(false);
    expect(result.failure).toBe('MISMATCH');
  });

  it('fails closed on a malformed stored hash', () => {
    expect(verifier.verify('2468', PasswordHashAlgorithm.PBKDF2, 'not-a-hash').verified).toBe(
      false,
    );
    expect(
      verifier.verify('2468', PasswordHashAlgorithm.PBKDF2, 'PBKDF2$sha512$5$aa$bb').verified,
    ).toBe(false);
    expect(
      verifier.verify('2468', PasswordHashAlgorithm.PBKDF2, 'MD5$sha512$210000$aa$bb').verified,
    ).toBe(false);
    expect(verifier.verify('2468', PasswordHashAlgorithm.PBKDF2, '').verified).toBe(false);
  });

  it('produces non-matching verification for different PINs and random salts', () => {
    const first = pinHashService.hashPin('1357');
    const second = pinHashService.hashPin('1357');
    expect(first.encodedHash).not.toBe(second.encodedHash); // random salt per PIN
    for (const candidate of [first, second]) {
      expect(
        verifier.verify('1357', PasswordHashAlgorithm.PBKDF2, candidate.encodedHash).verified,
      ).toBe(true);
      expect(
        verifier.verify('1358', PasswordHashAlgorithm.PBKDF2, candidate.encodedHash).verified,
      ).toBe(false);
    }
  });

  it('never contains the plaintext PIN in the generated hash', () => {
    const pin = '000000'; // worst case: all-zero PIN must not appear verbatim
    const { encodedHash } = pinHashService.hashPin(pin);
    expect(encodedHash).not.toContain(pin);
    const pin2 = '4321';
    expect(pinHashService.hashPin(pin2).encodedHash).not.toContain(pin2);
  });

  it('rejects malformed PINs before hashing', () => {
    for (const malformed of ['', '123', '1234567', '12a4', '12.4', 'ab12', '①②③④']) {
      expect(() => pinHashService.hashPin(malformed)).toThrow(BadRequestException);
    }
    expect(() => pinHashService.hashPin(undefined as unknown as string)).toThrow(
      BadRequestException,
    );
  });

  it('accepts the full 4-6 digit policy range', () => {
    for (const pin of ['1234', '12345', '123456', '0000']) {
      expect(pinHashService.normalizePin(pin)).toBe(pin);
    }
    expect(pinHashService.normalizePin(' 1234 ')).toBe('1234');
  });
});
