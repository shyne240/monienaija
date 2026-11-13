import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { CashToCashInstitutionPort } from './cash-to-cash-institution-adapter';
import { CashToCashInstitutionAdapter } from './cash-to-cash-institution-adapter';
import type { ClaimFinancialContextRequest } from './cash-to-cash-claim-authorization';

const institutionId = '11111111-1111-4111-8111-111111111111';
const resolved = {
  outcome: 'RESOLVED' as const,
  institutionId,
  evidenceFingerprint: 'a'.repeat(64),
};
const request: ClaimFinancialContextRequest = {
  agentId: 'claimant',
  fundingAgentId: 'funder',
  customerId: 'recipient',
  transferId: 'transfer',
  fundingJournalId: 'journal',
  redemptionMethod: 'AGENT_CASH',
  walletIds: ['wallet'],
  ledgerAccountIds: ['ledger'],
  lock: 'SHARE',
};
const manager = {} as EntityManager;

describe('cash-to-cash institution foundation adapter', () => {
  it('locks and checks claimant, recipient, accounts and funder in one institution', async () => {
    const resolve = jest
      .fn<
        ReturnType<CashToCashInstitutionPort['resolve']>,
        Parameters<CashToCashInstitutionPort['resolve']>
      >()
      .mockResolvedValue(resolved);
    const result = await new CashToCashInstitutionAdapter({ resolve }).resolve(manager, request);
    expect(resolve).toHaveBeenNthCalledWith(1, manager, {
      agentId: 'claimant',
      customerId: 'recipient',
      walletIds: ['wallet'],
      ledgerAccountIds: ['ledger'],
      lock: 'SHARE',
    });
    expect(resolve).toHaveBeenNthCalledWith(2, manager, {
      institutionId,
      agentId: 'funder',
      lock: 'SHARE',
    });
    expect(result.institutionId).toBe(institutionId);
    expect(result.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(['UNRESOLVED', 'NOT_CONFIGURED', 'INSTITUTION_INACTIVE'] as const)(
    'fails closed on %s',
    async (outcome) => {
      const resolve = jest
        .fn<
          ReturnType<CashToCashInstitutionPort['resolve']>,
          Parameters<CashToCashInstitutionPort['resolve']>
        >()
        .mockResolvedValue({ ...resolved, outcome });
      await expect(
        new CashToCashInstitutionAdapter({ resolve }).resolve(manager, request),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(resolve).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects incompatible or different funding institutions', async () => {
    const resolve = jest
      .fn<
        ReturnType<CashToCashInstitutionPort['resolve']>,
        Parameters<CashToCashInstitutionPort['resolve']>
      >()
      .mockResolvedValueOnce(resolved)
      .mockResolvedValueOnce({
        ...resolved,
        institutionId: '22222222-2222-4222-8222-222222222222',
      });
    await expect(
      new CashToCashInstitutionAdapter({ resolve }).resolve(manager, request),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects malformed evidence', async () => {
    const resolve = jest
      .fn<
        ReturnType<CashToCashInstitutionPort['resolve']>,
        Parameters<CashToCashInstitutionPort['resolve']>
      >()
      .mockResolvedValue({ ...resolved, evidenceFingerprint: 'bad' });
    await expect(
      new CashToCashInstitutionAdapter({ resolve }).resolve(manager, request),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
