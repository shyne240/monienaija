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
    provisioning = new A5ArControlAccountProvisioningService(
      dataSource,
      new LedgerService(
        dataSource.getRepository(LedgerAccount),
        dataSource.getRepository(LedgerJournal),
        dataSource.getRepository(LedgerLine),
        dataSource,
      ),
      idempotency,
      approvals,
      controls,
      audit,
      new OutboxService(dataSource.getRepository(OutboxEvent)),
      new MetricsService(dataSource),
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
});
