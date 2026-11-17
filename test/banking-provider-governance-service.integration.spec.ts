import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { BankingProviderGovernanceService } from '../src/banking/banking-provider-governance.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Group 3 acceptance: the governance *service* over migration `1785753600600`.
 *
 * `banking-provider-governance-schema.integration.spec.ts` already proves the database refuses a
 * forged decision. This suite proves the service drives that machinery correctly, and — more
 * importantly — that its own refusals fire *before* the database, so an operator gets an honest
 * error instead of a trigger violation, and so a bad configuration is never stored even briefly.
 *
 * The authorization service is stubbed rather than exercised: authorization itself is covered by its
 * own accepted suites, and driving the real one here would only re-test it. What is stubbed is the
 * *decision*, never the governance logic.
 */
describe('banking provider governance service (real PostgreSQL)', () => {
  let db: DataSource;
  let institutionId: string;
  let service: BankingProviderGovernanceService;
  let allowCalls: boolean;

  const MONNIFY_CAPABILITIES = {
    BANK_DIRECTORY: true,
    ACCOUNT_NAME_ENQUIRY: true,
    VIRTUAL_ACCOUNT_PROVISION: true,
    OUTBOUND_TRANSFER_SUBMIT: true,
    INBOUND_PAYMENT_VERIFY: true,
    SETTLEMENT_VERIFICATION: false,
    PROVIDER_BALANCE_ENQUIRY: false,
  };

  function principal(role: string, id: string): AuthorizationPrincipal {
    return {
      type: 'OPERATOR',
      principalId: id,
      sessionId: randomUUID(),
      roles: [role],
      scopes: [],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    };
  }

  const maker = () => principal('FINANCE_PREPARER', 'maker-1');
  const checker = () => principal('FINANCE_CONTROLLER', 'checker-1');

  function definition(over: { capability?: string; supported?: boolean } = {}) {
    return {
      schemaVersion: 1,
      notes: 'Recorded from Monnify Confluence pages and the Monnify Go SDK constants.',
      capabilities: [
        {
          capability: over.capability ?? 'BANK_DIRECTORY',
          supported: over.supported ?? true,
          evidence: 'GET /api/v1/sdk/transactions/banks — documented on Confluence 220987091',
        },
      ],
    };
  }

  function command(over: Record<string, unknown> = {}) {
    return {
      institutionId,
      requestId: randomUUID(),
      expectedVersion: 0,
      providerKey: 'MONNIFY',
      environment: 'sandbox' as const,
      definition: definition(),
      credentialBundleFingerprint: 'a'.repeat(64),
      routingApproved: false,
      operationalReady: true,
      reason: 'Engage Monnify for agency-banking collections in sandbox',
      ...over,
    };
  }

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkgovsvc');
    institutionId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Banking governance service fixture','PARTNER','fixture')`,
      [institutionId, `BKSVC-${suffix}`, `BKSVC_${suffix}`],
    );
    allowCalls = true;
    const auth = {
      // The stub mirrors only the allow/deny bit; role separation is asserted in the service and in
      // the catalogue, and is covered by the unit assertions below.
      // `await` a resolved promise instead of dropping `async`: the interface is asynchronous and a
      // synchronous stub would hide a missing await in the caller.
      authorize: async () => {
        await Promise.resolve();
        return { allowed: allowCalls };
      },
    };
    service = new BankingProviderGovernanceService(db, auth as never, { dataSource: db } as never, {
      descriptorFor: (key: string) =>
        key === 'MONNIFY'
          ? { key, environments: ['sandbox'], capabilities: MONNIFY_CAPABILITIES }
          : null,
    });
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('refuses an unregistered provider rather than storing a configuration nobody can honour', async () => {
    await expect(
      service.propose(maker(), command({ providerKey: 'NOT_A_PROVIDER' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a configuration claiming a capability the adapter does not advertise', async () => {
    // SETTLEMENT_VERIFICATION exists in the registry but is false: the adapter deliberately refuses it
    // because no documented response schema exists. A configuration asserting it would be a lie that
    // every later check would trust.
    await expect(
      service.propose(
        maker(),
        command({
          definition: definition({ capability: 'SETTLEMENT_VERIFICATION', supported: true }),
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a capability name the registry has never heard of', async () => {
    await expect(
      service.propose(
        maker(),
        command({ definition: definition({ capability: 'WIRE_TRANSFERS' }) }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses routing approval for a provider that is not operational', async () => {
    // Approving routing for an unready provider would send real money over an unconfirmed
    // connection. This must fail before anything is written.
    await expect(
      service.propose(maker(), command({ routingApproved: true, operationalReady: false })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an environment the adapter is not bound to', async () => {
    await expect(
      service.propose(maker(), command({ environment: 'production' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a stale expected version instead of silently overwriting a decision', async () => {
    await expect(service.propose(maker(), command({ expectedVersion: 7 }))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('treats a replayed request id with identical content as idempotent', async () => {
    const requestId = randomUUID();
    const first = await service.propose(maker(), command({ requestId }));
    const second = await service.propose(maker(), command({ requestId }));
    expect(second.replay).toBe(true);
    expect(second.id).toBe(first.id);
    const [count] = await db.query<Array<{ c: string }>>(
      `SELECT count(*)::text AS c FROM banking_provider_configuration_proposals
        WHERE institution_id=$1 AND request_id=$2`,
      [institutionId, requestId],
    );
    expect(count!.c).toBe('1');
  });

  it('refuses to reuse a request id for different content', async () => {
    const requestId = randomUUID();
    await service.propose(maker(), command({ requestId }));
    await expect(
      service.propose(maker(), command({ requestId, reason: 'A completely different reason' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses self-approval — the maker cannot approve their own proposal', async () => {
    const current = await service.view(checker(), institutionId);
    const proposal = await service.propose(
      maker(),
      command({ expectedVersion: current.currentVersion }),
    );
    await expect(service.decide(maker(), institutionId, proposal.id, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const [row] = await db.query<Array<{ state: string }>>(
      'SELECT state FROM banking_provider_configuration_proposals WHERE id=$1',
      [proposal.id],
    );
    expect(row!.state).toBe('REQUESTED');
  });

  it('approves a valid proposal, publishes the next version and records the protected decision', async () => {
    const current = await service.view(checker(), institutionId);
    const expected = current.currentVersion + 1;
    const proposal = await service.propose(
      maker(),
      command({ expectedVersion: current.currentVersion }),
    );
    const decided = await service.decide(checker(), institutionId, proposal.id, true);
    expect(decided).toEqual({ state: 'APPROVED', version: expected });

    const [version] = await db.query<
      Array<{ provider_key: string; maker_id: string; checker_id: string }>
    >(
      'SELECT provider_key,maker_id,checker_id FROM banking_provider_configuration_versions WHERE institution_id=$1 AND version=1',
      [institutionId],
    );
    expect(version).toMatchObject({
      provider_key: 'MONNIFY',
      maker_id: 'maker-1',
      checker_id: 'checker-1',
    });

    const [decision] = await db.query<Array<{ decision: string; payload_digest: string }>>(
      'SELECT decision,payload_digest FROM protected_authority.banking_provider_decisions WHERE proposal_id=$1',
      [proposal.id],
    );
    expect(decision?.decision).toBe('APPROVED');
    expect(decision?.payload_digest).toMatch(/^[0-9a-f]{64}$/);

    const [head] = await db.query<Array<{ version: number }>>(
      'SELECT version FROM banking_provider_configuration_heads WHERE institution_id=$1',
      [institutionId],
    );
    expect(head!.version).toBe(expected);
  });

  it('refuses a second decision on an already-decided proposal', async () => {
    const proposal = await service.propose(maker(), command({ expectedVersion: 1 }));
    await service.decide(checker(), institutionId, proposal.id, false);
    await expect(
      service.decide(checker(), institutionId, proposal.id, true),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records a rejection without publishing a version', async () => {
    const before = await service.view(checker(), institutionId);
    const proposal = await service.propose(
      maker(),
      command({ expectedVersion: before.currentVersion }),
    );
    const decided = await service.decide(checker(), institutionId, proposal.id, false);
    expect(decided.state).toBe('REJECTED');
    const after = await service.view(checker(), institutionId);
    expect(after.currentVersion).toBe(before.currentVersion);
    expect(after.versions).toHaveLength(before.versions.length);
  });

  it('refuses every mode when authorization denies', async () => {
    allowCalls = false;
    try {
      await expect(service.propose(maker(), command())).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.view(checker(), institutionId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    } finally {
      allowCalls = true;
    }
  });

  it('refuses a read-only principal any mutating mode', async () => {
    const readOnly = { ...maker(), readOnlyPrincipal: true };
    await expect(service.propose(readOnly, command())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never stores credential material — only a fingerprint', async () => {
    const columns = await db.query<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='banking_provider_configuration_proposals'
          AND (column_name ILIKE '%secret%' OR column_name ILIKE '%credential%'
               OR column_name ILIKE '%api_key%' OR column_name ILIKE '%password%'
               OR column_name ILIKE '%token%')`,
    );
    expect(columns.map((c) => c.column_name).sort()).toEqual(['credential_bundle_fingerprint']);
  });
});
