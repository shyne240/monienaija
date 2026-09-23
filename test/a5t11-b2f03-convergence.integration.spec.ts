import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { AuthorizationService } from '../src/authorization/authorization.service';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { A5ArControlAccountProvisioningService } from '../src/ledger/ar-control-account-provisioning.service';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { MetricsService } from '../src/operations/metrics.service';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import { B2FAccountMappingService } from '../src/policy/b2f-account-mapping.service';
import type { B2FAccountMappingViewV1 } from '../src/policy/b2f-account-mapping.types';
import { B2FFinanceControlPolicy } from '../src/policy/b2f-finance-control.entity';
import { B2FFinanceControlService } from '../src/policy/b2f-finance-control.service';
import type { B2FFinanceControlPolicyDefinitionV1 } from '../src/policy/b2f-finance-control.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * A5T11 / B2F03 convergence coverage against real PostgreSQL.
 *
 * A5T11 AR control-account provisioning owns a SERIALIZABLE transaction and, inside it,
 * consumes an A2 approval and evaluates a B2F06 Finance control. Both collaborations now go
 * through the transaction-aware APIs. Against real PostgreSQL the previous nested-transaction
 * form opened a second pooled connection that could not see the caller's uncommitted writes;
 * this suite exercises the corrected convergence end to end with real services.
 */
describe('A5T11 / B2F03 convergence (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let provisioning: A5ArControlAccountProvisioningService;
  let approvals: PrivilegedActionApprovalService;
  let controls: B2FFinanceControlService;
  let mappings: B2FAccountMappingService;

  const maker = {
    type: 'PRIVILEGED' as const,
    principalId: 'finance-maker',
    roles: ['FINANCE_PREPARER'],
    scopes: ['privileged:request'],
    customerAccess: 'NONE' as const,
    assuranceLevel: 'MFA' as const,
  };
  const checker = {
    type: 'PRIVILEGED' as const,
    principalId: 'finance-checker',
    roles: ['FINANCE_APPROVER', 'FINANCE_CONTROLLER'],
    scopes: ['privileged:execute', 'privileged:approve'],
    customerAccess: 'NONE' as const,
    assuranceLevel: 'MFA' as const,
  };
  const ctx = () => ({
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  });

  const ACTION = 'FINANCE_A5_AR_ACCOUNT_PROVISION';
  const RESOURCE_TYPE = 'A5_AR_CONTROL_ACCOUNT_PROVISION';
  const MAPPING_ACTION = 'FINANCE_ACCOUNT_MAPPING_ACTIVATE';
  const MAPPING_RESOURCE = 'B2F_FINANCE_ACCOUNT_MAPPING';
  const CLASSIFICATION_KEY = 'finance.asset.receivable';

  const controlDefinition = {
    policyKey: 'finance.control-policy.ng.primary',
    policyVersion: 1,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    materialityBands: [
      {
        name: 'STANDARD',
        minimumMinor: '0',
        maximumMinor: '100',
        requiredCheckerRoles: ['FINANCE_APPROVER'],
        requiredApprovalCount: 1,
        overrideEvidenceRequired: false,
      },
      {
        name: 'ELEVATED',
        minimumMinor: '101',
        maximumMinor: '1000',
        requiredCheckerRoles: ['FINANCE_CONTROLLER'],
        requiredApprovalCount: 1,
        overrideEvidenceRequired: false,
      },
      {
        name: 'MATERIAL',
        minimumMinor: '1001',
        maximumMinor: null,
        requiredCheckerRoles: ['FINANCE_CONTROLLER'],
        requiredApprovalCount: 1,
        overrideEvidenceRequired: true,
      },
    ],
    actionControls: [
      {
        action: ACTION,
        makerRoles: ['FINANCE_PREPARER'],
        checkerRoles: ['FINANCE_APPROVER', 'FINANCE_CONTROLLER'],
        minimumApprovals: 1,
        materialityApplies: false,
        overrideEvidenceRequired: false,
      },
      {
        action: MAPPING_ACTION,
        makerRoles: ['FINANCE_PREPARER'],
        checkerRoles: ['FINANCE_APPROVER', 'FINANCE_CONTROLLER'],
        minimumApprovals: 1,
        materialityApplies: false,
        overrideEvidenceRequired: false,
      },
    ],
  } as unknown as B2FFinanceControlPolicyDefinitionV1;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a5t11b2f03');

    const audit = new AuditService(dataSource.getRepository(AuditEvent));
    const idempotency = new IdempotencyService(dataSource.getRepository(IdempotencyRecord));
    approvals = new PrivilegedActionApprovalService(
      dataSource.getRepository(PrivilegedActionApproval),
      dataSource.getRepository(SecurityEventHistory),
      dataSource,
      audit,
      new AuthorizationService(dataSource, audit),
    );
    controls = new B2FFinanceControlService(dataSource, idempotency, audit, approvals);
    const ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
    );
    provisioning = new A5ArControlAccountProvisioningService(
      dataSource,
      ledger,
      idempotency,
      approvals,
      controls,
      audit,
      new OutboxService(dataSource.getRepository(OutboxEvent)),
      new MetricsService(dataSource),
    );
    mappings = new B2FAccountMappingService(
      dataSource,
      ledger,
      idempotency,
      audit,
      new OutboxService(dataSource.getRepository(OutboxEvent)),
      new MetricsService(dataSource),
      approvals,
      controls,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await activateControlPolicy();
  }, 60000);

  /** Creates and activates a real B2F06 control policy through the real approval flow. */
  async function activateControlPolicy(): Promise<void> {
    await controls.createPolicy({
      definition: controlDefinition,
      idempotencyKey: randomUUID(),
      principal: checker,
      requestContext: ctx(),
    } as never);
    const repo = dataSource.getRepository(B2FFinanceControlPolicy);
    const policy = await repo.findOne({ where: { policyKey: controlDefinition.policyKey } });
    if (!policy) throw new Error('control policy missing');

    const fingerprint = controls.computeActivationFingerprint(
      policy.policyReference,
      policy.policyKey,
      policy.policyVersion,
      policy.definitionHash,
      policy.effectiveFrom.toISOString(),
      policy.effectiveTo?.toISOString() ?? null,
      policy.recordVersion,
    );
    const requested = await approvals.request({
      principal: maker,
      policy: {
        action: 'FINANCE_CONTROL_POLICY_ACTIVATE',
        resourceType: 'B2F_FINANCE_CONTROL_POLICY',
        requiredScopes: ['privileged:request'],
        minimumAssurance: 'MFA',
      } as never,
      resource: { type: 'B2F_FINANCE_CONTROL_POLICY', id: policy.id } as never,
      actionFingerprint: fingerprint,
      reason: 'Activate control policy for A5T11 convergence',
    });
    await approvals.approve({ principal: checker, approvalId: requested.approval!.id });
    await controls.activatePolicy({
      policyReference: policy.policyReference,
      expectedRecordVersion: policy.recordVersion,
      approvalId: requested.approval!.id,
      principal: checker,
      idempotencyKey: randomUUID(),
      requestContext: ctx(),
    } as never);
  }

  function provisionCommand(overrides: Record<string, unknown> = {}) {
    return {
      definition: provisioning.getAuthorizedDefinition(),
      idempotencyKey: randomUUID(),
      approvalId: randomUUID(),
      principal: checker,
      requestContext: ctx(),
      ...overrides,
    };
  }

  /** Requests and approves a real A2 approval carrying the exact provisioning fingerprint. */
  async function approvedProvisioning(
    command: ReturnType<typeof provisionCommand>,
  ): Promise<string> {
    const fingerprint = provisioning.computeApprovalFingerprint(command as never);
    const requested = await approvals.request({
      principal: maker,
      policy: {
        action: ACTION,
        resourceType: RESOURCE_TYPE,
        requiredScopes: ['privileged:request'],
        requiredRoles: ['FINANCE_PREPARER'],
        minimumAssurance: 'MFA',
      } as never,
      resource: { type: RESOURCE_TYPE, id: command.definition.code } as never,
      actionFingerprint: fingerprint,
      reason: 'Provision the AR control account',
    });
    await approvals.approve({ principal: checker, approvalId: requested.approval!.id });
    return requested.approval!.id;
  }

  it('activates the B2F06 control policy the convergence depends on', async () => {
    const rows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM b2f_finance_control_policies',
    );
    expect(firstRow(rows, 'control policy').status).toBe('ACTIVE');
  });

  it('provisions the canonical AR control account through the real convergence path', async () => {
    const base = provisionCommand();
    const approvalId = await approvedProvisioning(base);
    const result = await provisioning.provision({ ...base, approvalId } as never);

    expect(result.outcome).toBe('PROVISIONED');
    expect(result.evidence?.canonicalA5AccountId).toBeTruthy();

    const accounts: Array<{ code: string; accounting_unit: string }> = await dataSource.query(
      'SELECT code, accounting_unit FROM ledger_accounts WHERE code = $1',
      [base.definition.code],
    );
    const account = firstRow(accounts, 'AR control account');
    expect(account.accounting_unit).toBe(base.definition.accountingUnit);
  });

  it('consumes the A2 approval inside the provisioning transaction', async () => {
    const base = provisionCommand();
    const approvalId = await approvedProvisioning(base);
    await provisioning.provision({ ...base, approvalId } as never);

    const rows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM privileged_action_approvals WHERE id = $1',
      [approvalId],
    );
    expect(firstRow(rows, 'approval status').status).toBe('CONSUMED');
  });

  it('records the B2F06 control decision in the same transaction', async () => {
    const base = provisionCommand();
    const approvalId = await approvedProvisioning(base);
    await provisioning.provision({ ...base, approvalId } as never);

    const rows: Array<{ action: string }> = await dataSource.query(
      `SELECT action FROM b2f_finance_control_decisions WHERE action = $1`,
      [ACTION],
    );
    expect(rows).toHaveLength(1);
  });

  it('replays provisioning idempotently without creating a second account', async () => {
    const base = provisionCommand();
    const approvalId = await approvedProvisioning(base);
    const command = { ...base, approvalId };

    const first = await provisioning.provision(command as never);
    const second = await provisioning.provision(command as never);

    expect(first.outcome).toBe('PROVISIONED');
    expect(second.outcome).toBe('REPLAYED');
    expect(second.replayed).toBe(true);
    expect(second.evidence?.canonicalA5AccountId).toBe(first.evidence?.canonicalA5AccountId);

    const accounts: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_accounts WHERE code = $1',
      [base.definition.code],
    );
    expect(accounts).toHaveLength(1);
  });

  it('rejects provisioning when no approval matches the fingerprint', async () => {
    const base = provisionCommand();
    const result = await provisioning.provision(base as never);
    expect(result.outcome).toBe('REJECTED');

    const accounts: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_accounts WHERE code = $1',
      [base.definition.code],
    );
    expect(accounts).toHaveLength(0);
  });

  it('rejects an approval raised for a different fingerprint', async () => {
    const base = provisionCommand();
    const requested = await approvals.request({
      principal: maker,
      policy: {
        action: ACTION,
        resourceType: RESOURCE_TYPE,
        requiredScopes: ['privileged:request'],
        requiredRoles: ['FINANCE_PREPARER'],
        minimumAssurance: 'MFA',
      } as never,
      resource: { type: RESOURCE_TYPE, id: base.definition.code } as never,
      actionFingerprint: 'f'.repeat(64),
      reason: 'Mismatched fingerprint',
    });
    await approvals.approve({ principal: checker, approvalId: requested.approval!.id });

    const result = await provisioning.provision({
      ...base,
      approvalId: requested.approval!.id,
    } as never);
    expect(result.outcome).toBe('REJECTED');
    const accounts: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_accounts WHERE code = $1',
      [base.definition.code],
    );
    expect(accounts).toHaveLength(0);
  });

  it('rejects the same idempotency key carrying a different request hash', async () => {
    const base = provisionCommand();
    const approvalId = await approvedProvisioning(base);
    await provisioning.provision({ ...base, approvalId } as never);

    await expect(
      provisioning.provision({
        ...base,
        approvalId,
        definition: { ...base.definition, name: 'A different AR control account' },
      } as never),
    ).rejects.toBeTruthy();
  });

  it('rejects a definition that is not the authorized one', async () => {
    const base = provisionCommand({
      definition: { ...provisioning.getAuthorizedDefinition(), currency: 'USD' },
    });
    const result = await provisioning.provision(base as never);
    expect(result.outcome).toBe('REJECTED');
  });

  it('writes audit and outbox evidence for a successful provisioning', async () => {
    const base = provisionCommand();
    const approvalId = await approvedProvisioning(base);
    await provisioning.provision({ ...base, approvalId } as never);

    const audits: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM audit_events WHERE entity_type = 'A5_AR_CONTROL_ACCOUNT_PROVISIONING'`,
    );
    const outbox: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM outbox_events WHERE event_type = 'A5ArControlAccountProvisioned'`,
    );
    expect(audits.length).toBeGreaterThan(0);
    expect(outbox.length).toBeGreaterThan(0);
  });

  it('leaves no account, approval consumption or decision behind when provisioning is rejected', async () => {
    const base = provisionCommand();
    const result = await provisioning.provision(base as never);
    expect(result.outcome).toBe('REJECTED');

    const accounts: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_accounts WHERE code = $1',
      [base.definition.code],
    );
    expect(accounts).toHaveLength(0);
    const decisions: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM b2f_finance_control_decisions WHERE action = $1`,
      [ACTION],
    );
    expect(decisions).toHaveLength(0);
  });

  it('never creates a second canonical account, even under a fresh idempotency key', async () => {
    const base = provisionCommand();
    const approvalId = await approvedProvisioning(base);
    const first = await provisioning.provision({ ...base, approvalId } as never);
    expect(first.outcome).toBe('PROVISIONED');

    // A fresh idempotency key against the already-provisioned account is refused by the
    // outbox event-key guard rather than silently emitting a second provisioning event.
    const retryBase = provisionCommand();
    const retryApprovalId = await approvedProvisioning(retryBase);
    await expect(
      provisioning.provision({ ...retryBase, approvalId: retryApprovalId } as never),
    ).rejects.toBeTruthy();

    const accounts: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_accounts WHERE code = $1',
      [base.definition.code],
    );
    expect(accounts).toHaveLength(1);
    const events: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM outbox_events WHERE event_type = 'A5ArControlAccountProvisioned'`,
    );
    expect(events).toHaveLength(1);
  });

  /**
   * B2F07-PRE-CONV.A5 — operational A5/B2F03 convergence for finance.asset.receivable.
   *
   * Drives the existing A5T11 provisioning path and the existing B2F03 mapping lifecycle
   * end to end against real PostgreSQL so that the first two B2F07 renewed-entry gate
   * conditions (canonical AR account provisioned+verified, receivable mapping ACTIVE and
   * verified against its UUID) are evidenced by the real production runtime. No B2F07 AR
   * logic, no B1 term activation, no B3/B4/B5 surface is exercised here.
   */
  describe('B2F07-PRE-CONV.A5 operational convergence', () => {
    /** Provisions the canonical AR account through the real privileged path. */
    async function provisionCanonicalAccount(): Promise<string> {
      const base = provisionCommand();
      const approvalId = await approvedProvisioning(base);
      const result = await provisioning.provision({ ...base, approvalId } as never);
      expect(result.outcome).toBe('PROVISIONED');
      expect(result.replayed).toBe(false);
      const accountId = result.evidence?.canonicalA5AccountId;
      expect(accountId).toBeTruthy();
      return accountId as string;
    }

    async function mappingEntityId(reference: string, version: number): Promise<string> {
      const rows: Array<{ id: string }> = await dataSource.query(
        'SELECT id FROM b2f_finance_account_mappings WHERE mapping_reference = $1 AND mapping_version = $2',
        [reference, version],
      );
      return firstRow(rows, 'mapping row').id;
    }

    /** Requests and approves a real A2 approval carrying the exact activation fingerprint. */
    async function approvedMappingActivation(
      pending: B2FAccountMappingViewV1,
      reason: string,
    ): Promise<string> {
      const entityId = await mappingEntityId(pending.mappingReference, pending.mappingVersion);
      const fingerprint = mappings.computeLifecycleFingerprint(pending, MAPPING_ACTION, reason);
      const requested = await approvals.request({
        principal: maker,
        policy: {
          action: MAPPING_ACTION,
          resourceType: MAPPING_RESOURCE,
          requiredScopes: ['privileged:request'],
          requiredRoles: ['FINANCE_PREPARER'],
          minimumAssurance: 'MFA',
        } as never,
        resource: { type: MAPPING_RESOURCE, id: entityId } as never,
        actionFingerprint: fingerprint,
        reason: 'Activate the finance.asset.receivable mapping',
      });
      await approvals.approve({ principal: checker, approvalId: requested.approval!.id });
      return requested.approval!.id;
    }

    const ACTIVATE_REASON =
      'Activate finance.asset.receivable mapping against the canonical A5 AR account';
    const SUBMIT_REASON = 'Submit finance.asset.receivable mapping for approval';

    /** Runs the real DRAFT → PENDING_APPROVAL → ACTIVE lifecycle against the given A5 UUID. */
    async function activateCanonicalMapping(accountId: string, mappingVersion = 1) {
      const created = await mappings.create({
        mappingVersion,
        classificationKey: CLASSIFICATION_KEY,
        classificationVersion: 1,
        a5LedgerAccountId: accountId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: randomUUID(),
        principal: maker,
        requestContext: ctx(),
      } as never);
      expect(created.outcome).toBe('CREATED');
      const draft = created.mapping!;
      const submitted = await mappings.submitForApproval({
        mappingReference: draft.mappingReference,
        mappingVersion: draft.mappingVersion,
        expectedRecordVersion: draft.recordVersion,
        idempotencyKey: randomUUID(),
        principal: maker,
        requestContext: ctx(),
        reason: SUBMIT_REASON,
      } as never);
      expect(submitted.outcome).toBe('UPDATED');
      const pending = submitted.mapping!;
      expect(pending.status).toBe('PENDING_APPROVAL');
      const approvalId = await approvedMappingActivation(pending, ACTIVATE_REASON);
      const activated = await mappings.activate({
        mappingReference: pending.mappingReference,
        mappingVersion: pending.mappingVersion,
        expectedRecordVersion: pending.recordVersion,
        idempotencyKey: randomUUID(),
        principal: checker,
        requestContext: ctx(),
        reason: ACTIVATE_REASON,
        approvalId,
      } as never);
      expect(activated.outcome).toBe('UPDATED');
      return { draft, pending, active: activated.mapping!, approvalId };
    }

    function canonicalVerificationRequest(active: B2FAccountMappingViewV1, accountId: string) {
      return {
        mappingReference: active.mappingReference,
        mappingVersion: active.mappingVersion,
        bookKey: 'finance.book.ng.primary',
        classificationKey: CLASSIFICATION_KEY,
        a5LedgerAccountId: accountId,
        accountingDate: '2026-09-23',
      } as never;
    }

    it('verifies the provisioned account carries every canonical property', async () => {
      const accountId = await provisionCanonicalAccount();

      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT id, code, name, account_type, normal_balance, currency, accounting_unit,
                allow_negative_balance, is_active
         FROM ledger_accounts WHERE code = $1`,
        ['FINANCE-ACCOUNTS_RECEIVABLE-NGN'],
      );
      const account = firstRow(rows, 'canonical AR account');
      expect(account.id).toBe(accountId);
      expect(account.code).toBe('FINANCE-ACCOUNTS_RECEIVABLE-NGN');
      expect(account.name).toBe('Finance accounts receivable control NGN');
      expect(account.account_type).toBe('ASSET');
      expect(account.normal_balance).toBe('DEBIT');
      expect(account.currency).toBe('NGN');
      expect(account.accounting_unit).toBe('CUSTOMER_FUNDS');
      expect(account.allow_negative_balance).toBe(false);
      expect(account.is_active).toBe(true);
    });

    it('cannot create two canonical accounts under concurrent provisioning', async () => {
      const first = provisionCommand();
      const firstApproval = await approvedProvisioning(first);
      const second = provisionCommand();
      const secondApproval = await approvedProvisioning(second);

      const settled = await Promise.allSettled([
        provisioning.provision({ ...first, approvalId: firstApproval } as never),
        provisioning.provision({ ...second, approvalId: secondApproval } as never),
      ]);
      const fulfilled = settled.filter((r) => r.status === 'fulfilled');
      const rejected = settled.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(fulfilled[0]!.status).toBe('fulfilled');
      expect((fulfilled[0] as { value: { outcome: string } }).value.outcome).toBe('PROVISIONED');

      const accounts: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT id FROM ledger_accounts WHERE code = $1',
        [first.definition.code],
      );
      expect(accounts).toHaveLength(1);
      const events: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT id FROM outbox_events WHERE event_type = 'A5ArControlAccountProvisioned'`,
      );
      expect(events).toHaveLength(1);
    });

    it('drives finance.asset.receivable through the complete B2F03 lifecycle against the canonical A5 UUID', async () => {
      const accountId = await provisionCanonicalAccount();
      const { draft, pending, active, approvalId } = await activateCanonicalMapping(accountId);

      expect(draft.status).toBe('DRAFT');
      expect(draft.classificationKey).toBe(CLASSIFICATION_KEY);
      expect(draft.observedA5Code).toBe('FINANCE-ACCOUNTS_RECEIVABLE-NGN');
      expect(draft.observedA5AccountType).toBe('ASSET');
      expect(draft.observedA5NormalBalance).toBe('DEBIT');
      expect(draft.observedA5Active).toBe(true);
      expect(draft.observedA5AllowNegativeBalance).toBe(false);
      expect(draft.currency).toBe('NGN');
      expect(draft.accountingUnit).toBe('CUSTOMER_FUNDS');
      expect(pending.status).toBe('PENDING_APPROVAL');
      expect(active.status).toBe('ACTIVE');
      expect(active.a5LedgerAccountId).toBe(accountId);
      expect(active.approvedBy).toBe('finance-checker');
      expect(active.controlDecisionReference).toBeTruthy();
      expect(active.recordVersion).toBeGreaterThan(draft.recordVersion);

      const verification = await mappings.verify(canonicalVerificationRequest(active, accountId));
      expect(verification.compatible).toBe(true);
      expect(verification.reasons).toEqual([]);
      expect(verification.readOnly).toBe(true);

      const approvalsRows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM privileged_action_approvals WHERE id = $1',
        [approvalId],
      );
      expect(firstRow(approvalsRows, 'mapping approval status').status).toBe('CONSUMED');

      const decisions: Array<{ action: string }> = await dataSource.query(
        'SELECT action FROM b2f_finance_control_decisions WHERE action = $1',
        [MAPPING_ACTION],
      );
      expect(decisions).toHaveLength(1);

      const activeRows: Array<{ a5_ledger_account_id: string }> = await dataSource.query(
        `SELECT a5_ledger_account_id FROM b2f_finance_account_mappings WHERE status = 'ACTIVE'`,
      );
      expect(activeRows).toHaveLength(1);
      expect(firstRow(activeRows, 'active mapping').a5_ledger_account_id).toBe(accountId);

      const audits: Array<{ action: string }> = await dataSource.query(
        `SELECT action FROM audit_events WHERE entity_type = 'B2F_FINANCE_ACCOUNT_MAPPING' ORDER BY action`,
      );
      expect(audits.map((a) => a.action)).toEqual([
        'FINANCE_ACCOUNT_MAPPING_ACTIVATED',
        'FINANCE_ACCOUNT_MAPPING_APPROVAL_REQUESTED',
        'FINANCE_ACCOUNT_MAPPING_CREATED',
      ]);

      const outbox: Array<{ event_type: string; payload: Record<string, unknown> }> =
        await dataSource.query(
          `SELECT event_type, payload FROM outbox_events
           WHERE event_type IN ('B2FFinanceAccountMappingCreated', 'B2FFinanceAccountMappingActive')`,
        );
      expect(outbox).toHaveLength(2);
      for (const event of outbox) {
        expect(event.payload['a5LedgerAccountId']).toBe(accountId);
        expect(event.payload['classificationKey']).toBe(CLASSIFICATION_KEY);
      }
    });

    it('refuses a second ACTIVE mapping for the same A5 account', async () => {
      const accountId = await provisionCanonicalAccount();
      const first = await activateCanonicalMapping(accountId, 1);
      expect(first.active.status).toBe('ACTIVE');

      const second = await mappings.create({
        mappingVersion: 2,
        classificationKey: CLASSIFICATION_KEY,
        classificationVersion: 1,
        a5LedgerAccountId: accountId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: randomUUID(),
        principal: maker,
        requestContext: ctx(),
      } as never);
      expect(second.outcome).toBe('CREATED');
      const secondDraft = second.mapping!;
      const secondSubmitted = await mappings.submitForApproval({
        mappingReference: secondDraft.mappingReference,
        mappingVersion: secondDraft.mappingVersion,
        expectedRecordVersion: secondDraft.recordVersion,
        idempotencyKey: randomUUID(),
        principal: maker,
        requestContext: ctx(),
        reason: SUBMIT_REASON,
      } as never);
      const secondPending = secondSubmitted.mapping!;
      const secondApproval = await approvedMappingActivation(secondPending, ACTIVATE_REASON);
      const result = await mappings.activate({
        mappingReference: secondPending.mappingReference,
        mappingVersion: secondPending.mappingVersion,
        expectedRecordVersion: secondPending.recordVersion,
        idempotencyKey: randomUUID(),
        principal: checker,
        requestContext: ctx(),
        reason: ACTIVATE_REASON,
        approvalId: secondApproval,
      } as never);

      expect(result.outcome).toBe('REJECTED');
      expect(result.failure?.code).toBe('OVERLAPPING_ACTIVE_MAPPING');

      const activeRows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT id FROM b2f_finance_account_mappings WHERE status = 'ACTIVE'`,
      );
      expect(activeRows).toHaveLength(1);
      const secondRows: Array<{ status: string }> = await dataSource.query(
        `SELECT status FROM b2f_finance_account_mappings WHERE mapping_reference = $1`,
        [secondDraft.mappingReference],
      );
      expect(firstRow(secondRows, 'second mapping').status).toBe('PENDING_APPROVAL');

      const verification = await mappings.verify(
        canonicalVerificationRequest(first.active, accountId),
      );
      expect(verification.compatible).toBe(true);
    });

    it('cannot activate a mapping against an account that has drifted from canonical state', async () => {
      const accountId = await provisionCanonicalAccount();
      const created = await mappings.create({
        mappingVersion: 1,
        classificationKey: CLASSIFICATION_KEY,
        classificationVersion: 1,
        a5LedgerAccountId: accountId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: randomUUID(),
        principal: maker,
        requestContext: ctx(),
      } as never);
      const draft = created.mapping!;
      const submitted = await mappings.submitForApproval({
        mappingReference: draft.mappingReference,
        mappingVersion: draft.mappingVersion,
        expectedRecordVersion: draft.recordVersion,
        idempotencyKey: randomUUID(),
        principal: maker,
        requestContext: ctx(),
        reason: SUBMIT_REASON,
      } as never);
      const pending = submitted.mapping!;

      // Simulate post-DRAFT drift on the real account row: the canonical account is no
      // longer in the verified state the lifecycle transition must re-check.
      await dataSource.query('UPDATE ledger_accounts SET is_active = false WHERE id = $1', [
        accountId,
      ]);
      try {
        const approvalId = await approvedMappingActivation(pending, ACTIVATE_REASON);
        const result = await mappings.activate({
          mappingReference: pending.mappingReference,
          mappingVersion: pending.mappingVersion,
          expectedRecordVersion: pending.recordVersion,
          idempotencyKey: randomUUID(),
          principal: checker,
          requestContext: ctx(),
          reason: ACTIVATE_REASON,
          approvalId,
        } as never);

        expect(result.outcome).toBe('REJECTED');
        expect(result.failure?.code).toBe('A5_ACCOUNT_INCOMPATIBLE');

        const rows: Array<{ status: string }> = await dataSource.query(
          'SELECT status FROM b2f_finance_account_mappings WHERE mapping_reference = $1',
          [pending.mappingReference],
        );
        expect(firstRow(rows, 'mapping status').status).toBe('PENDING_APPROVAL');

        // The rejection happens before approval consumption, so no unsafe partial state:
        // the approval is still usable and no control decision was recorded.
        const approvalRows: Array<{ status: string }> = await dataSource.query(
          'SELECT status FROM privileged_action_approvals WHERE id = $1',
          [approvalId],
        );
        expect(firstRow(approvalRows, 'approval status').status).toBe('APPROVED');
        const decisions: Array<Record<string, unknown>> = await dataSource.query(
          'SELECT id FROM b2f_finance_control_decisions WHERE action = $1',
          [MAPPING_ACTION],
        );
        expect(decisions).toHaveLength(0);
        const inactiveAccounts: Array<Record<string, unknown>> = await dataSource.query(
          `SELECT id FROM b2f_finance_account_mappings WHERE status = 'ACTIVE'`,
        );
        expect(inactiveAccounts).toHaveLength(0);
      } finally {
        await dataSource.query('UPDATE ledger_accounts SET is_active = true WHERE id = $1', [
          accountId,
        ]);
      }
    });

    it('replays the complete convergence operation without duplicating any state', async () => {
      const base = provisionCommand();
      const approvalId = await approvedProvisioning(base);
      const command = { ...base, approvalId };
      const first = await provisioning.provision(command as never);
      const second = await provisioning.provision(command as never);
      expect(first.outcome).toBe('PROVISIONED');
      expect(second.outcome).toBe('REPLAYED');
      const accountId = first.evidence?.canonicalA5AccountId as string;
      expect(second.evidence?.canonicalA5AccountId).toBe(accountId);

      const createCommand = {
        mappingVersion: 1,
        classificationKey: CLASSIFICATION_KEY,
        classificationVersion: 1,
        a5LedgerAccountId: accountId,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        idempotencyKey: randomUUID(),
        principal: maker,
        requestContext: ctx(),
      };
      const created = await mappings.create(createCommand as never);
      const createdReplay = await mappings.create(createCommand as never);
      expect(created.outcome).toBe('CREATED');
      expect(createdReplay.outcome).toBe('REPLAYED');
      expect(createdReplay.mapping?.mappingReference).toBe(created.mapping?.mappingReference);

      const draft = created.mapping!;
      const submitCommand = {
        mappingReference: draft.mappingReference,
        mappingVersion: draft.mappingVersion,
        expectedRecordVersion: draft.recordVersion,
        idempotencyKey: randomUUID(),
        principal: maker,
        requestContext: ctx(),
        reason: SUBMIT_REASON,
      };
      const submitted = await mappings.submitForApproval(submitCommand as never);
      const submittedReplay = await mappings.submitForApproval(submitCommand as never);
      expect(submitted.outcome).toBe('UPDATED');
      expect(submittedReplay.outcome).toBe('REPLAYED');

      const pending = submitted.mapping!;
      const mappingApprovalId = await approvedMappingActivation(pending, ACTIVATE_REASON);
      const activateCommand = {
        mappingReference: pending.mappingReference,
        mappingVersion: pending.mappingVersion,
        expectedRecordVersion: pending.recordVersion,
        idempotencyKey: randomUUID(),
        principal: checker,
        requestContext: ctx(),
        reason: ACTIVATE_REASON,
        approvalId: mappingApprovalId,
      };
      const activated = await mappings.activate(activateCommand as never);
      const activatedReplay = await mappings.activate(activateCommand as never);
      expect(activated.outcome).toBe('UPDATED');
      expect(activatedReplay.outcome).toBe('REPLAYED');
      expect(activatedReplay.mapping?.status).toBe('ACTIVE');

      const accounts: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT id FROM ledger_accounts WHERE code = $1',
        [base.definition.code],
      );
      expect(accounts).toHaveLength(1);
      const mappingRows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM b2f_finance_account_mappings',
      );
      expect(mappingRows).toHaveLength(1);
      expect(firstRow(mappingRows, 'mapping').status).toBe('ACTIVE');

      const provisionedEvents: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT id FROM outbox_events WHERE event_type = 'A5ArControlAccountProvisioned'`,
      );
      expect(provisionedEvents).toHaveLength(1);
      const createdEvents: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT id FROM outbox_events WHERE event_type = 'B2FFinanceAccountMappingCreated'`,
      );
      expect(createdEvents).toHaveLength(1);
      const activeEvents: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT id FROM outbox_events WHERE event_type = 'B2FFinanceAccountMappingActive'`,
      );
      expect(activeEvents).toHaveLength(1);

      const provisioningDecisions: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT id FROM b2f_finance_control_decisions WHERE action = $1',
        [ACTION],
      );
      expect(provisioningDecisions).toHaveLength(1);
      const activationDecisions: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT id FROM b2f_finance_control_decisions WHERE action = $1',
        [MAPPING_ACTION],
      );
      expect(activationDecisions).toHaveLength(1);
    });

    it('leaves the B1 payment-term track and B2F07 gate state untouched', async () => {
      const accountId = await provisionCanonicalAccount();
      const { active } = await activateCanonicalMapping(accountId);
      expect(active.status).toBe('ACTIVE');

      const verification = await mappings.verify(canonicalVerificationRequest(active, accountId));
      expect(verification.compatible).toBe(true);

      const accounts: Array<{ is_active: boolean }> = await dataSource.query(
        'SELECT is_active FROM ledger_accounts WHERE code = $1',
        ['FINANCE-ACCOUNTS_RECEIVABLE-NGN'],
      );
      expect(accounts).toHaveLength(1);
      expect(firstRow(accounts, 'canonical AR account').is_active).toBe(true);

      // B1 payment-term prerequisite is deliberately NOT touched by this task:
      // no payment-term row may exist, let alone an ACTIVE one.
      const paymentTerms: Array<{ c: string }> = await dataSource.query(
        'SELECT count(*)::int AS c FROM b1_payment_terms',
      );
      expect(Number(firstRow(paymentTerms, 'b1 payment terms').c)).toBe(0);
      const activeTerms: Array<{ c: string }> = await dataSource.query(
        `SELECT count(*)::int AS c FROM b1_payment_terms WHERE status = 'ACTIVE'`,
      );
      expect(Number(firstRow(activeTerms, 'active b1 payment terms').c)).toBe(0);
    });
  });
});
