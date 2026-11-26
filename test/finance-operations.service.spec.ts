/**
 * Admin Web Finance Operations — read-model unit tests.
 *
 * These tests exercise the *contract* the Admin Web depends on: institution scope is resolved
 * server-side, an out-of-scope journal is a 404, the transaction→journal link refuses to disclose
 * ledger content without `ledger.view`, reversal eligibility reports the next permitted action
 * (never a button the caller cannot use), and unavailable external evidence is never presented as
 * a successful reconciliation.
 *
 * The SQL itself is exercised against real PostgreSQL by the existing ledger/banking suites; this
 * suite uses a recording double so the scope/filter parameters and response semantics can be
 * asserted without a database.
 */
import type { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { BankingReadinessService } from '../src/banking/banking-readiness.service';
import type { InstitutionWorkforceScopeService } from '../src/institution/institution-workforce-scope.service';
import { FinanceOperationsService } from '../src/finance-operations/finance-operations.service';

const INSTITUTION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTITUTION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JOURNAL_ID = '11111111-1111-4111-8111-111111111111';
const JOURNAL_B = '22222222-2222-4222-8222-222222222222';

type QueryCall = { sql: string; params: unknown[] };

class RecordingDataSource {
  readonly calls: QueryCall[] = [];
  handler: (sql: string, params: unknown[]) => unknown[] = () => [];

  query(sql: string, params: unknown[] = []): Promise<unknown> {
    this.calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return Promise.resolve(this.handler(sql, params));
  }
}

const platformPrincipal: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: 'workforce:platform-super-admin',
  roles: ['SUPER_ADMIN'],
  scopes: [
    'ledger.view',
    'ledger.reverse',
    'transaction.view',
    'reconciliation.view',
    'banking.reconciliation.resolve',
    'banking.reconciliation.run',
    'institution.attribution.view',
    'privileged:execute',
  ],
  customerAccess: 'ANY',
  assuranceLevel: 'MFA',
};

const preparerA: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'workforce:finance-preparer-a',
  roles: ['FINANCE_PREPARER'],
  scopes: ['ledger.view', 'ledger.reverse', 'transaction.view'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};

const operationsA: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'workforce:operations-a',
  roles: ['OPERATIONS'],
  scopes: ['transaction.view'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};

const auditor: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'workforce:finance-auditor',
  roles: ['FINANCE_AUDITOR'],
  scopes: ['ledger.view', 'transaction.view', 'reconciliation.view'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
  readOnlyPrincipal: true,
};

const controller: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'workforce:finance-controller-a',
  roles: ['FINANCE_CONTROLLER'],
  scopes: ['ledger.view', 'privileged:approve', 'privileged:execute', 'reconciliation.view'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};

const journalRow = (overrides: Record<string, unknown> = {}) => ({
  id: JOURNAL_ID,
  reference: 'TRF-SYNTH-0001',
  description: 'Synthetic wallet transfer',
  status: 'POSTED',
  currency: 'NGN',
  accounting_unit: 'CUSTOMER_FUNDS',
  total_minor: '250000',
  idempotency_key: 'transfer:00000000-0000-4000-8000-00000000aa01:ledger-post',
  correlation_id: 'transfer:00000000-0000-4000-8000-00000000aa01',
  metadata: {},
  reversal_of_journal_id: null,
  reversed_by_journal_id: null,
  line_count: '2',
  created_at: '2026-11-20T09:00:00.000Z',
  posted_at: '2026-11-20T09:00:00.000Z',
  institution_id: INSTITUTION_A,
  institution_code: 'INST-A',
  institution_name: 'Synthetic Institution A',
  institution_status: 'APPROVED',
  ...overrides,
});

const institutionRow = {
  id: INSTITUTION_A,
  code: 'INST-A',
  legal_name: 'Synthetic Institution A',
  display_name: null,
  status: 'APPROVED',
};

function fixture(
  options: {
    scopes?: { platform?: boolean; institutions?: string[] };
    readiness?: unknown[];
    handler?: (sql: string, params: unknown[]) => unknown[] | undefined;
  } = {},
) {
  const dataSource = new RecordingDataSource();
  const defaultHandler = (sql: string): unknown[] => {
    if (/FROM financial_institutions\s+WHERE id = \$1/.test(sql)) return [institutionRow];
    if (sql.includes('i.code AS institution_code')) return [journalRow()];
    if (sql.includes('SELECT count(*)::text AS total') && sql.includes('ledger_journals'))
      return [{ total: '1' }];
    return [];
  };
  dataSource.handler = (sql, params) => options.handler?.(sql, params) ?? defaultHandler(sql);

  const scope = {
    hasPlatformAuthority: jest.fn().mockReturnValue(options.scopes?.platform === true),
    institutionIdsForPrincipal: jest.fn().mockResolvedValue(options.scopes?.institutions ?? []),
    assertCanAccessInstitution: jest.fn((_principal, institutionId: string) => {
      if (options.scopes?.platform) return Promise.resolve();
      const ids = options.scopes?.institutions ?? [];
      if (!ids.includes(institutionId)) {
        const error = new Error('Institution not found');
        (error as { status?: number }).status = 404;
        return Promise.reject(error);
      }
      return Promise.resolve();
    }),
  } as unknown as InstitutionWorkforceScopeService;

  const readiness = {
    forInstitution: jest.fn().mockResolvedValue(options.readiness ?? []),
  } as unknown as BankingReadinessService;

  const service = new FinanceOperationsService(
    dataSource as unknown as DataSource,
    scope,
    readiness,
  );
  return { service, dataSource, scope, readiness };
}

const providerReadiness = (
  key: string,
  usable: boolean,
  capabilityState = usable ? 'OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED' : 'IMPLEMENTED_NOT_APPROVED',
) => ({
  providerKey: key,
  environment: 'sandbox',
  registered: true,
  approved: false,
  credentialed: false,
  operational: false,
  disabled: false,
  disabledReason: null,
  currentVersion: null,
  entitled: 'UNKNOWN' as const,
  summary: `${key} is not operationally ready`,
  capabilities: [
    {
      capability: 'RECONCILIATION_OBSERVATIONS',
      implemented: true,
      approved: false,
      credentialed: false,
      operational: false,
      disabled: false,
      entitled: 'UNKNOWN' as const,
      state: capabilityState,
      usable,
    },
  ],
});

const exceptionRow = (overrides: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  subject_type: 'INBOUND_PAYMENT',
  subject_reference: 'MNFY|SYNTH|0001',
  kind: 'AMOUNT_MISMATCH',
  severity: 'CRITICAL',
  state: 'OPEN',
  internal_amount_minor: '250000',
  provider_amount_minor: '240000',
  detail: 'Internal 250000 versus provider 240000',
  resolution: null,
  resolution_note: null,
  created_at: '2026-11-20T10:00:00.000Z',
  resolved_at: null,
  run_id: '44444444-4444-4444-8444-444444444444',
  provider_key: 'MONNIFY',
  environment: 'sandbox',
  run_state: 'COMPLETED',
  started_at: '2026-11-20T09:59:00.000Z',
  completed_at: '2026-11-20T10:00:00.000Z',
  failure_code: null,
  observation_id: '55555555-5555-4555-8555-555555555555',
  provider_status: 'VERIFIED',
  provider_reference: 'MNFY|X',
  observed_at: '2026-11-20T09:59:30.000Z',
  ...overrides,
});

describe('FinanceOperationsService ledger search & scope', () => {
  it('restricts an institution-scoped principal to assigned institutions plus unattributed legacy journals', async () => {
    const { service, dataSource } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
    });
    const result = await service.searchJournals(preparerA, {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.institution?.id).toBe(INSTITUTION_A);
    expect(result.scope).toMatchObject({ mode: 'INSTITUTIONS', institutionIds: [INSTITUTION_A] });
    const rowQuery = dataSource.calls.find((call) =>
      call.sql.includes('i.code AS institution_code'),
    );
    expect(rowQuery).toBeDefined();
    expect(rowQuery!.sql).toContain('(j.institution_id IS NULL OR j.institution_id = ANY($');
    expect(rowQuery!.params).toContainEqual([INSTITUTION_A]);
  });

  it('shows only unattributed legacy journals when a principal has no institution assignment', async () => {
    const { service, dataSource } = fixture({ scopes: { institutions: [] } });
    const result = await service.searchJournals(preparerA, {});
    expect(result.scope.mode).toBe('NONE');
    const rowQuery = dataSource.calls.find((call) =>
      call.sql.includes('i.code AS institution_code'),
    );
    expect(rowQuery!.sql).toContain('j.institution_id IS NULL');
  });

  it('does not apply an institution predicate for platform-level staff', async () => {
    const { service, dataSource } = fixture({ scopes: { platform: true } });
    const result = await service.searchJournals(platformPrincipal, {});
    expect(result.scope.mode).toBe('PLATFORM');
    const rowQuery = dataSource.calls.find((call) =>
      call.sql.includes('i.code AS institution_code'),
    );
    expect(rowQuery!.sql).not.toContain('j.institution_id IS NULL');
  });

  it('refuses a filtered search for an institution the principal is not assigned to', async () => {
    const { service, dataSource } = fixture({ scopes: { institutions: [INSTITUTION_A] } });
    await expect(
      service.searchJournals(preparerA, { institutionId: INSTITUTION_B }),
    ).rejects.toThrow('Institution not found');
    // Scope was decided before any ledger row could be read.
    expect(dataSource.calls.some((call) => call.sql.includes('i.code AS institution_code'))).toBe(
      false,
    );
  });

  it('searches supported reference forms, including source transaction references', async () => {
    const { service, dataSource } = fixture({ scopes: { platform: true } });
    const result = await service.searchJournals(platformPrincipal, {
      reference: 'TRF-SYNTH',
      from: '2026-11-01',
      to: '2026-11-30',
      limit: '10',
    });
    expect(result.supportedReferenceForms).toContain('Transfer reference');
    const rowQuery = dataSource.calls.find((call) =>
      call.sql.includes('i.code AS institution_code'),
    );
    for (const clause of [
      'j.reference ILIKE',
      'j.idempotency_key ILIKE',
      'j.correlation_id ILIKE',
      'FROM transfers t WHERE t.journal_id = j.id',
      'FROM deposits d WHERE d.journal_id = j.id',
      'FROM withdrawals w WHERE w.journal_id = j.id',
      'FROM customer_funding_requests c WHERE c.journal_id = j.id',
      'FROM agent_funding_requests a WHERE a.journal_id = j.id',
      'FROM cash_to_cash_transfers cc',
    ]) {
      expect(rowQuery!.sql).toContain(clause);
    }
    expect(rowQuery!.params).toContain('%TRF-SYNTH%');
  });

  it('rejects an unbounded or inverted date range before querying', async () => {
    const { service, dataSource } = fixture({ scopes: { platform: true } });
    await expect(
      service.searchJournals(platformPrincipal, {
        from: '2024-01-01',
        to: '2026-01-01',
      }),
    ).rejects.toThrow('date range must not exceed');
    await expect(
      service.searchJournals(platformPrincipal, { from: '2026-11-30', to: '2026-11-01' }),
    ).rejects.toThrow('from must be before or equal to to');
    await expect(service.searchJournals(platformPrincipal, { limit: '0' })).rejects.toThrow(
      'limit must be an integer',
    );
    expect(dataSource.calls).toHaveLength(0);
  });
});

describe('FinanceOperationsService journal detail & transaction link', () => {
  it('answers 404 for a journal attributed to another institution', async () => {
    const { service } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
      handler: (sql) =>
        sql.includes('FROM ledger_journals j')
          ? [journalRow({ institution_id: INSTITUTION_B })]
          : [],
    });
    await expect(service.getJournal(preparerA, JOURNAL_B)).rejects.toThrow('Journal not found');
  });

  it('returns accounts and postings for an in-scope journal', async () => {
    const { service } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
      handler: (sql) => {
        if (sql.includes('JOIN ledger_accounts a ON a.id = l.ledger_account_id')) {
          return [
            {
              id: 'line-1',
              line_number: 1,
              ledger_account_id: 'acc-debit',
              code: 'CUSTOMER_FUNDS-CLEARING-NGN',
              name: 'Clearing',
              account_type: 'ASSET',
              institutional_scope: 'INSTITUTION',
              account_institution_id: INSTITUTION_A,
              direction: 'DEBIT',
              amount_minor: '250000',
              currency: 'NGN',
              accounting_unit: 'CUSTOMER_FUNDS',
            },
            {
              id: 'line-2',
              line_number: 2,
              ledger_account_id: 'acc-credit',
              code: 'CUSTOMER-WALLET-NGN',
              name: 'Customer wallet',
              account_type: 'LIABILITY',
              institutional_scope: 'INSTITUTION',
              account_institution_id: INSTITUTION_A,
              direction: 'CREDIT',
              amount_minor: '250000',
              currency: 'NGN',
              accounting_unit: 'CUSTOMER_FUNDS',
            },
          ];
        }
        if (sql.includes('i.code AS institution_code')) return [journalRow()];
        return [];
      },
    });
    const journal = await service.getJournal(preparerA, JOURNAL_ID);
    expect(journal.totalMinor).toBe('250000');
    expect(journal.lines).toHaveLength(2);
    expect(journal.lines[0]).toMatchObject({
      direction: 'DEBIT',
      accountCode: 'CUSTOMER_FUNDS-CLEARING-NGN',
    });
    expect(journal.reversal.kind).toBe('NORMAL');
  });

  it('resolves Bank to Wallet from the durable bank-intake link, never the receipt id', async () => {
    const intakeId = '1c8c3340-ccec-41f5-882b-80a0c93a3a82';
    const receiptId = '4d4d4d4d-4444-4444-8444-444444444444';
    const { service, dataSource } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
      handler: (sql) => {
        if (sql.includes('to_regclass')) return [{ present: true }];
        if (sql.includes('FROM banking_inbound_float_links')) {
          return [
            {
              source_type: 'BANK_TO_WALLET',
              id: intakeId,
              reference: 'MNFY-7835be17',
              status: 'CREDITED',
              linked_by: 'DURABLE_INBOUND_LINK',
            },
          ];
        }
        if (sql.includes('FROM inbound_funding_receipts')) return [];
        if (sql.includes('JOIN ledger_accounts a ON a.id = l.ledger_account_id')) return [];
        if (sql.includes('i.code AS institution_code')) return [journalRow()];
        return [];
      },
    });
    const journal = await service.getJournal(preparerA, JOURNAL_ID);
    expect(journal.source).toMatchObject({
      type: 'BANK_TO_WALLET',
      id: intakeId,
      reference: 'MNFY-7835be17',
      status: 'CREDITED',
      linkedBy: 'DURABLE_INBOUND_LINK',
      navigable: true,
    });
    expect(journal.source?.id).not.toBe(receiptId);
    expect(journal.source?.id).not.toBe(JOURNAL_ID);
    expect(dataSource.calls.some((call) => call.sql.includes('banking_inbound_float_links'))).toBe(
      true,
    );
  });

  it('leaves a float-receipt journal without a durable link unavailable', async () => {
    const { service } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
      handler: (sql) => {
        if (sql.includes('to_regclass')) return [{ present: true }];
        if (sql.includes('JOIN ledger_accounts a ON a.id = l.ledger_account_id')) return [];
        if (sql.includes('i.code AS institution_code')) return [journalRow()];
        return [];
      },
    });
    const journal = await service.getJournal(preparerA, JOURNAL_ID);
    expect(journal.source).toBeNull();
  });

  it('keeps a standalone legacy receipt on its own BANK_TO_WALLET identity', async () => {
    const receiptId = '6f6f6f6f-6666-4666-8666-666666666666';
    const { service } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
      handler: (sql) => {
        if (sql.includes('to_regclass')) return [{ present: true }];
        if (sql.includes('FROM inbound_funding_receipts')) {
          return [
            {
              source_type: 'BANK_TO_WALLET',
              id: receiptId,
              reference: 'MNFY-LEGACY-1',
              status: 'CREDITED',
              linked_by: 'LEGACY_RECEIPT_JOURNAL',
            },
          ];
        }
        if (sql.includes('JOIN ledger_accounts a ON a.id = l.ledger_account_id')) return [];
        if (sql.includes('i.code AS institution_code')) return [journalRow()];
        return [];
      },
    });
    const journal = await service.getJournal(preparerA, JOURNAL_ID);
    expect(journal.source).toMatchObject({
      type: 'BANK_TO_WALLET',
      id: receiptId,
      linkedBy: 'LEGACY_RECEIPT_JOURNAL',
    });
  });

  it('never queries the durable link relation when this deployment predates it', async () => {
    const { service, dataSource } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
      handler: (sql) => {
        if (sql.includes('to_regclass')) return [{ present: false }];
        if (sql.includes('JOIN ledger_accounts a ON a.id = l.ledger_account_id')) return [];
        if (sql.includes('i.code AS institution_code')) return [journalRow()];
        return [];
      },
    });
    const journal = await service.getJournal(preparerA, JOURNAL_ID);
    expect(journal.source).toBeNull();
    expect(
      dataSource.calls.some((call) => call.sql.includes('FROM banking_inbound_float_links')),
    ).toBe(false);
  });

  it('withholds ledger content from a transaction.view-only principal but says why', async () => {
    const { service, dataSource } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
      handler: (sql) => {
        if (sql.includes('FROM transfers')) {
          return [
            {
              id: '00000000-0000-4000-8000-00000000aa01',
              reference: 'TRF-SYNTH-0001',
              status: 'COMPLETED',
              created_at: '2026-11-20T08:59:00.000Z',
              journal_id: JOURNAL_ID,
            },
          ];
        }
        return [];
      },
    });
    const link = await service.transactionJournal(
      operationsA,
      '00000000-0000-4000-8000-00000000aa01',
      'TRANSFER',
    );
    expect(link.ledgerAccess).toBe('DENIED_LEDGER_VIEW');
    expect(link.outcome).toBe('LEDGER_ACCESS_DENIED');
    expect(link.journal).toBeNull();
    expect(dataSource.calls.some((call) => call.sql.includes('i.code AS institution_code'))).toBe(
      false,
    );
  });

  it('links a completed transaction to its journal for a ledger.view principal', async () => {
    const { service } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
      handler: (sql) => {
        if (sql.includes('FROM transfers t WHERE t.journal_id = $1')) {
          return [
            {
              source_type: 'TRANSFER',
              id: '00000000-0000-4000-8000-00000000aa01',
              reference: 'TRF-SYNTH-0001',
              status: 'COMPLETED',
              linked_by: 'JOURNAL_ID',
            },
          ];
        }
        if (sql.includes('i.code AS institution_code')) return [journalRow()];
        if (sql.includes('FROM transfers')) {
          return [
            {
              id: '00000000-0000-4000-8000-00000000aa01',
              reference: 'TRF-SYNTH-0001',
              status: 'COMPLETED',
              created_at: '2026-11-20T08:59:00.000Z',
              journal_id: JOURNAL_ID,
            },
          ];
        }
        return [];
      },
    });
    const link = await service.transactionJournal(
      preparerA,
      '00000000-0000-4000-8000-00000000aa01',
      'TRANSFER',
    );
    expect(link.outcome).toBe('FOUND');
    expect(link.journal?.id).toBe(JOURNAL_ID);
    expect(link.journal?.source).toMatchObject({
      type: 'TRANSFER',
      navigable: true,
    });
  });

  it('reports NO_JOURNAL_POSTED rather than inventing a journal for a completed transaction', async () => {
    const { service } = fixture({
      scopes: { institutions: [INSTITUTION_A] },
      handler: (sql) =>
        sql.includes('FROM deposits')
          ? [
              {
                id: '00000000-0000-4000-8000-00000000bb01',
                reference: 'DEP-SYNTH-1',
                status: 'COMPLETED',
                created_at: '2026-11-20T08:59:00.000Z',
                journal_id: null,
              },
            ]
          : [],
    });
    const link = await service.transactionJournal(
      preparerA,
      '00000000-0000-4000-8000-00000000bb01',
      'DEPOSIT',
    );
    expect(link.outcome).toBe('NO_JOURNAL_POSTED');
    expect(link.journal).toBeNull();
    expect(link.message).toContain('reconciliation break');
  });
});

describe('FinanceOperationsService reversal eligibility', () => {
  const eligibilityFixture = (
    row: Record<string, unknown>,
    approval: Record<string, unknown> | null,
    scopes: { platform?: boolean; institutions?: string[] } = { platform: true },
  ) =>
    fixture({
      scopes,
      handler: (sql) => {
        if (sql.includes('FROM privileged_action_approvals')) return approval ? [approval] : [];
        if (sql.includes('FROM ledger_journals j')) return [journalRow(row)];
        return [];
      },
    });

  const approvalRow = (status: string) => ({
    id: '66666666-6666-4666-8666-666666666666',
    status,
    requested_at: '2026-11-21T08:00:00.000Z',
    expires_at: '2026-11-22T08:00:00.000Z',
    requester_principal_id: preparerA.principalId,
    approved_by: status === 'APPROVED' ? controller.principalId : null,
    action_type: 'LEDGER_JOURNAL_REVERSAL',
    resource_type: 'LEDGER_JOURNAL',
  });

  it('tells a read-only principal it may inspect but never request', async () => {
    const { service } = eligibilityFixture({}, null);
    const eligibility = await service.reversalEligibility(auditor, JOURNAL_ID);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasonCode).toBe('READ_ONLY_PRINCIPAL');
    expect(eligibility.permissions).toMatchObject({
      canView: true,
      canRequest: false,
      canExecute: false,
    });
    expect(eligibility.nextAction).toBe('NONE');
    expect(eligibility.blockers[0]?.action).toContain('FINANCE_PREPARER');
  });

  it('offers a preparer the governed request as the next action', async () => {
    const { service } = eligibilityFixture({}, null);
    const eligibility = await service.reversalEligibility(preparerA, JOURNAL_ID);
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.nextAction).toBe('REQUEST_REVERSAL');
    expect(eligibility.nextActionLabel).toBe('Request governed reversal');
    expect(eligibility.governance.actionType).toBe('LEDGER_JOURNAL_REVERSAL');
  });

  it('stops at AWAIT_APPROVAL while a request is outstanding, even for a controller', async () => {
    const { service } = eligibilityFixture({}, approvalRow('REQUESTED'));
    const eligibility = await service.reversalEligibility(controller, JOURNAL_ID);
    expect(eligibility.nextAction).toBe('AWAIT_APPROVAL');
    expect(eligibility.reasonCode).toBe('APPROVAL_PENDING');
    expect(eligibility.approval?.status).toBe('REQUESTED');
  });

  it('offers EXECUTE_REVERSAL only to the entitled executor', async () => {
    const controllerFixture = eligibilityFixture({}, approvalRow('APPROVED'));
    const controllerEligibility = await controllerFixture.service.reversalEligibility(
      controller,
      JOURNAL_ID,
    );
    expect(controllerEligibility.nextAction).toBe('EXECUTE_REVERSAL');
    expect(controllerEligibility.permissions.canExecute).toBe(true);

    const preparerFixture = eligibilityFixture({}, approvalRow('APPROVED'));
    const preparerEligibility = await preparerFixture.service.reversalEligibility(
      preparerA,
      JOURNAL_ID,
    );
    expect(preparerEligibility.nextAction).toBe('AWAIT_APPROVAL');
    expect(preparerEligibility.reasonCode).toBe('APPROVED_EXECUTOR_REQUIRED');
    expect(preparerEligibility.blockers.map((entry) => entry.code)).toContain(
      'EXECUTOR_ENTITLEMENT_REQUIRED',
    );
  });

  it('makes ineligibility actionable for reversals and already-reversed journals', async () => {
    const isReversal = eligibilityFixture({ reversal_of_journal_id: JOURNAL_B }, null);
    const reversalEligibility = await isReversal.service.reversalEligibility(preparerA, JOURNAL_ID);
    expect(reversalEligibility.eligible).toBe(false);
    expect(reversalEligibility.reasonCode).toBe('JOURNAL_IS_A_REVERSAL');
    expect(reversalEligibility.blockers[0]).toMatchObject({
      code: 'JOURNAL_IS_A_REVERSAL',
    });

    const alreadyReversed = eligibilityFixture(
      { reversed_by_journal_id: '77777777-7777-4777-8777-777777777777' },
      null,
    );
    const reversedEligibility = await alreadyReversed.service.reversalEligibility(
      preparerA,
      JOURNAL_ID,
    );
    expect(reversedEligibility.reasonCode).toBe('ALREADY_REVERSED');
    expect(reversedEligibility.nextAction).toBe('NONE');
  });

  it('refuses eligibility for another institution\u2019s journal', async () => {
    const { service } = eligibilityFixture({ institution_id: INSTITUTION_B }, null, {
      institutions: [INSTITUTION_A],
    });
    await expect(service.reversalEligibility(preparerA, JOURNAL_B)).rejects.toThrow(
      'Journal not found',
    );
  });
});

describe('FinanceOperationsService reconciliation breaks', () => {
  const breaksFixture = (options: {
    scopes: { platform?: boolean; institutions?: string[] };
    readiness?: unknown[];
    exceptions?: unknown[];
    failedRuns?: unknown[];
  }) =>
    fixture({
      scopes: options.scopes,
      readiness: options.readiness,
      handler: (sql) => {
        if (sql.includes('FROM banking_reconciliation_exceptions e')) {
          return options.exceptions ?? [];
        }
        if (sql.includes("state IN ('FAILED','ABANDONED')")) return options.failedRuns ?? [];
        if (
          sql.includes('count(*)::text AS total') &&
          sql.includes('banking_reconciliation_exceptions')
        ) {
          return [{ total: String(options.exceptions?.length ?? 0) }];
        }
        if (/FROM financial_institutions\s+WHERE id = \$1/.test(sql)) return [institutionRow];
        return [];
      },
    });

  it('separates internal ledger checks from provider and statement reconciliation', async () => {
    const { service } = breaksFixture({
      scopes: { institutions: [INSTITUTION_A] },
      readiness: [providerReadiness('MONNIFY', false)],
    });
    const report = await service.reconciliationBreaks(preparerA, { institutionId: INSTITUTION_A });
    expect(report.checks).toHaveLength(4);
    expect(report.checks.every((check) => check.source === 'INTERNAL_LEDGER')).toBe(true);
    expect(report.checks.every((check) => check.status === 'PASS')).toBe(true);
    expect(report.sources.map((source) => source.source)).toEqual([
      'INTERNAL_LEDGER',
      'EXTERNAL_PROVIDER',
      'EXTERNAL_STATEMENT',
    ]);
    expect(report.sources[0]!.result).toBe('AGREED');
    expect(report.sources[1]!.availability).toBe('UNAVAILABLE');
    // Absent provider evidence is never a successful reconciliation, and never "agreed".
    expect(report.sources[1]!.result).toBe('NOT_PERFORMED');
    expect(report.reconciliationEstablished).toBe(false);
    expect(report.sources[1]!.result).not.toBe('AGREED');
    expect(report.sources[2]!.availability).toBe('UNAVAILABLE');
    expect(report.sources[2]!.result).toBe('NOT_PERFORMED');
    // Internal checks passed, but end-to-end reconciliation is NOT established.
    expect(report.reconciliationEstablished).toBe(false);
    expect(report.summary.providerReady).toBe(false);
    expect(report.summary.unavailableSources).toBe(2);
    expect(report.providerReadiness[0]).toMatchObject({
      providerKey: 'MONNIFY',
      usable: false,
      entitled: 'UNKNOWN',
      reconciliationCapability: { usable: false },
    });
  });

  it('shows provider exceptions with evidence, source and time, and the permitted next action', async () => {
    const { service } = breaksFixture({
      scopes: { platform: true },
      readiness: [providerReadiness('MONNIFY', true)],
      exceptions: [exceptionRow()],
    });
    const report = await service.reconciliationBreaks(platformPrincipal, {
      institutionId: INSTITUTION_A,
    });
    const providerBreak = report.breaks.find((entry) => entry.source === 'EXTERNAL_PROVIDER');
    expect(providerBreak).toBeDefined();
    expect(providerBreak).toMatchObject({
      checkName: 'amount_mismatch',
      state: 'OPEN',
      severity: 'CRITICAL',
      amounts: { internalMinor: '250000', providerMinor: '240000', currency: 'NGN' },
      run: { providerKey: 'MONNIFY', environment: 'sandbox' },
    });
    expect(providerBreak!.evidence[0]).toMatchObject({
      kind: 'PROVIDER_OBSERVATION',
      available: true,
      reference: '55555555-5555-4555-8555-555555555555',
    });
    expect(providerBreak!.nextAction).toMatchObject({
      code: 'RECORD_RESOLUTION',
      permitted: true,
      targetKind: 'BANKING_EXCEPTION',
    });
    expect(report.sources[1]!.availability).toBe('AVAILABLE');
    expect(report.sources[1]!.result).toBe('EVIDENCE_RECORDED');
  });

  it('never marks an UNVERIFIABLE exception as a pass and denies resolution without the function', async () => {
    const { service } = breaksFixture({
      scopes: { institutions: [INSTITUTION_A] },
      readiness: [providerReadiness('MONNIFY', false)],
      exceptions: [
        exceptionRow({
          kind: 'UNVERIFIABLE',
          severity: 'REVIEW',
          observation_id: null,
          provider_status: null,
          provider_amount_minor: null,
          internal_amount_minor: null,
          detail: 'Could not verify: provider settlement capability unavailable',
        }),
      ],
    });
    const report = await service.reconciliationBreaks(preparerA, {
      institutionId: INSTITUTION_A,
      source: 'EXTERNAL_PROVIDER',
    });
    expect(report.breaks).toHaveLength(1);
    const breakRow = report.breaks[0]!;
    expect(breakRow.state).toBe('UNAVAILABLE');
    expect(breakRow.evidence[0]).toMatchObject({ available: false });
    expect(breakRow.evidence[0]!.note).toContain('not a pass');
    expect(breakRow.nextAction).toMatchObject({
      permitted: false,
      code: 'REQUEST_RESOLUTION_ACCESS',
    });
  });

  it('surfaces a failed provider run as an unresolved break, not a silent zero', async () => {
    const { service } = breaksFixture({
      scopes: { platform: true },
      readiness: [providerReadiness('MONNIFY', false)],
      failedRuns: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          provider_key: 'MONNIFY',
          environment: 'sandbox',
          state: 'FAILED',
          started_at: '2026-11-20T10:00:00.000Z',
          completed_at: '2026-11-20T10:00:05.000Z',
          failure_code: 'PROVIDER_UNAVAILABLE',
          exceptions_raised: 0,
          observations: 3,
        },
      ],
    });
    const report = await service.reconciliationBreaks(platformPrincipal, {
      institutionId: INSTITUTION_A,
    });
    const runBreak = report.breaks.find(
      (entry) => entry.checkName === 'provider_reconciliation_run',
    );
    expect(runBreak).toMatchObject({
      state: 'ERROR',
      subject: {
        type: 'RECONCILIATION_RUN',
        reference: '88888888-8888-4888-8888-888888888888',
      },
      run: { state: 'FAILED', failureCode: 'PROVIDER_UNAVAILABLE' },
    });
    expect(runBreak!.nextAction.permitted).toBe(false);
    expect(report.reconciliationEstablished).toBe(false);
  });

  it('rejects reconciliation access outside the assigned institution', async () => {
    const { service, dataSource } = breaksFixture({ scopes: { institutions: [INSTITUTION_A] } });
    await expect(
      service.reconciliationBreaks(preparerA, { institutionId: INSTITUTION_B }),
    ).rejects.toThrow('Institution not found');
    expect(dataSource.calls).toHaveLength(0);
  });

  it('validates the source/state filters and requires an institution id', async () => {
    const { service } = breaksFixture({ scopes: { platform: true } });
    await expect(service.reconciliationBreaks(platformPrincipal, {})).rejects.toThrow(
      'institutionId is required',
    );
    await expect(
      service.reconciliationBreaks(platformPrincipal, {
        institutionId: INSTITUTION_A,
        source: 'SPREADSHEET',
      }),
    ).rejects.toThrow('source must be');
    await expect(
      service.reconciliationBreaks(platformPrincipal, {
        institutionId: INSTITUTION_A,
        state: 'CLOSED',
      }),
    ).rejects.toThrow('state must be');
  });
});
