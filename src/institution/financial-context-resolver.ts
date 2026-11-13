import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { canonical, sha256 } from '../authorization/workforce-crypto';
import {
  AGENT_INSTITUTION_RESOLVER,
  type AgentInstitutionResolver,
} from './agent-institution-resolver';
import {
  CustomerInstitutionEnrolmentStatus,
  FinancialInstitutionStatus,
  InstitutionFinancialEligibility,
  LedgerInstitutionalPurpose,
  LedgerInstitutionalScope,
} from './institution.enums';
import type {
  CustomerInstitutionEnrolmentView,
  FinancialContext,
  FinancialContextParty,
  FinancialContextReason,
  FinancialContextRequest,
  InstitutionResolution,
} from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DI token: financial products depend on this contract, never on SQL. */
export const FINANCIAL_CONTEXT_RESOLVER = Symbol('FINANCIAL_CONTEXT_RESOLVER');

/**
 * Published financial-context contract (ARENA 4 Phase 2 §5).
 *
 * Allows a financial product to establish and validate, inside its own transaction:
 *
 *  - the agent's institutional affiliation (delegated to the authoritative affiliation resolver);
 *  - the customer's institutional enrolment (identity stays global, eligibility is per institution);
 *  - the source and destination wallet institutional ownership;
 *  - the involved ledger accounts and their institutional scope;
 *  - the institution's operational status;
 *  - compatibility of the parties (no cross-institution mixing, no unattributed bypass).
 *
 * Contract rules, identical in spirit to the affiliation resolver:
 *
 *  1. `manager` is mandatory — the answer belongs to the caller's transaction; nothing is cached.
 *  2. `lock: 'SHARE'` (default) holds row-share locks on wallets, ledger accounts, enrolments and
 *     (through the affiliation resolver) affiliations/institutions until the caller commits, so an
 *     institutional change cannot commit between authorization and posting.
 *  3. The result is a discriminated outcome (`RESOLVED`, `UNRESOLVED`, `NOT_CONFIGURED`,
 *     `INSTITUTION_INACTIVE`, `INCOMPATIBLE`) with explicit reasons — never a bare institution id.
 *  4. `evidenceFingerprint` is deterministic over the outcome and the resolved parties, so a caller
 *     can bind it into its own idempotency or authorization fingerprint.
 *  5. There is no default institution, no aggregator inference and no "assume platform" fallback.
 */
export interface FinancialContextResolver {
  resolve(manager: EntityManager, request: FinancialContextRequest): Promise<FinancialContext>;
}

export function financialContextFingerprint(
  context: Omit<FinancialContext, 'evidenceFingerprint'>,
): string {
  return sha256(
    canonical({
      outcome: context.outcome,
      institutionId: context.institutionId,
      reasons: [...context.reasons].sort(),
      parties: context.parties
        .map((party) => `${party.kind}:${party.id}:${party.institutionId ?? 'null'}`)
        .sort(),
      enrolment: context.customerEnrolment
        ? `${context.customerEnrolment.id}:${context.customerEnrolment.status}:${context.customerEnrolment.financialEligibility}`
        : null,
      affiliation: context.agentAffiliation
        ? `${context.agentAffiliation.outcome}:${context.agentAffiliation.institutionId ?? 'null'}`
        : null,
    }),
  );
}

/**
 * Fail-closed consumption of a context. `RESOLVED` is the only permissive outcome; an unavailable
 * contract or an inactive institution is `503`, an incompatibility is `409`.
 */
export function assertFinancialContextCompatible(context: FinancialContext): FinancialContext {
  if (context.outcome === 'RESOLVED') return context;
  const detail = context.reasons.length > 0 ? context.reasons.join(',') : context.outcome;
  if (context.outcome === 'INCOMPATIBLE') {
    throw new ConflictException(`Institutional financial context is incompatible: ${detail}`);
  }
  throw new ServiceUnavailableException(`Institutional financial context unavailable: ${detail}`);
}

interface WalletPartyRow {
  id: string;
  customer_id: string;
  owner_class: string;
  ledger_account_id: string;
  institution_id: string | null;
}

interface LedgerAccountRow {
  id: string;
  institutional_scope: LedgerInstitutionalScope;
  institution_id: string | null;
  institutional_purpose: LedgerInstitutionalPurpose | null;
}

interface EnrolmentRow {
  id: string;
  reference: string;
  customer_id: string;
  institution_id: string;
  status: CustomerInstitutionEnrolmentStatus;
  status_reason: string | null;
  financial_eligibility: InstitutionFinancialEligibility;
  kyc_reuse_authorized: boolean;
  consent_reference: string | null;
  policy_reference: string | null;
  approval_id: string;
  effective_from: Date;
  effective_to: Date | null;
  version: number;
}

@Injectable()
export class DatabaseFinancialContextResolver implements FinancialContextResolver {
  constructor(
    @Inject(AGENT_INSTITUTION_RESOLVER)
    private readonly affiliations: AgentInstitutionResolver,
  ) {}

  async resolve(
    manager: EntityManager,
    request: FinancialContextRequest,
  ): Promise<FinancialContext> {
    const institutionId = request.institutionId
      ? this.uuid(request.institutionId, 'institutionId')
      : null;
    const agentId = request.agentId ? this.uuid(request.agentId, 'agentId') : null;
    const customerId = request.customerId ? this.uuid(request.customerId, 'customerId') : null;
    const walletIds = (request.walletIds ?? []).map((id) => this.uuid(id, 'walletIds'));
    const ledgerAccountIds = (request.ledgerAccountIds ?? []).map((id) =>
      this.uuid(id, 'ledgerAccountIds'),
    );
    const lock = request.lock !== 'NONE';

    const schema: Array<{ present: boolean }> = await manager.query(
      `SELECT to_regclass('public.customer_institution_enrolments') IS NOT NULL AS present`,
    );
    if (!schema[0]?.present) {
      return this.build({
        outcome: 'NOT_CONFIGURED',
        reasons: ['SCHEMA_NOT_CONFIGURED'],
        institutionId: null,
        institutionStatus: null,
        agentAffiliation: null,
        customerEnrolment: null,
        parties: [],
      });
    }

    const parties: FinancialContextParty[] = [];
    const walletParties: WalletPartyRow[] = [];

    if (walletIds.length > 0) {
      const rows: WalletPartyRow[] = await manager.query(
        `SELECT id, customer_id, owner_class, ledger_account_id, institution_id
           FROM wallet_accounts WHERE id = ANY($1::uuid[]) ORDER BY id${lock ? ' FOR SHARE' : ''}`,
        [walletIds],
      );
      if (rows.length !== new Set(walletIds).size) {
        throw new NotFoundException('A referenced wallet was not found');
      }
      for (const row of rows) {
        walletParties.push(row);
        parties.push({
          kind: 'WALLET',
          id: row.id,
          ledgerAccountId: row.ledger_account_id,
          ownerClass: row.owner_class,
          ownerReference: row.customer_id,
          institutionId: row.institution_id,
          institutionalScope:
            row.institution_id === null
              ? LedgerInstitutionalScope.UNATTRIBUTED
              : LedgerInstitutionalScope.INSTITUTION,
          institutionalPurpose: null,
        });
      }
    }

    const accountIds = [
      ...new Set([...ledgerAccountIds, ...walletParties.map((row) => row.ledger_account_id)]),
    ];
    const accountsById = new Map<string, LedgerAccountRow>();
    if (accountIds.length > 0) {
      const rows: LedgerAccountRow[] = await manager.query(
        `SELECT id, institutional_scope, institution_id, institutional_purpose
           FROM ledger_accounts WHERE id = ANY($1::uuid[])${lock ? ' FOR SHARE' : ''}`,
        [accountIds],
      );
      if (rows.length !== accountIds.length) {
        throw new NotFoundException('A referenced ledger account was not found');
      }
      for (const row of rows) {
        accountsById.set(row.id, row);
        if (!ledgerAccountIds.includes(row.id)) continue;
        parties.push({
          kind: 'LEDGER_ACCOUNT',
          id: row.id,
          ledgerAccountId: row.id,
          ownerClass: null,
          ownerReference: null,
          institutionId: row.institution_id,
          institutionalScope: row.institutional_scope,
          institutionalPurpose: row.institutional_purpose,
        });
      }
      // Wallets inherit their ledger account's scope for completeness of the evidence payload.
      for (const party of parties) {
        if (party.kind !== 'WALLET' || !party.ledgerAccountId) continue;
        const account = accountsById.get(party.ledgerAccountId);
        if (!account) continue;
        (
          party as { institutionalPurpose: LedgerInstitutionalPurpose | null }
        ).institutionalPurpose = account.institutional_purpose;
      }
    }

    // --------------------------------------------------- agent affiliation (authoritative)
    let agentAffiliation: InstitutionResolution | null = null;
    if (agentId) {
      agentAffiliation = await this.affiliations.resolve(manager, agentId, {
        lock: lock ? 'SHARE' : 'NONE',
      });
    }

    // --------------------------------------------------------- institution candidate set
    const candidates = new Set<string>();
    if (institutionId) candidates.add(institutionId);
    for (const party of parties) {
      if (
        party.institutionId &&
        party.institutionalScope === LedgerInstitutionalScope.INSTITUTION
      ) {
        candidates.add(party.institutionId);
      }
    }
    if (agentAffiliation?.outcome === 'RESOLVED' && agentAffiliation.institutionId) {
      candidates.add(agentAffiliation.institutionId);
    }

    const reasons = new Set<FinancialContextReason>();

    if (candidates.size > 1) {
      reasons.add('CROSS_INSTITUTION');
      return this.build({
        outcome: 'INCOMPATIBLE',
        reasons: [...reasons],
        institutionId: null,
        institutionStatus: null,
        agentAffiliation,
        customerEnrolment: null,
        parties,
      });
    }

    if (candidates.size === 0) {
      if (parties.some((party) => party.kind === 'WALLET')) reasons.add('UNATTRIBUTED_WALLET');
      if (
        parties.some(
          (party) =>
            party.kind === 'LEDGER_ACCOUNT' &&
            party.institutionalScope === LedgerInstitutionalScope.UNATTRIBUTED,
        )
      ) {
        reasons.add('UNATTRIBUTED_LEDGER_ACCOUNT');
      }
      reasons.add('NO_INSTITUTION_CONTEXT');
      return this.build({
        outcome: 'UNRESOLVED',
        reasons: [...reasons],
        institutionId: null,
        institutionStatus: null,
        agentAffiliation,
        customerEnrolment: null,
        parties,
      });
    }

    const resolvedInstitutionId = [...candidates][0]!;
    const institutions: Array<{ id: string; status: FinancialInstitutionStatus }> =
      await manager.query(
        `SELECT id, status FROM financial_institutions WHERE id = $1 AND deleted_at IS NULL${
          lock ? ' FOR SHARE' : ''
        }`,
        [resolvedInstitutionId],
      );
    if (institutions.length === 0) throw new NotFoundException('Institution not found');
    const institutionStatus = institutions[0]!.status;

    if (institutionStatus !== FinancialInstitutionStatus.APPROVED) {
      reasons.add('INSTITUTION_NOT_APPROVED');
      if (institutionStatus === FinancialInstitutionStatus.SUSPENDED) {
        reasons.add('INSTITUTION_SUSPENDED');
      }
    }

    for (const party of parties) {
      if (party.kind === 'WALLET' && party.institutionId === null) {
        reasons.add('UNATTRIBUTED_WALLET');
      }
      if (party.kind === 'LEDGER_ACCOUNT') {
        if (party.institutionalScope === LedgerInstitutionalScope.UNATTRIBUTED) {
          reasons.add('UNATTRIBUTED_LEDGER_ACCOUNT');
        }
        if (party.institutionalScope === LedgerInstitutionalScope.PLATFORM) {
          reasons.add('PLATFORM_ACCOUNT_IN_INSTITUTIONAL_CONTEXT');
        }
      }
    }
    if (
      parties.some(
        (party) => party.institutionId !== null && party.institutionId !== resolvedInstitutionId,
      )
    ) {
      reasons.add('CROSS_INSTITUTION');
    }

    if (agentId) {
      if (agentAffiliation?.outcome !== 'RESOLVED') {
        reasons.add('AGENT_AFFILIATION_UNAVAILABLE');
      } else if (agentAffiliation.institutionId !== resolvedInstitutionId) {
        reasons.add('CROSS_INSTITUTION');
      }
    }

    // ------------------------------------------------------- customer enrolment (per institution)
    let customerEnrolment: CustomerInstitutionEnrolmentView | null = null;
    if (customerId) {
      const rows: EnrolmentRow[] = await manager.query(
        `SELECT * FROM customer_institution_enrolments
          WHERE customer_id = $1 AND institution_id = $2 LIMIT 1${lock ? ' FOR SHARE' : ''}`,
        [customerId, resolvedInstitutionId],
      );
      const row = rows[0];
      if (!row) {
        reasons.add('CUSTOMER_NOT_ENROLLED');
      } else {
        customerEnrolment = this.enrolmentView(row);
        if (row.status === CustomerInstitutionEnrolmentStatus.SUSPENDED) {
          reasons.add('ENROLMENT_SUSPENDED');
        } else if (row.status !== CustomerInstitutionEnrolmentStatus.ACTIVE) {
          reasons.add('CUSTOMER_NOT_ENROLLED');
        }
        if (row.financial_eligibility !== InstitutionFinancialEligibility.ELIGIBLE) {
          reasons.add('CUSTOMER_NOT_ELIGIBLE');
        }
      }
    }

    const institutionInactive = institutionStatus !== FinancialInstitutionStatus.APPROVED;
    const outcome: FinancialContext['outcome'] = institutionInactive
      ? 'INSTITUTION_INACTIVE'
      : reasons.size > 0
        ? 'INCOMPATIBLE'
        : 'RESOLVED';

    return this.build({
      outcome,
      reasons: [...reasons],
      institutionId: resolvedInstitutionId,
      institutionStatus,
      agentAffiliation,
      customerEnrolment,
      parties,
    });
  }

  private build(
    context: Omit<FinancialContext, 'resolvedAt' | 'evidenceFingerprint'>,
  ): FinancialContext {
    const withTime = { ...context, resolvedAt: new Date().toISOString() };
    return { ...withTime, evidenceFingerprint: financialContextFingerprint(withTime) };
  }

  private enrolmentView(row: EnrolmentRow): CustomerInstitutionEnrolmentView {
    return {
      id: row.id,
      reference: row.reference,
      customerId: row.customer_id,
      institutionId: row.institution_id,
      status: row.status,
      statusReason: row.status_reason,
      financialEligibility: row.financial_eligibility,
      kycReuseAuthorized: row.kyc_reuse_authorized,
      consentReference: row.consent_reference,
      policyReference: row.policy_reference,
      approvalId: row.approval_id,
      effectiveFrom: row.effective_from.toISOString(),
      effectiveTo: row.effective_to?.toISOString() ?? null,
      version: row.version,
    };
  }

  private uuid(value: string, field: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }
}

/**
 * Explicit non-configured resolver for tests and dry runs only. It never fabricates an institution:
 * every request reports `NOT_CONFIGURED` so a caller must fail closed.
 */
@Injectable()
export class NotConfiguredFinancialContextResolver implements FinancialContextResolver {
  resolve(_manager: EntityManager, request: FinancialContextRequest): Promise<FinancialContext> {
    const withTime = {
      outcome: 'NOT_CONFIGURED' as const,
      reasons: ['SCHEMA_NOT_CONFIGURED'] as FinancialContextReason[],
      institutionId: request.institutionId ?? null,
      institutionStatus: null,
      agentAffiliation: null,
      customerEnrolment: null,
      parties: [],
      resolvedAt: new Date().toISOString(),
    };
    return Promise.resolve({
      ...withTime,
      evidenceFingerprint: financialContextFingerprint(withTime),
    });
  }
}
