import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { LedgerAccount } from '../ledger/ledger-account.entity';
import { CommercialAccountingFamilyRole } from './commercial-accounting.enums';
import { CommercialAccountingRegistryEntry } from './commercial-accounting-registry.entity';

/**
 * Stable, machine-readable blocker for the fail-closed accounting path (DP-15=A).
 * Any error of this class aborts the surrounding flow transaction: the journal, the snapshot,
 * the commercial state and the accounting legs roll back atomically — never a successful
 * financial transaction with missing required accounting.
 */
export class CommercialAccountingBlockedError extends UnprocessableEntityException {
  constructor(
    public readonly blockerCode: string,
    detail: string,
  ) {
    super({ error: blockerCode, message: detail });
  }
}

/**
 * Registry ↔ account-code map for the four families the approved decisions require.
 * Codes follow the existing convention (FINANCE-<ROLE>-<CURRENCY> after the AR-control
 * precedent `FINANCE-ACCOUNTS_RECEIVABLE-NGN`); each row is seeded by migration
 * 1785753600076 together with its governance evidence. No existing settlement/clearing/
 * suspense/unclaimed/wallet account is repurposed (A5 contract line 143).
 */
export const COMMERCIAL_ACCOUNTING_ACCOUNT_CODES: Record<CommercialAccountingFamilyRole, string> = {
  [CommercialAccountingFamilyRole.FEE_REVENUE]: 'FINANCE-FEE_REVENUE-NGN',
  [CommercialAccountingFamilyRole.VAT_PAYABLE]: 'FINANCE-VAT_PAYABLE-NGN',
  [CommercialAccountingFamilyRole.COMMISSION_EXPENSE]: 'FINANCE-COMMISSION_EXPENSE-NGN',
  [CommercialAccountingFamilyRole.COMMISSION_PAYABLE]: 'FINANCE-COMMISSION_PAYABLE-NGN',
};

/**
 * V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — DP-31=A runtime governance evidence gate.
 *
 * Resolves the ledger account for a family role ONLY through the registry:
 *   1. registry row must exist (governance evidence for the family definition);
 *   2. the ledger account must exist and match the registered geometry (type, normal balance,
 *      currency, accounting unit, active);
 * Any gap aborts the flow transaction with the precise blocker — nothing is invented, faked,
 * or posted to the wrong family.
 */
@Injectable()
export class CommercialAccountingRegistryService {
  async resolveRequiredAccountInTransaction(
    manager: EntityManager,
    role: CommercialAccountingFamilyRole,
  ): Promise<LedgerAccount> {
    const accountCode = COMMERCIAL_ACCOUNTING_ACCOUNT_CODES[role];

    const registry = await manager
      .getRepository(CommercialAccountingRegistryEntry)
      .findOne({ where: { familyCode: role } });
    if (!registry) {
      throw new CommercialAccountingBlockedError(
        'COMMERCIAL_ACCOUNTING_REGISTRY_EVIDENCE_MISSING',
        `Accounting family ${role} has no registry/governance evidence (DP-31=A). Provision via migration 1785753600076 before enabling accounting.`,
      );
    }
    if (registry.accountCode !== accountCode) {
      throw new CommercialAccountingBlockedError(
        'COMMERCIAL_ACCOUNTING_REGISTRY_CODE_MISMATCH',
        `Registry family ${role} points at '${registry.accountCode}' but the approved code map uses '${accountCode}' — refusing to guess.`,
      );
    }

    const account = await manager.getRepository(LedgerAccount).findOne({ where: { code: accountCode } });
    if (!account) {
      throw new CommercialAccountingBlockedError(
        'COMMERCIAL_ACCOUNTING_ACCOUNT_NOT_PROVISIONED',
        `Ledger account '${accountCode}' for family ${role} is registered but NOT provisioned (DP-30=B). Run migration 1785753600076; no fallback account is invented.`,
      );
    }
    if (
      (account.accountType as string) !== registry.accountType ||
      (account.normalBalance as string) !== registry.normalBalance ||
      account.currency !== registry.currency ||
      account.accountingUnit !== registry.accountingUnit
    ) {
      throw new CommercialAccountingBlockedError(
        'COMMERCIAL_ACCOUNTING_REGISTRY_GEOMETRY_MISMATCH',
        `Ledger account '${accountCode}' does not match its registered geometry — provisioning evidence is not trustworthy; refusing to post.`,
      );
    }
    if (!account.isActive) {
      throw new CommercialAccountingBlockedError(
        'COMMERCIAL_ACCOUNTING_ACCOUNT_INACTIVE',
        `Ledger account '${accountCode}' (family ${role}) is inactive; accounting cannot post and the transaction must abort (DP-15=A).`,
      );
    }
    return account;
  }
}
