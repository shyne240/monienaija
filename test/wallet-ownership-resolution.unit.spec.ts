/**
 * Unit coverage for the governed wallet-ownership resolution contract: server-side payload
 * normalization (an unsupported/unauthorized ownership change never reaches the database), the
 * deterministic fingerprint's payload binding, executor entitlement, and the mapping of the
 * database ownership guard's refusals onto API conflicts.
 *
 * The end-to-end maker-checker, evidence, atomicity, concurrency and canonical-uniqueness
 * behaviour is proven against real PostgreSQL in
 * `test/wallet-ownership-resolution.integration.spec.ts`; nothing here is a substitute for it.
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { DataSource } from 'typeorm';
import {
  WalletOwnershipResolutionService,
  walletOwnershipGuardError,
  walletOwnershipResolutionFingerprint,
} from '../src/wallet/wallet-ownership-resolution.service';
import {
  WalletOwnershipEvidenceType,
  WalletOwnershipResolutionClass,
} from '../src/wallet/wallet-ownership-resolution.enums';

const WALLET_ID = '00000000-0000-4000-8000-0000000000a1';
const TARGET_ID = '00000000-0000-4000-8000-0000000000b2';

function principal(overrides: Partial<AuthorizationPrincipal> = {}): AuthorizationPrincipal {
  return {
    type: 'OPERATOR',
    principalId: 'operator-1',
    roles: ['FINANCE_PREPARER'],
    scopes: ['finance:prepare'],
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
    ...overrides,
  };
}

/** The service rejects invalid input before it touches the database, so no data source is needed. */
const service = new WalletOwnershipResolutionService({} as DataSource, {} as never, {} as never);

describe('wallet ownership resolution — request normalization', () => {
  const base = {
    principal: principal(),
    walletId: WALLET_ID,
    resolutionClass: WalletOwnershipResolutionClass.CUSTOMER,
    targetOwnerId: TARGET_ID,
    evidenceType: WalletOwnershipEvidenceType.CUSTOMER_RECORD_REFERENCE,
    evidenceReference: 'customer-reference',
    reason: 'reconciliation',
  };

  it('refuses a non-UUID wallet id', async () => {
    await expect(service.requestResolution({ ...base, walletId: 'not-a-uuid' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('never accepts REVIEW as a resolution target', async () => {
    await expect(
      service.requestResolution({ ...base, resolutionClass: 'REVIEW' as never }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses evidence that cannot support the requested class', async () => {
    await expect(
      service.requestResolution({
        ...base,
        evidenceType: WalletOwnershipEvidenceType.AGENT_RECORD_REFERENCE,
      }),
    ).rejects.toThrow(/cannot support/);
    await expect(
      service.requestResolution({
        ...base,
        resolutionClass: WalletOwnershipResolutionClass.SYSTEM,
        systemOwnerCode: 'PLATFORM_LEGACY',
        evidenceType: WalletOwnershipEvidenceType.CUSTOMER_RECORD_REFERENCE,
      }),
    ).rejects.toThrow(/cannot support/);
  });

  it('requires a canonical target UUID for CUSTOMER/AGENT and forbids one for SYSTEM', async () => {
    await expect(service.requestResolution({ ...base, targetOwnerId: 'abc' })).rejects.toThrow(
      /canonical UUID/,
    );
    await expect(
      service.requestResolution({
        ...base,
        resolutionClass: WalletOwnershipResolutionClass.SYSTEM,
        systemOwnerCode: 'PLATFORM_SUSPENSE',
        evidenceType: WalletOwnershipEvidenceType.ZERO_LEDGER_ACTIVITY,
      }),
    ).rejects.toThrow(/cannot name a customer or agent owner/);
    await expect(
      service.requestResolution({
        ...base,
        systemOwnerCode: 'PLATFORM_SUSPENSE',
      }),
    ).rejects.toThrow(/only valid for a SYSTEM resolution/);
    await expect(
      service.requestResolution({
        ...base,
        resolutionClass: WalletOwnershipResolutionClass.SYSTEM,
        targetOwnerId: undefined,
        evidenceType: WalletOwnershipEvidenceType.ZERO_LEDGER_ACTIVITY,
      }),
    ).rejects.toThrow(/systemOwnerCode/);
  });

  it('bounds the evidence reference and reason', async () => {
    await expect(service.requestResolution({ ...base, evidenceReference: '   ' })).rejects.toThrow(
      /evidenceReference/,
    );
    await expect(
      service.requestResolution({ ...base, evidenceReference: 'x'.repeat(161) }),
    ).rejects.toThrow(/evidenceReference/);
    await expect(service.requestResolution({ ...base, reason: 'x'.repeat(501) })).rejects.toThrow(
      /reason/,
    );
  });
});

describe('wallet ownership resolution — fingerprint binding', () => {
  const fingerprint = () =>
    walletOwnershipResolutionFingerprint(
      WALLET_ID,
      'CUSTOMER',
      TARGET_ID,
      null,
      'CUSTOMER_RECORD_REFERENCE',
      'customer-reference',
      'reconciliation',
    );

  it('is a deterministic SHA-256 of the actual payload', () => {
    expect(fingerprint()).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint()).toBe(fingerprint());
  });

  it('changes when any part of the approved payload changes', () => {
    const baseline = fingerprint();
    expect(
      walletOwnershipResolutionFingerprint(
        '00000000-0000-4000-8000-0000000000c3',
        'CUSTOMER',
        TARGET_ID,
        null,
        'CUSTOMER_RECORD_REFERENCE',
        'customer-reference',
        'reconciliation',
      ),
    ).not.toBe(baseline);
    expect(
      walletOwnershipResolutionFingerprint(
        WALLET_ID,
        'AGENT',
        TARGET_ID,
        null,
        'CUSTOMER_RECORD_REFERENCE',
        'customer-reference',
        'reconciliation',
      ),
    ).not.toBe(baseline);
    expect(
      walletOwnershipResolutionFingerprint(
        WALLET_ID,
        'CUSTOMER',
        '00000000-0000-4000-8000-0000000000d4',
        null,
        'CUSTOMER_RECORD_REFERENCE',
        'customer-reference',
        'reconciliation',
      ),
    ).not.toBe(baseline);
    expect(
      walletOwnershipResolutionFingerprint(
        WALLET_ID,
        'CUSTOMER',
        TARGET_ID,
        null,
        'CUSTOMER_FINANCIAL_ACCOUNT_BINDING',
        'customer-reference',
        'reconciliation',
      ),
    ).not.toBe(baseline);
    expect(
      walletOwnershipResolutionFingerprint(
        WALLET_ID,
        'CUSTOMER',
        TARGET_ID,
        null,
        'CUSTOMER_RECORD_REFERENCE',
        'other-reference',
        'reconciliation',
      ),
    ).not.toBe(baseline);
    expect(
      walletOwnershipResolutionFingerprint(
        WALLET_ID,
        'CUSTOMER',
        TARGET_ID,
        null,
        'CUSTOMER_RECORD_REFERENCE',
        'customer-reference',
        'different reason',
      ),
    ).not.toBe(baseline);
  });
});

describe('wallet ownership resolution — execution entitlement', () => {
  it('allows only an MFA, non-read-only FINANCE_CONTROLLER or privileged:execute principal', () => {
    expect(() =>
      service.assertExecuteEntitled(
        principal({ roles: ['FINANCE_CONTROLLER'], scopes: ['privileged:approve'] }),
      ),
    ).not.toThrow();
    expect(() =>
      service.assertExecuteEntitled(principal({ roles: [], scopes: ['privileged:execute'] })),
    ).not.toThrow();

    for (const denied of [
      principal({ roles: ['FINANCE_PREPARER'] }),
      principal({
        roles: ['FINANCE_CONTROLLER'],
        scopes: ['privileged:approve'],
        assuranceLevel: 'PASSWORD',
      }),
      principal({
        roles: ['FINANCE_CONTROLLER'],
        scopes: ['privileged:approve'],
        readOnlyPrincipal: true,
      }),
      principal({ type: 'SUPPORT', roles: ['FINANCE_CONTROLLER'], scopes: ['privileged:approve'] }),
      principal({
        type: 'CUSTOMER',
        roles: ['FINANCE_CONTROLLER'],
        scopes: ['privileged:approve'],
      }),
    ]) {
      expect(() => service.assertExecuteEntitled(denied)).toThrow(ForbiddenException);
    }
  });
});

describe('wallet ownership resolution — database guard mapping', () => {
  const driverError = (code: string, message: string) =>
    Object.assign(new Error(message), { code, message });

  it('maps a canonical ownership collision (23505) to a conflict', () => {
    const mapped = walletOwnershipGuardError(
      new QueryFailedError('INSERT', [], driverError('23505', 'duplicate key') as never),
    );
    expect(mapped).toBeInstanceOf(ConflictException);
  });

  it('maps guard refusals (23514/55000) to a conflict carrying the database reason', () => {
    const mapped = walletOwnershipGuardError(
      new QueryFailedError(
        'UPDATE',
        [],
        driverError('55000', 'Wallet ownership changes require a governed resolution') as never,
      ),
    ) as Error;
    expect(mapped).toBeInstanceOf(ConflictException);
    expect(mapped.message).toMatch(/governed resolution/);
  });

  it('leaves unrelated errors untouched', () => {
    const original = new Error('boom');
    expect(walletOwnershipGuardError(original)).toBe(original);
  });
});
