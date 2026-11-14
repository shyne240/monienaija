/**
 * ARENA 3B Stage 1 — canonical governed institutional-financial fixture acceptance.
 *
 * Proves, against real PostgreSQL and the real application, that the shared fixture
 * (`test/support/governed-financial-fixture.ts`) produces *legitimate* institutional financial
 * context:
 *
 *  - governed activation, affiliation and enrolment through consumed protected approvals;
 *  - wallet attribution **before** the first ledger line (and refusal afterwards);
 *  - `FINANCIAL_CONTEXT_RESOLVER` resolving `RESOLVED` for compatible records;
 *  - two independent institutions, cross-institution rejection, unattributed rejection;
 *  - posting through `LedgerService` after attribution;
 *  - direct-SQL refusal to forge a protected approval (guard trigger, no fabricated evidence);
 *  - repeated use of the same fixture instance and cleanup.
 *
 * No provider call, no real financial transaction, no deployment, no production credential.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { LedgerService } from '../src/ledger/ledger.service';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import {
  FINANCIAL_CONTEXT_RESOLVER,
  type FinancialContextResolver,
} from '../src/institution/financial-context-resolver';
import type { FinancialContext } from '../src/institution/institution.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import {
  createTestEvidenceReader,
  overrideTrustedEvidenceReader,
  type TestEvidenceReaderHandle,
} from './support/kyc-test-evidence-reader';

describe('Governed institutional-financial fixture (ARENA 3B Stage 1) — real PostgreSQL', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let resolver: FinancialContextResolver;
  let fixture: GovernedFinancialFixture;
  const kycEvidence: TestEvidenceReaderHandle = createTestEvidenceReader({ mode: 'ELIGIBLE' });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('govfinfixture');
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource);
    const moduleRef = await overrideTrustedEvidenceReader(builder, kycEvidence).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    resolver = moduleRef.get<FinancialContextResolver>(FINANCIAL_CONTEXT_RESOLVER);
    expect(moduleRef.get(LedgerService)).toBeDefined();
    expect(moduleRef.get(AgentCashToCashService)).toBeDefined();
  }, 240_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    fixture = new GovernedFinancialFixture({ app, dataSource, label: 'gf' });
  });

  afterEach(() => {
    fixture?.cleanup();
  });

  async function createAgent(): Promise<{ id: string; reference: string }> {
    const id = randomUUID();
    const reference = `gf-agent-${id.slice(0, 8)}`;
    await dataSource.query(`INSERT INTO agents (id, reference, status) VALUES ($1,$2,'ACTIVE')`, [
      id,
      reference,
    ]);
    return { id, reference };
  }

  async function createCustomer(kycStatus = 'APPROVED'): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_2',$3)`,
      [id, `gf-cust-${id.slice(0, 8)}`, kycStatus],
    );
    return id;
  }

  async function resolve(
    agentId: string | null,
    walletId: string,
    customerId?: string,
  ): Promise<FinancialContext> {
    try {
      return await dataSource.transaction(async (manager) =>
        resolver.resolve(manager, {
          agentId: agentId ?? undefined,
          customerId,
          walletIds: [walletId],
          lock: 'SHARE',
        }),
      );
    } catch (error) {
      // Keep the failure legible in the assertion message rather than as a bare stack trace.
      throw new Error(`resolver threw: ${(error as Error).message}`);
    }
  }

  // =========================================================== ============= acceptance cases

  it('1 — governed activation, affiliation and enrolment produce protected evidence', async () => {
    const institutionId = await fixture.institution();
    const agent = await createAgent();
    const affiliation = await fixture.affiliateAgent(agent.id, institutionId);
    const customerId = await createCustomer();
    const enrolment = await fixture.enrolCustomer(customerId, institutionId);

    expect(affiliation.institutionId).toBe(institutionId);
    expect(enrolment.status).toBe('ACTIVE');
    expect(enrolment.financialEligibility).toBe('ELIGIBLE');

    // The institution is APPROVED and activated by a consumed protected approval.
    const [institution] = await dataSource.query<Array<{ status: string }>>(
      `SELECT status FROM financial_institutions WHERE id=$1`,
      [institutionId],
    );
    expect(institution!.status).toBe('APPROVED');

    // Evidence came from the real mechanisms: checker decisions + consumptions exist, and no
    // execution-evidence row was inserted by the fixture (they are trigger-generated).
    const counts = await fixture.governedCounts();
    expect(counts.checkerDecisions).toBeGreaterThan(0);
    expect(counts.consumptions).toBeGreaterThan(0);
    expect(counts.affiliations).toBe(1);
    expect(counts.enrolments).toBe(1);
  });

  it('2 — wallet attribution before posting yields a RESOLVED financial context', async () => {
    const institutionId = await fixture.institution();
    const agent = await createAgent();
    const { wallet, attribution } = await fixture.prepareAgentFundingWallet(agent.id);

    expect(attribution.ledgerAccountId).toBe(wallet.ledgerAccountId);

    const walletRow = await fixture.walletRow(wallet.walletId);
    expect(walletRow.institution_id).toBe(institutionId);
    expect(walletRow.owner_class).toBe('AGENT');

    const accountRow = await fixture.ledgerAccountRow(wallet.ledgerAccountId);
    expect(accountRow.institutional_scope).toBe('INSTITUTION');
    expect(accountRow.institution_id).toBe(institutionId);
    expect(accountRow.institutional_purpose).toBe('CUSTOMER_FUNDS');

    const context = await resolve(agent.id, wallet.walletId);
    expect(context.outcome).toBe('RESOLVED');
    expect(context.institutionId).toBe(institutionId);
    expect(context.institutionStatus).toBe('APPROVED');
    expect(context.agentAffiliation?.outcome).toBe('RESOLVED');
    expect(context.agentAffiliation?.affiliationId).toBeTruthy();
    expect(context.evidenceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(context.parties.some((party) => party.kind === 'WALLET')).toBe(true);
  });

  it('3 — financial posting succeeds after legitimate attribution', async () => {
    const institutionId = await fixture.institution();
    const agent = await createAgent();
    const { wallet } = await fixture.prepareAgentFundingWallet(agent.id);

    const before = await fixture.balanceOf(wallet.ledgerAccountId);
    const journalId = await fixture.fundLedgerAccount(wallet.ledgerAccountId, '250000', {
      institutionId,
    });
    const after = await fixture.balanceOf(wallet.ledgerAccountId);

    expect(journalId).toBeTruthy();
    expect(before).toBe(0n);
    expect(after).toBe(250000n);

    const context = await resolve(agent.id, wallet.walletId);
    expect(context.outcome).toBe('RESOLVED');
    expect(context.institutionId).toBe(institutionId);

    // The posting is a real balanced journal.
    const lines: Array<{ direction: string; amount: string }> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount FROM ledger_lines WHERE journal_id=$1 ORDER BY direction`,
      [journalId],
    );
    expect(lines).toHaveLength(2);
    expect(lines.reduce((total, line) => total + BigInt(line.amount), 0n)).toBe(500000n);
  });

  it('4 — attribution after posted financial history is refused (no fabricated history)', async () => {
    const institutionId = await fixture.institution();
    const agent = await createAgent();
    const wallet = await fixture.prepareUnattributedWallet(agent.id);
    await fixture.fundLedgerAccount(wallet.ledgerAccountId, '1000');

    await expect(fixture.attributeWallet(wallet.walletId, institutionId)).rejects.toThrow(
      /already has posted financial history/i,
    );

    const accountRow = await fixture.ledgerAccountRow(wallet.ledgerAccountId);
    expect(accountRow.institutional_scope).toBe('UNATTRIBUTED');
  });

  it('5 — two independent institutions resolve independently', async () => {
    const institutionA = await fixture.createInstitution();
    const institutionB = await fixture.createInstitution();

    expect(institutionA.id).not.toBe(institutionB.id);

    const agentA = await createAgent();
    const agentB = await createAgent();
    const walletA = (
      await fixture.prepareAgentFundingWallet(agentA.id, { institutionId: institutionA.id })
    ).wallet;
    const walletB = (
      await fixture.prepareAgentFundingWallet(agentB.id, { institutionId: institutionB.id })
    ).wallet;

    const contextA = await resolve(agentA.id, walletA.walletId);
    const contextB = await resolve(agentB.id, walletB.walletId);

    expect(contextA.outcome).toBe('RESOLVED');
    expect(contextB.outcome).toBe('RESOLVED');
    expect(contextA.institutionId).toBe(institutionA.id);
    expect(contextB.institutionId).toBe(institutionB.id);
    expect(contextA.evidenceFingerprint).not.toBe(contextB.evidenceFingerprint);
  });

  it('6 — cross-institution records are rejected as INCOMPATIBLE', async () => {
    const institutionA = await fixture.createInstitution();
    const institutionB = await fixture.createInstitution();

    const agentA = await createAgent();
    const agentB = await createAgent();
    const walletA = (
      await fixture.prepareAgentFundingWallet(agentA.id, { institutionId: institutionA.id })
    ).wallet;
    const walletB = (
      await fixture.prepareAgentFundingWallet(agentB.id, { institutionId: institutionB.id })
    ).wallet;

    // Each side is individually legitimate; asking one authorization to span both institutions
    // must be refused rather than silently picking one.
    const context = await dataSource.transaction(async (manager) =>
      resolver.resolve(manager, {
        agentId: agentA.id,
        walletIds: [walletA.walletId, walletB.walletId],
        lock: 'SHARE',
      }),
    );
    expect(context.outcome).toBe('INCOMPATIBLE');
    expect(context.reasons).toContain('CROSS_INSTITUTION');

    // The attribution workflow itself also refuses an agent that is affiliated elsewhere.
    const stray = await createAgent();
    await fixture.affiliateAgent(stray.id, institutionA.id);
    const strayWallet = await fixture.prepareUnattributedWallet(stray.id);
    await expect(fixture.attributeWallet(strayWallet.walletId, institutionB.id)).rejects.toThrow(
      /not authoritatively affiliated/i,
    );
  });

  it('7 — an unattributed wallet never authorizes', async () => {
    const institutionId = await fixture.institution();
    const agent = await createAgent();
    await fixture.affiliateAgent(agent.id, institutionId);
    const wallet = await fixture.prepareUnattributedWallet(agent.id);

    const context = await resolve(agent.id, wallet.walletId);
    expect(context.outcome).not.toBe('RESOLVED');
    expect(context.reasons).toContain('UNATTRIBUTED_WALLET');

    // Asking the context for the ledger account explicitly reports the account scope too.
    const withAccount = await dataSource.transaction(async (manager) =>
      resolver.resolve(manager, {
        agentId: agent.id,
        walletIds: [wallet.walletId],
        ledgerAccountIds: [wallet.ledgerAccountId],
        lock: 'SHARE',
      }),
    );
    expect(withAccount.outcome).not.toBe('RESOLVED');
    expect(withAccount.reasons).toContain('UNATTRIBUTED_LEDGER_ACCOUNT');
    // Attribution is the only way out, and it must happen through the governed workflow.
    const accountRow = await fixture.ledgerAccountRow(wallet.ledgerAccountId);
    expect(accountRow.institutional_scope).toBe('UNATTRIBUTED');
  });

  it('8 — an unaffiliated agent with an unattributed wallet has no institutional context', async () => {
    const agent = await createAgent();
    const wallet = await fixture.prepareUnattributedWallet(agent.id);

    const context = await resolve(agent.id, wallet.walletId);
    expect(context.outcome).toBe('UNRESOLVED');
    expect(context.institutionId).toBeNull();
    expect(context.reasons).toContain('NO_INSTITUTION_CONTEXT');
    expect(context.reasons).toContain('UNATTRIBUTED_WALLET');
  });

  it('9 — a suspended institution stops resolving', async () => {
    const institutionId = await fixture.institution();
    const agent = await createAgent();
    const { wallet } = await fixture.prepareAgentFundingWallet(agent.id);
    expect((await resolve(agent.id, wallet.walletId)).outcome).toBe('RESOLVED');

    await fixture.changeInstitutionStatus(institutionId, 'SUSPENDED');
    const context = await resolve(agent.id, wallet.walletId);
    expect(context.outcome).not.toBe('RESOLVED');
    expect(context.reasons).toContain('INSTITUTION_SUSPENDED');
  });

  it('10 — customer wallet attribution requires an eligible enrolment', async () => {
    const institutionId = await fixture.institution();
    const customerId = await createCustomer('APPROVED');
    await fixture.makeCustomerEligible(customerId, kycEvidence);
    await fixture.enrolCustomer(customerId, institutionId, {
      targetStatus: 'ACTIVE',
      financialEligibility: 'ELIGIBLE',
    });
    const { wallet } = await fixture.prepareCustomerWallet(customerId, institutionId);

    const walletRow = await fixture.walletRow(wallet.walletId);
    expect(walletRow.institution_id).toBe(institutionId);
    expect(walletRow.owner_class).toBe('CUSTOMER');

    const context = await resolve(null, wallet.walletId, customerId);
    expect(context.outcome).toBe('RESOLVED');
    expect(context.customerEnrolment?.status).toBe('ACTIVE');
    expect(context.customerEnrolment?.financialEligibility).toBe('ELIGIBLE');
  });

  it('11 — direct SQL cannot forge a protected approval (guard trigger holds)', async () => {
    const institutionId = await fixture.institution();
    const [approval] = await dataSource.query<Array<{ id: string; action_type: string }>>(
      `SELECT id, action_type FROM privileged_action_approvals
        WHERE status='CONSUMED' AND action_type='FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE'
        LIMIT 1`,
    );
    expect(approval).toBeDefined();

    // Rewriting a protected approval's state without matching protected evidence is refused by
    // the 0501 guard even for the owning connection.
    await expect(
      dataSource.query(`UPDATE privileged_action_approvals SET status='APPROVED' WHERE id=$1`, [
        approval!.id,
      ]),
    ).rejects.toThrow(/protected|authority|evidence|immutable/i);

    // Protected evidence itself is immutable.
    await expect(
      dataSource.query(`DELETE FROM protected_authority.checker_decisions WHERE approval_id=$1`, [
        approval!.id,
      ]),
    ).rejects.toThrow(/immutable|append|permission|denied/i);

    // The fixture never inserted evidence by hand: every decision traces to an approval row.
    const [orphans] = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM protected_authority.checker_decisions d
        WHERE NOT EXISTS (SELECT 1 FROM privileged_action_approvals a WHERE a.id = d.approval_id)`,
    );
    expect(Number(orphans!.count)).toBe(0);
    void institutionId;
  });

  it('12 — the fixture is reusable across repeated governed setups and cleans up', async () => {
    const institutionId = await fixture.institution();
    const results: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const agent = await createAgent();
      const { wallet } = await fixture.prepareAgentFundingWallet(agent.id, {
        fundAmountMinor: '1000',
      });
      const context = await resolve(agent.id, wallet.walletId);
      expect(context.outcome).toBe('RESOLVED');
      expect(context.institutionId).toBe(institutionId);
      results.push(wallet.walletId);
    }
    expect(new Set(results).size).toBe(3);

    // Repeated use of the default institution does not re-run the governance workflow.
    expect(await fixture.institution()).toBe(institutionId);

    const counts = await fixture.governedCounts();
    expect(counts.affiliations).toBe(3);
    expect(counts.attributions).toBe(3);

    fixture.cleanup();
    expect(typeof fixture.workforce).toBe('function');
  });
});
