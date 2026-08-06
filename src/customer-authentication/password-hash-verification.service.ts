import { timingSafeEqual, pbkdf2Sync, scryptSync } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PasswordHashAlgorithm } from './customer-authentication.enums';

export type PasswordVerificationFailure = 'MALFORMED_HASH' | 'UNSUPPORTED_ALGORITHM' | 'MISMATCH';

export interface PasswordVerificationResult {
  verified: boolean;
  failure?: PasswordVerificationFailure;
}

const MAX_PBKDF2_ITERATIONS = 5_000_000;
const MIN_PBKDF2_ITERATIONS = 10_000;
const MIN_SCRYPT_COST = 1 << 10;
const MAX_SCRYPT_COST = 1 << 20;
const MAX_SCRYPT_BLOCK_SIZE = 32;
const MAX_SCRYPT_PARALLELIZATION = 16;

@Injectable()
export class PasswordHashVerificationService {
  verify(
    password: string,
    algorithm: PasswordHashAlgorithm,
    encodedHash: string,
  ): PasswordVerificationResult {
    if (typeof password !== 'string' || password.length === 0) {
      return { verified: false, failure: 'MISMATCH' };
    }
    if (typeof encodedHash !== 'string' || encodedHash.length === 0) {
      return { verified: false, failure: 'MALFORMED_HASH' };
    }

    try {
      switch (algorithm) {
        case PasswordHashAlgorithm.PBKDF2:
          return this.verifyPbkdf2(password, encodedHash);
        case PasswordHashAlgorithm.SCRYPT:
          return this.verifyScrypt(password, encodedHash);
        case PasswordHashAlgorithm.ARGON2ID:
        case PasswordHashAlgorithm.BCRYPT:
          return { verified: false, failure: 'UNSUPPORTED_ALGORITHM' };
        default:
          return { verified: false, failure: 'UNSUPPORTED_ALGORITHM' };
      }
    } catch {
      return { verified: false, failure: 'MALFORMED_HASH' };
    }
  }

  private verifyPbkdf2(password: string, encodedHash: string): PasswordVerificationResult {
    const parts = encodedHash.split('$');
    if (parts.length !== 5 || parts[0]?.toUpperCase() !== 'PBKDF2') {
      return { verified: false, failure: 'MALFORMED_HASH' };
    }

    const digestName = parts[1]?.toLowerCase();
    if (digestName !== 'sha256' && digestName !== 'sha512') {
      return { verified: false, failure: 'MALFORMED_HASH' };
    }
    const iterations = this.parseInteger(parts[2]);
    if (
      iterations === undefined ||
      iterations < MIN_PBKDF2_ITERATIONS ||
      iterations > MAX_PBKDF2_ITERATIONS
    ) {
      return { verified: false, failure: 'MALFORMED_HASH' };
    }

    const salt = this.decodeBase64Url(parts[3]);
    const expected = this.decodeBase64Url(parts[4]);
    if (!salt || !expected || expected.length === 0) {
      return { verified: false, failure: 'MALFORMED_HASH' };
    }

    const derived = pbkdf2Sync(password, salt, iterations, expected.length, digestName);
    return this.compare(derived, expected);
  }

  private verifyScrypt(password: string, encodedHash: string): PasswordVerificationResult {
    const parts = encodedHash.split('$');
    if (parts.length !== 6 || parts[0]?.toUpperCase() !== 'SCRYPT') {
      return { verified: false, failure: 'MALFORMED_HASH' };
    }

    const cost = this.parseInteger(parts[1]);
    const blockSize = this.parseInteger(parts[2]);
    const parallelization = this.parseInteger(parts[3]);
    if (
      cost === undefined ||
      blockSize === undefined ||
      parallelization === undefined ||
      cost < MIN_SCRYPT_COST ||
      cost > MAX_SCRYPT_COST ||
      !this.isPowerOfTwo(cost) ||
      blockSize < 1 ||
      blockSize > MAX_SCRYPT_BLOCK_SIZE ||
      parallelization < 1 ||
      parallelization > MAX_SCRYPT_PARALLELIZATION
    ) {
      return { verified: false, failure: 'MALFORMED_HASH' };
    }

    const salt = this.decodeBase64Url(parts[4]);
    const expected = this.decodeBase64Url(parts[5]);
    if (!salt || !expected || expected.length === 0) {
      return { verified: false, failure: 'MALFORMED_HASH' };
    }

    const minimumMemory = 128 * cost * blockSize + 1024;
    const derived = scryptSync(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: Math.max(32 * 1024 * 1024, minimumMemory),
    });
    return this.compare(derived, expected);
  }

  private compare(actual: Buffer, expected: Buffer): PasswordVerificationResult {
    if (actual.length !== expected.length) {
      return { verified: false, failure: 'MISMATCH' };
    }
    return timingSafeEqual(actual, expected)
      ? { verified: true }
      : { verified: false, failure: 'MISMATCH' };
  }

  private parseInteger(value: string | undefined): number | undefined {
    if (!value || !/^\d+$/.test(value)) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  private decodeBase64Url(value: string | undefined): Buffer | undefined {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
      return undefined;
    }
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length > 0 ? decoded : undefined;
  }

  private isPowerOfTwo(value: number): boolean {
    return (value & (value - 1)) === 0;
  }
}
