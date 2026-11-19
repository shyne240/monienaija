import type { DataSource, EntityManager, Repository } from 'typeorm';
import { TransferService } from '../src/transfer/transfer.service';
import { Transfer } from '../src/transfer/transfer.entity';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import type { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import type { LedgerService } from '../src/ledger/ledger.service';
import type { FeeRuleResolverService } from '../src/fee-rules/fee-rule-resolver.service';
import type { CommercialDecisionSnapshotService } from '../src/commercial-decision/commercial-decision-snapshot.service';
import type { CommissionEngine } from '../src/commission/commission.engine';

const agentId = '11111111-1111-4111-8111-111111111111';
const classId = '22222222-2222-4222-8222-222222222222';

describe('shared transfer commercial participant', () => {
  it('uses the acting agent and agent class, not CUSTOMER, in commission and snapshot evidence', async () => {
    const resolver = {
      resolveWithManager: jest.fn().mockResolvedValue({ status: 'NOT_CONFIGURED' }),
    };
    const snapshots = { recordDecisionWithManager: jest.fn().mockResolvedValue(undefined) };
    const commission = {
      decideWithManager: jest.fn().mockResolvedValue({
        status: 'ALLOCATED',
        allocations: [{ beneficiaryType: 'AGENT', beneficiaryId: null, amountMinor: '20' }],
        ruleRefs: [],
      }),
    };
    const service = new TransferService(
      {} as Repository<Transfer>,
      {} as Repository<WalletAccount>,
      {} as Repository<LedgerJournal>,
      {} as DataSource,
      {} as LedgerService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver as unknown as FeeRuleResolverService,
      snapshots as unknown as CommercialDecisionSnapshotService,
      undefined,
      commission as unknown as CommissionEngine,
    );
    const manager = {} as EntityManager;
    await service['recordCommercialDecisionSnapshot'](manager, {
      transfer: Object.assign(new Transfer(), { id: 'transfer' }),
      command: {
        sourceWalletId: 'src',
        destinationWalletId: 'dst',
        ownership: { kind: 'AGENT_SELF', agentId },
        amountMinor: 100n,
        currency: 'NGN',
        idempotencyKey: 'key',
        requestHash: 'hash',
      },
      sourceParticipant: {
        wallet: new WalletAccount(),
        type: 'AGENT',
        id: agentId,
        agentClassId: classId,
      },
      journalId: 'journal',
      limitOutcome: null,
      payerLedgerAccountId: 'payer-ledger',
    });
    expect(commission.decideWithManager).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ agentId, agentClassId: classId, productCode: 'WALLET_TRANSFER' }),
      expect.anything(),
    );
    expect(snapshots.recordDecisionWithManager).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        principalType: 'AGENT',
        principalId: agentId,
        commissionDecision: expect.objectContaining({
          allocations: [expect.objectContaining({ beneficiaryId: agentId }) as unknown],
        }) as unknown,
      }),
    );
  });
});
