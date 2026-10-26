/**
 * P0-B unit tests: LedgerReversalGovernanceService — the journal-reversal maker/checker wiring
 * over the REAL PrivilegedActionApprovalService (in-memory repositories). Covers: correct
 * pending request creation (registered action/resource + deterministic fingerprint of the actual
 * reversal request), rejection of invalid/unauthorized/duplicate/tampered requests, approval
 * separation-of-duties, and the reversal domain's existing rules (unknown journal, reversal of
 * a reversal, already-reversed).
 */
import type { DataSource, DeepPartial, EntityManager, ObjectLiteral, Repository } from 'typeorm';
import type { Repository as TypeOrmRepository } from 'typeorm';

import type { AuditService } from '../src/operations/audit.service';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import {
  LedgerReversalGovernanceService,
  ledgerReversalRequestFingerprint,
} from '../src/ledger/ledger-reversal-governance.service';
import type { LedgerService } from '../src/ledger/ledger.service';

const MAKER_ID = '00000000-0000-4000-8000-0000000000c1';
const CHECKER_ID = '00000000-0000-4000-8000-0000000000c2';
const JOURNAL_ID = '00000000-0000-4000-8000-0000000000d1';

class MemoryRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();
  private sequence = 0;

  create(input?: DeepPartial<T>): T {
    return (input ?? {}) as T;
  }

  save(entity: T): Promise<T> {
    const record = entity as Record<string, unknown>;
    if (!record.id) {
      this.sequence += 1;
      record.id = `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
    }
    this.records.set(String(record.id), entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where?: Partial<T> }): Promise<T | null> {
    const conditions = options.where ?? {};
    return Promise.resolve(
      [...this.records.values()].find((entity) =>
        Object.entries(conditions).every(([key, expected]) => {
          const actual = (entity as Record<string, unknown>)[key];
          return actual === expected;
        }),
      ) ?? null,
    );
  }

  createQueryBuilder() {
    let conditions: Partial<T> = {};
    const queryBuilder = {
      where(_condition: string, parameters: { approvalId: string }) {
        conditions = { id: parameters.approvalId } as unknown as Partial<T>;
        return this;
      },
      setLock() {
        return this;
      },
      getOne: () => this.findOne({ where: conditions }),
    };
    return queryBuilder;
  }
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: unknown): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) throw new Error('Unexpected repository');
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  readonly manager: MemoryManager;

  constructor(repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {
    this.manager = new MemoryManager(repositories);
  }

  transaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return callback(this.manager as unknown as EntityManager);
  }
}

const maker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: MAKER_ID,
  sessionId: 'maker-sess',
  roles: ['FINANCE_PREPARER'],
  scopes: ['ledger.reverse', 'ledger.view'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};

const checker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: CHECKER_ID,
  sessionId: 'checker-sess',
  roles: ['FINANCE_CONTROLLER'],
  scopes: ['privileged:approve', 'privileged:execute', 'ledger.view'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};

function fixture(journal?: Partial<LedgerJournal>) {
  const approvalRepository = new MemoryRepository<PrivilegedActionApproval>();
  const securityEventRepository = new MemoryRepository<SecurityEventHistory>();
  const journalRepository = new MemoryRepository<LedgerJournal>();
  if (journal) {
    journalRepository.records.set(
      JOURNAL_ID,
      { id: JOURNAL_ID, reversalOfJournalId: null, ...journal } as LedgerJournal,
    );
  }
  const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
    [PrivilegedActionApproval, approvalRepository as unknown as MemoryRepository<ObjectLiteral>],
    [SecurityEventHistory, securityEventRepository as unknown as MemoryRepository<ObjectLiteral>],
    [LedgerJournal, journalRepository as unknown as MemoryRepository<ObjectLiteral>],
  ]);
  const auditService = { record: jest.fn().mockResolvedValue({}) };
  const authorizationService = {
    authorize: jest.fn().mockResolvedValue({ allowed: true, action: 'LEDGER_JOURNAL_REVERSAL' }),
  };
  const approvals = new PrivilegedActionApprovalService(
    approvalRepository as unknown as Repository<PrivilegedActionApproval>,
    securityEventRepository as unknown as Repository<SecurityEventHistory>,
    new MemoryDataSource(repositories) as unknown as DataSource,
    auditService as unknown as AuditService,
    authorizationService as unknown as AuthorizationService,
  );
  const reverseJournal = jest.fn().mockResolvedValue({ id: 'reversal-journal', status: 'POSTED' });
  const ledgerService = { reverseJournal } as unknown as LedgerService;
  const governance = new LedgerReversalGovernanceService(
    journalRepository as unknown as TypeOrmRepository<LedgerJournal>,
    ledgerService,
    approvals,
  );
  return { governance, approvals, approvalRepository, journalRepository, reverseJournal, authorizationService };
}

describe('LedgerReversalGovernanceService (P0-B)', () => {
  it('creates a pending request bound to LEDGER_JOURNAL_REVERSAL / LEDGER_JOURNAL with a real derived fingerprint', async () => {
    const { governance, approvalRepository } = fixture({ reversalOfJournalId: null });
    const view = await governance.requestReversal({
      principal: maker,
      journalId: JOURNAL_ID,
      reason: 'Correct posting duplicate entry',
    });

    expect(view.status).toBe(PrivilegedActionApprovalStatus.REQUESTED);
    expect(view.actionType).toBe('LEDGER_JOURNAL_REVERSAL');
    expect(view.resourceType).toBe('LEDGER_JOURNAL');
    expect(view.resourceId).toBe(JOURNAL_ID);
    expect(view.actionFingerprint).toBe(
      ledgerReversalRequestFingerprint(JOURNAL_ID, 'Correct posting duplicate entry'),
    );
    expect(view.actionFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(approvalRepository.records.size).toBe(1);
  });

  it('refuses invalid requests: missing reason, bad journal id, unknown journal, reversal of a reversal, already reversed', async () => {
    const { governance, journalRepository } = fixture({ reversalOfJournalId: null });

    await expect(
      governance.requestReversal({ principal: maker, journalId: JOURNAL_ID, reason: '   ' }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      governance.requestReversal({ principal: maker, journalId: 'not-a-uuid', reason: 'x' }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      governance.requestReversal({
        principal: maker,
        journalId: '00000000-0000-4000-8000-0000000000ff',
        reason: 'x',
      }),
    ).rejects.toMatchObject({ status: 404 });

    // A reversal cannot itself be reversed.
    journalRepository.records.set(
      JOURNAL_ID,
      { id: JOURNAL_ID, reversalOfJournalId: '00000000-0000-4000-8000-0000000000e1' } as LedgerJournal,
    );
    await expect(
      governance.requestReversal({ principal: maker, journalId: JOURNAL_ID, reason: 'x' }),
    ).rejects.toMatchObject({ status: 409 });

    // Already reversed (an existing reversal points at the journal).
    journalRepository.records.set(
      JOURNAL_ID,
      { id: JOURNAL_ID, reversalOfJournalId: null } as LedgerJournal,
    );
    journalRepository.records.set(
      '00000000-0000-4000-8000-0000000000e2',
      { id: '00000000-0000-4000-8000-0000000000e2', reversalOfJournalId: JOURNAL_ID } as LedgerJournal,
    );
    await expect(
      governance.requestReversal({ principal: maker, journalId: JOURNAL_ID, reason: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('keeps separation of duties: maker requests, checker approves and executes', async () => {
    const { governance, approvals, reverseJournal } = fixture({ reversalOfJournalId: null });
    const view = await governance.requestReversal({
      principal: maker,
      journalId: JOURNAL_ID,
      reason: 'Correct posting duplicate entry',
    });

    // Maker cannot approve their own request.
    const self = await approvals.approve({ approvalId: view.approvalId, principal: maker });
    expect(self).toMatchObject({ approved: false, reason: 'SELF_APPROVAL_FORBIDDEN' });

    // Checker without privileged:approve cannot approve either.
    const blind = await approvals.approve({
      approvalId: view.approvalId,
      principal: { ...checker, scopes: ['ledger.view'] },
    });
    expect(blind).toMatchObject({ approved: false, reason: 'APPROVAL_SCOPE_MISSING' });

    const approved = await approvals.approve({ approvalId: view.approvalId, principal: checker });
    expect(approved.approved).toBe(true);

    // Maker cannot execute; the approved reversal executes via the checker and delegates to
    // the untouched reversal primitive with the fingerprint-bound reason.
    await expect(
      governance.executeReversal({
        principal: maker,
        journalId: JOURNAL_ID,
        reason: 'Correct posting duplicate entry',
        approvalId: view.approvalId,
      }),
    ).rejects.toMatchObject({ status: 403 });

    const result = await governance.executeReversal({
      principal: checker,
      journalId: JOURNAL_ID,
      reason: 'Correct posting duplicate entry',
      approvalId: view.approvalId,
    });
    expect(result).toEqual({ id: 'reversal-journal', status: 'POSTED' });
    expect(reverseJournal).toHaveBeenCalledWith(
      JOURNAL_ID,
      expect.stringContaining(view.approvalId),
      'Correct posting duplicate entry',
    );
  });

  it('rejects tampered, replayed and misbound executions', async () => {
    const { governance, approvals, reverseJournal } = fixture({ reversalOfJournalId: null });
    const view = await governance.requestReversal({
      principal: maker,
      journalId: JOURNAL_ID,
      reason: 'Correct posting duplicate entry',
    });
    await approvals.approve({ approvalId: view.approvalId, principal: checker });

    // Tampered reason: fingerprint mismatch → 403, no posting.
    await expect(
      governance.executeReversal({
        principal: checker,
        journalId: JOURNAL_ID,
        reason: 'A DIFFERENT reason',
        approvalId: view.approvalId,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(reverseJournal).not.toHaveBeenCalled();

    // Wrong journal: the approval does not govern it.
    await expect(
      governance.executeReversal({
        principal: checker,
        journalId: '00000000-0000-4000-8000-0000000000ff',
        reason: 'Correct posting duplicate entry',
        approvalId: view.approvalId,
      }),
    ).rejects.toThrow(/does not govern this journal/i);

    // Missing approval id is a client error.
    await expect(
      governance.executeReversal({
        principal: checker,
        journalId: JOURNAL_ID,
        reason: 'Correct posting duplicate entry',
        approvalId: '',
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Happy path then replay → 409.
    await governance.executeReversal({
      principal: checker,
      journalId: JOURNAL_ID,
      reason: 'Correct posting duplicate entry',
      approvalId: view.approvalId,
    });
    await expect(
      governance.executeReversal({
        principal: checker,
        journalId: JOURNAL_ID,
        reason: 'Correct posting duplicate entry',
        approvalId: view.approvalId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('denies unentitled executors before consumption', async () => {
    const { governance } = fixture({ reversalOfJournalId: null });
    const view = await governance.requestReversal({
      principal: maker,
      journalId: JOURNAL_ID,
      reason: 'Correct posting duplicate entry',
    });
    const auditor: AuthorizationPrincipal = {
      ...maker,
      principalId: '00000000-0000-4000-8000-0000000000c3',
      roles: ['FINANCE_AUDITOR'],
      scopes: ['finance:audit', 'ledger.view'],
    };
    await expect(
      governance.executeReversal({
        principal: auditor,
        journalId: JOURNAL_ID,
        reason: 'Correct posting duplicate entry',
        approvalId: view.approvalId,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(() => governance.assertExecuteEntitled(auditor)).toThrow(/privileged:execute/i);
    expect(() => governance.assertExecuteEntitled(checker)).not.toThrow();
  });

  it('exposes the deterministic fingerprint helper the request and execute phases share', () => {
    const a = ledgerReversalRequestFingerprint(JOURNAL_ID, 'duplicate posting');
    const b = ledgerReversalRequestFingerprint(JOURNAL_ID, 'duplicate posting');
    const d = ledgerReversalRequestFingerprint(JOURNAL_ID, 'something else');
    const e = ledgerReversalRequestFingerprint('00000000-0000-4000-8000-0000000000ee', 'duplicate posting');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(d).not.toBe(a);
    expect(e).not.toBe(a);
  });
});
