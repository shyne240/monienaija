import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuthenticationSessionService } from '../customer-authentication/authentication-session.service';
import { AuditService } from '../operations/audit.service';
import { isRetryableTransactionError } from '../payment/payment-support';
import { InboundFundingService } from '../virtual-account/inbound-funding.service';
import {
  A7_INBOUND_EXECUTION_AUTHORITY,
  type A7InboundExecutionAuthority,
} from './a7-inbound-execution-authority';
import { A7_INBOUND_ADMISSION_PROFILE } from './a7-inbound-admission.profile';
import {
  A7_INBOUND_ADMISSION_AUTHORITY,
  type A7InboundAdmissionAuthority,
} from './a7-inbound-admission-authority';
import { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';
import { PolicyDecisionRecord } from './policy-decision-record.entity';
import { ImmutableEvidenceSnapshotAttachment } from './immutable-evidence-snapshot-attachment.entity';
import { entityToDecision, entityToSnapshot } from './capability-policy-persistence.mappers';
import {
  calculatePolicyDecisionResultHash,
  calculateSnapshotInputHash,
} from './capability-policy.service';
import { A7_PRODUCT_POLICY_PROFILES } from './a7-product-policy.profiles';
import type { PolicyObligation } from './capability-policy.types';

export type A7PersistedOperationType = 'VIRTUAL_ACCOUNT_ASSIGN' | 'INBOUND_FUNDING';
export type A7PersistedState =
  | 'LIFECYCLE_PENDING'
  | 'LIFECYCLE_ADMITTED'
  | 'LIFECYCLE_UNKNOWN'
  | 'LIFECYCLE_MANUAL_REVIEW'
  | 'LIFECYCLE_CANCELLED'
  | 'LIFECYCLE_CREDITED';
export interface A7CreatePersistedCommand {
  token: string;
  operationType: A7PersistedOperationType;
  bindingId: string;
  virtualAccountId?: string | null;
  inboundObservationId?: string | null;
  intendedAmountMinor?: string | null;
  policyDecisionReference?: string | null;
  idempotencyKey: string;
}
export interface A7PersistedCommand {
  id: string;
  command_reference: string;
  operation_type: A7PersistedOperationType;
  customer_id: string;
  session_id: string;
  authorization_event_id: string;
  binding_id: string;
  binding_version: number;
  customer_wallet_id: string;
  wallet_account_id: string;
  ledger_account_id: string;
  virtual_account_id: string | null;
  inbound_observation_id: string | null;
  intended_amount_minor: string | null;
  policy_decision_reference: string | null;
  request_hash: string;
  created_at: Date;
}
export interface A7PersistedLifecycle {
  id: string;
  lifecycle_reference: string;
  command_id: string;
  state: A7PersistedState;
  version: number;
  execution_receipt_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSITIONS: Readonly<Record<A7PersistedState, readonly A7PersistedState[]>> = {
  LIFECYCLE_PENDING: ['LIFECYCLE_ADMITTED', 'LIFECYCLE_CANCELLED'],
  // Provider-derived states require independent evidence, not customer assertions.
  LIFECYCLE_ADMITTED: [],
  LIFECYCLE_UNKNOWN: [],
  LIFECYCLE_MANUAL_REVIEW: [],
  LIFECYCLE_CANCELLED: [],
  LIFECYCLE_CREDITED: [],
};

/** Nonfinancial A7 persistence boundary. No method posts or authorizes value movement. */
@Injectable()
export class A7ProductPersistenceService {
  constructor(
    private readonly db: DataSource,
    private readonly sessions: AuthenticationSessionService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly eligibility: CustomerFinancialEligibilityService,
    @Inject(A7_INBOUND_ADMISSION_AUTHORITY)
    private readonly inboundAuthority: A7InboundAdmissionAuthority,
    private readonly inboundFunding: InboundFundingService,
    @Inject(A7_INBOUND_EXECUTION_AUTHORITY)
    private readonly executionAuthority: A7InboundExecutionAuthority,
  ) {}

  async create(
    input: A7CreatePersistedCommand,
  ): Promise<{ command: A7PersistedCommand; lifecycle: A7PersistedLifecycle; replayed: boolean }> {
    const principal = await this.authenticate(input.token);
    const bindingId = this.uuid(input.bindingId);
    const virtualAccountId = input.virtualAccountId ? this.uuid(input.virtualAccountId) : null;
    const observationId = input.inboundObservationId ? this.uuid(input.inboundObservationId) : null;
    const intendedAmount = input.intendedAmountMinor ?? null;
    if (
      intendedAmount !== null &&
      (typeof intendedAmount !== 'string' ||
        !/^[1-9][0-9]{0,18}$/.test(intendedAmount) ||
        BigInt(intendedAmount) > 9223372036854775807n)
    )
      throw new BadRequestException('Invalid inbound intended amount');
    if (!['VIRTUAL_ACCOUNT_ASSIGN', 'INBOUND_FUNDING'].includes(input.operationType))
      throw new BadRequestException('Invalid A7 operation type');
    if (
      input.operationType === 'VIRTUAL_ACCOUNT_ASSIGN' &&
      (virtualAccountId || observationId || intendedAmount)
    )
      throw new BadRequestException('Assignment does not accept inbound evidence');
    if (observationId && !virtualAccountId)
      throw new BadRequestException('Observation requires a virtual account');
    const policy = input.policyDecisionReference?.trim() || null;
    if (policy && policy.length > 180) throw new BadRequestException('Invalid policy reference');
    const keyHash = this.key(input.idempotencyKey);
    const requestHash = this.hash(
      JSON.stringify({
        operationType: input.operationType,
        bindingId,
        virtualAccountId,
        observationId,
        policy,
        ...(intendedAmount === null ? {} : { intendedAmount }),
      }),
    );
    return this.retry(async (manager) => {
      await this.lockSession(manager, principal.sessionId, principal.customerId);
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `a7-command:${principal.customerId}:${keyHash}`,
      ]);
      const existing = await manager.query<A7PersistedCommand[]>(
        'SELECT * FROM a7_product_commands WHERE customer_id=$1 AND idempotency_key_hash=$2',
        [principal.customerId, keyHash],
      );
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new ConflictException('A7 idempotency key conflict');
        const lifecycle = await manager.query<A7PersistedLifecycle[]>(
          'SELECT * FROM a7_product_lifecycles WHERE command_id=$1',
          [existing[0].id],
        );
        if (!lifecycle[0]) throw new ConflictException('A7 lifecycle missing');
        return { command: existing[0], lifecycle: lifecycle[0], replayed: true };
      }
      const bindings = await manager.query<
        Array<{
          id: string;
          version: number;
          customer_wallet_id: string;
          wallet_account_id: string;
          ledger_account_id: string;
        }>
      >(
        `SELECT b.id,b.version,b.customer_wallet_id,b.wallet_account_id,b.ledger_account_id
           FROM customer_financial_account_bindings b
           JOIN customers c ON c.id=b.customer_id
           JOIN customer_wallets cw ON cw.id=b.customer_wallet_id AND cw.customer_id=c.id
           JOIN wallet_ownerships o ON o.wallet_id=cw.id AND o.customer_id=c.id
           JOIN wallet_accounts w ON w.id=b.wallet_account_id AND w.customer_id=c.id::text AND w.ledger_account_id=b.ledger_account_id
           JOIN ledger_accounts la ON la.id=b.ledger_account_id
          WHERE b.id=$1 AND c.id=$2 AND b.state='ACTIVE' AND b.currency='NGN' AND b.accounting_unit='CUSTOMER_FUNDS'
            AND c.status='ACTIVE' AND c.deleted_at IS NULL AND c.version=b.source_customer_version
            AND cw.status='ACTIVE' AND cw.deleted_at IS NULL AND cw.version=b.source_customer_wallet_version AND cw.currency='NGN'
            AND o.deleted_at IS NULL AND w.status='ACTIVE' AND w.currency='NGN' AND w.owner_class='CUSTOMER'
            AND wallet_owner_class(w.customer_id)='CUSTOMER' AND la.is_active AND NOT la.allow_negative_balance
            AND la.currency='NGN' AND la.accounting_unit='CUSTOMER_FUNDS' AND la.account_type='LIABILITY' AND la.normal_balance='CREDIT'
          FOR SHARE OF b,c,cw,o,w,la`,
        [bindingId, principal.customerId],
      );
      const binding = bindings[0];
      if (!binding) throw new ConflictException('A7 destination binding unavailable or inactive');
      let observation:
        | { provider_key: string; provider_reference_hash: string; amount_minor: string }
        | undefined;
      if (virtualAccountId) {
        const accounts = await manager.query<Array<{ id: string }>>(
          `SELECT id FROM virtual_accounts WHERE id=$1 AND wallet_id=$2 AND status='ACTIVE' FOR SHARE`,
          [virtualAccountId, binding.wallet_account_id],
        );
        if (!accounts[0]) throw new ConflictException('Virtual account does not match destination');
      }
      if (observationId) {
        const rows = await manager.query<
          Array<{ provider_key: string; provider_reference_hash: string; amount_minor: string }>
        >(
          `SELECT o.provider_key,o.provider_reference_hash,o.amount_minor::text FROM inbound_funding_observations o JOIN virtual_accounts v
          ON v.provider=o.provider_key AND v.bank_code=o.bank_code AND v.account_number=o.account_number
          WHERE o.id=$1 AND v.id=$2 AND o.currency='NGN' FOR SHARE OF o,v`,
          [observationId, virtualAccountId],
        );
        observation = rows[0];
        if (!observation)
          throw new ConflictException('Inbound observation does not match destination');
        if (intendedAmount && observation.amount_minor !== intendedAmount)
          throw new ConflictException('Inbound observation amount does not match intent');
        const conflicts = await manager.query<Array<{ id: string }>>(
          `SELECT id FROM inbound_funding_observations WHERE provider_key=$1 AND provider_reference_hash=$2 AND id<>$3`,
          [observation.provider_key, observation.provider_reference_hash, observationId],
        );
        if (conflicts.length) throw new ConflictException('Conflicting inbound observations');
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `a7-observation:${observation.provider_key}:${observation.provider_reference_hash}`,
        ]);
        const used = await manager.query<Array<{ id: string }>>(
          'SELECT id FROM a7_product_commands WHERE inbound_provider_key=$1 AND inbound_reference_hash=$2',
          [observation.provider_key, observation.provider_reference_hash],
        );
        if (used.length)
          throw new ConflictException('Inbound observation already has an A7 command');
      }
      if (policy)
        await this.checkPolicy(
          manager,
          policy,
          principal.customerId,
          input.operationType,
          bindingId,
          false,
        );
      const id = randomUUID();
      const lifecycleId = randomUUID();
      const auth = await this.recordAuthorization(
        manager,
        principal.customerId,
        principal.sessionId,
        id,
        'create',
      );
      const rows = await manager.query<A7PersistedCommand[]>(
        `INSERT INTO a7_product_commands
        (id,command_reference,operation_type,customer_id,session_id,authorization_event_id,binding_id,binding_version,customer_wallet_id,wallet_account_id,ledger_account_id,virtual_account_id,policy_decision_reference,inbound_observation_id,inbound_provider_key,inbound_reference_hash,idempotency_key_hash,request_hash,intended_amount_minor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [
          id,
          `a7-product-command:v2:${id}`,
          input.operationType,
          principal.customerId,
          principal.sessionId,
          auth,
          binding.id,
          binding.version,
          binding.customer_wallet_id,
          binding.wallet_account_id,
          binding.ledger_account_id,
          virtualAccountId,
          policy,
          observationId,
          observation?.provider_key ?? null,
          observation?.provider_reference_hash ?? null,
          keyHash,
          requestHash,
          intendedAmount,
        ],
      );
      const lifecycles = await manager.query<A7PersistedLifecycle[]>(
        `INSERT INTO a7_product_lifecycles(id,lifecycle_reference,command_id,state,version) VALUES($1,$2,$3,'LIFECYCLE_PENDING',1) RETURNING *`,
        [lifecycleId, `a7-product-lifecycle:v2:${lifecycleId}`, id],
      );
      await this.audit.record(manager, {
        entityType: 'A7_PRODUCT_COMMAND',
        entityId: id,
        action: 'CREATED',
        actor: principal.customerId,
        newValues: {
          operationType: input.operationType,
          lifecycleId,
          bindingId,
          observationId,
          policyDecisionReference: policy,
        },
      });
      return { command: rows[0]!, lifecycle: lifecycles[0]!, replayed: false };
    });
  }

  async transition(input: {
    token: string;
    lifecycleId: string;
    expectedVersion: number;
    nextState: A7PersistedState;
    idempotencyKey: string;
  }): Promise<{ lifecycle: A7PersistedLifecycle; replayed: boolean }> {
    const principal = await this.authenticate(input.token);
    const lifecycleId = this.uuid(input.lifecycleId);
    const keyHash = this.key(input.idempotencyKey);
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !(input.nextState in TRANSITIONS)
    )
      throw new BadRequestException('Invalid A7 transition');
    const requestHash = this.hash(
      JSON.stringify({
        lifecycleId,
        expectedVersion: input.expectedVersion,
        nextState: input.nextState,
      }),
    );
    return this.retry(async (manager) => {
      await this.lockSession(manager, principal.sessionId, principal.customerId);
      const rows = await manager.query<
        Array<
          A7PersistedLifecycle & {
            customer_id: string;
            policy_decision_reference: string | null;
            operation_type: A7PersistedOperationType;
            binding_id: string;
            binding_version: number;
            customer_wallet_id: string;
            wallet_account_id: string;
            ledger_account_id: string;
            authorization_event_id: string;
            session_id: string;
            command_reference: string;
            virtual_account_id: string | null;
            inbound_observation_id: string | null;
            intended_amount_minor: string | null;
          }
        >
      >(
        `SELECT l.*,c.customer_id,c.policy_decision_reference,c.operation_type,c.binding_id,c.binding_version,c.customer_wallet_id,c.wallet_account_id,c.ledger_account_id,c.authorization_event_id,c.session_id,c.command_reference,c.virtual_account_id,c.inbound_observation_id,c.intended_amount_minor FROM a7_product_lifecycles l JOIN a7_product_commands c ON c.id=l.command_id WHERE l.id=$1 AND c.customer_id=$2 FOR UPDATE OF l`,
        [lifecycleId, principal.customerId],
      );
      const current = rows[0];
      if (!current) throw new ConflictException('A7 lifecycle unavailable');
      const prior = await manager.query<
        Array<{ request_hash: string; to_version: number; to_state: A7PersistedState }>
      >(
        'SELECT request_hash,to_version,to_state FROM a7_product_lifecycle_transitions WHERE lifecycle_id=$1 AND idempotency_key_hash=$2',
        [lifecycleId, keyHash],
      );
      if (prior[0]) {
        if (prior[0].request_hash !== requestHash)
          throw new ConflictException('A7 transition idempotency conflict');
        // Replay never manufactures a historical current state.
        return { lifecycle: current, replayed: true };
      }
      if (current.version !== input.expectedVersion)
        throw new ConflictException('A7 lifecycle version conflict');
      if (!TRANSITIONS[current.state].includes(input.nextState))
        throw new ConflictException('Invalid A7 lifecycle transition');
      let admissionEvidence: Record<string, string | null> | null = null;
      if (input.nextState === 'LIFECYCLE_ADMITTED') {
        await this.recheckCommandAuthority(manager, current);
        if (!current.policy_decision_reference)
          throw new ConflictException('A7 policy decision is missing');
        await this.checkPolicy(
          manager,
          current.policy_decision_reference,
          principal.customerId,
          current.operation_type,
          current.binding_id,
          true,
          current.intended_amount_minor,
        );
        if (current.operation_type !== 'INBOUND_FUNDING')
          throw new ServiceUnavailableException('A7 assignment admission authority unavailable');
        if (!current.virtual_account_id) throw new ConflictException('Inbound route is missing');
        if (!current.intended_amount_minor)
          throw new ConflictException('Inbound intended amount is missing');
        // Recheck the creator's authorization as well as the current authenticated caller.
        await this.lockSession(manager, current.session_id, current.customer_id);
        await this.eligibility.require(manager, current.customer_id);
        const routes = await manager.query<Array<{ id: string }>>(
          `SELECT id FROM virtual_accounts WHERE id=$1 AND wallet_id=$2 AND status='ACTIVE' FOR SHARE`,
          [current.virtual_account_id, current.wallet_account_id],
        );
        if (!routes[0]) throw new ConflictException('Inbound route is stale or mismatched');
        if (current.inbound_observation_id) {
          const observations = await manager.query<
            Array<{ provider_key: string; provider_reference_hash: string }>
          >(
            `SELECT o.provider_key,o.provider_reference_hash FROM inbound_funding_observations o JOIN virtual_accounts v ON v.id=$2 AND v.provider=o.provider_key AND v.bank_code=o.bank_code AND v.account_number=o.account_number WHERE o.id=$1 AND o.amount_minor=$3 AND o.currency='NGN' FOR SHARE OF o,v`,
            [
              current.inbound_observation_id,
              current.virtual_account_id,
              current.intended_amount_minor,
            ],
          );
          const observation = observations[0];
          if (!observation) throw new ConflictException('Inbound observation is mismatched');
          const conflicting = await manager.query<Array<{ id: string }>>(
            'SELECT id FROM inbound_funding_observations WHERE provider_key=$1 AND provider_reference_hash=$2 AND id<>$3 FOR SHARE',
            [
              observation.provider_key,
              observation.provider_reference_hash,
              current.inbound_observation_id,
            ],
          );
          if (conflicting.length) throw new ConflictException('Conflicting inbound observations');
        }
        let authority: Awaited<ReturnType<A7InboundAdmissionAuthority['recheck']>>;
        try {
          authority = await this.inboundAuthority.recheck(manager, {
            commandId: current.command_id,
            commandReference: current.command_reference,
            customerId: current.customer_id,
            sessionId: current.session_id,
            bindingId: current.binding_id,
            bindingVersion: current.binding_version,
            customerWalletId: current.customer_wallet_id,
            walletAccountId: current.wallet_account_id,
            ledgerAccountId: current.ledger_account_id,
            virtualAccountId: current.virtual_account_id,
            policyDecisionReference: current.policy_decision_reference,
            inboundObservationId: current.inbound_observation_id,
            intendedAmountMinor: current.intended_amount_minor,
          });
        } catch {
          throw new ServiceUnavailableException('Inbound admission authority unavailable');
        }
        if (authority.status === 'UNAVAILABLE')
          throw new ServiceUnavailableException('Inbound admission authority unavailable');
        if (authority.status !== 'AUTHORIZED')
          throw new ConflictException('Inbound admission authority denied');
        const evidence = authority.evidenceReferences;
        if (
          !evidence ||
          ![evidence.route, evidence.limits, evidence.compliance, evidence.institution].every(
            (x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 180,
          ) ||
          !(
            evidence.consent === null ||
            (typeof evidence.consent === 'string' &&
              evidence.consent.trim().length > 0 &&
              evidence.consent.length <= 180)
          )
        )
          throw new ConflictException('Inbound authority evidence references missing');
        admissionEvidence = { ...evidence };
      }
      const auth = await this.recordAuthorization(
        manager,
        principal.customerId,
        principal.sessionId,
        current.command_id,
        'transition',
      );
      await manager.query(
        `INSERT INTO a7_product_lifecycle_transitions(id,lifecycle_id,from_state,to_state,from_version,to_version,authorization_event_id,idempotency_key_hash,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(),
          lifecycleId,
          current.state,
          input.nextState,
          current.version,
          current.version + 1,
          auth,
          keyHash,
          requestHash,
        ],
      );
      const updated = await manager.query<A7PersistedLifecycle[]>(
        `WITH changed AS (UPDATE a7_product_lifecycles SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *) SELECT * FROM changed`,
        [lifecycleId, input.nextState],
      );
      await this.audit.record(manager, {
        entityType: 'A7_PRODUCT_LIFECYCLE',
        entityId: lifecycleId,
        action: 'TRANSITIONED',
        actor: principal.customerId,
        newValues: {
          fromState: current.state,
          toState: input.nextState,
          version: current.version + 1,
          admissionEvidence,
        },
      });
      return { lifecycle: updated[0]!, replayed: false };
    });
  }

  async findCommand(reference: string): Promise<A7PersistedCommand | null> {
    return readPersistedA7Command(this.db, reference);
  }
  async findLifecycle(reference: string): Promise<A7PersistedLifecycle | null> {
    return readPersistedA7Lifecycle(this.db, reference);
  }

  /** Execute only an admitted command that already names a durably verified observation.
   * Receipt, posting, authorization, lifecycle and authority limit consumption commit together. */
  async executeInbound(input: {
    token: string;
    lifecycleId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }) {
    const principal = await this.authenticate(input.token);
    const lifecycleId = this.uuid(input.lifecycleId);
    const keyHash = this.key(input.idempotencyKey);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
      throw new BadRequestException('Invalid A7 execution version');
    const requestHash = this.hash(
      JSON.stringify({
        lifecycleId,
        expectedVersion: input.expectedVersion,
        nextState: 'LIFECYCLE_CREDITED',
      }),
    );
    return this.retry(async (manager) => {
      await this.lockSession(manager, principal.sessionId, principal.customerId);
      const rows = await manager.query<
        Array<
          A7PersistedLifecycle & {
            customer_id: string;
            policy_decision_reference: string | null;
            operation_type: A7PersistedOperationType;
            binding_id: string;
            binding_version: number;
            customer_wallet_id: string;
            wallet_account_id: string;
            ledger_account_id: string;
            authorization_event_id: string;
            session_id: string;
            virtual_account_id: string | null;
            inbound_observation_id: string | null;
            intended_amount_minor: string | null;
          }
        >
      >(
        `SELECT l.*,c.customer_id,c.policy_decision_reference,c.operation_type,c.binding_id,c.binding_version,c.customer_wallet_id,c.wallet_account_id,c.ledger_account_id,c.authorization_event_id,c.session_id,c.virtual_account_id,c.inbound_observation_id,c.intended_amount_minor FROM a7_product_lifecycles l JOIN a7_product_commands c ON c.id=l.command_id WHERE l.id=$1 AND c.customer_id=$2 FOR UPDATE OF l`,
        [lifecycleId, principal.customerId],
      );
      const current = rows[0];
      if (!current) throw new ConflictException('A7 lifecycle unavailable');
      const prior = await manager.query<Array<{ request_hash: string; to_state: string }>>(
        'SELECT request_hash,to_state FROM a7_product_lifecycle_transitions WHERE lifecycle_id=$1 AND idempotency_key_hash=$2',
        [lifecycleId, keyHash],
      );
      if (prior[0]) {
        if (prior[0].request_hash !== requestHash || prior[0].to_state !== 'LIFECYCLE_CREDITED')
          throw new ConflictException('A7 execution idempotency conflict');
        if (current.state !== 'LIFECYCLE_CREDITED' || !current.execution_receipt_id)
          throw new ConflictException('A7 execution evidence missing');
        return { lifecycle: current, replayed: true };
      }
      if (current.version !== input.expectedVersion || current.state !== 'LIFECYCLE_ADMITTED')
        throw new ConflictException('A7 execution lifecycle conflict');
      if (
        current.operation_type !== 'INBOUND_FUNDING' ||
        !current.inbound_observation_id ||
        !current.virtual_account_id ||
        !current.intended_amount_minor ||
        !current.policy_decision_reference
      )
        throw new ConflictException('A7 verified inbound obligation is missing');
      await this.lockSession(manager, current.session_id, current.customer_id);
      await this.recheckCommandAuthority(manager, current);
      await this.checkPolicy(
        manager,
        current.policy_decision_reference,
        current.customer_id,
        current.operation_type,
        current.binding_id,
        true,
        current.intended_amount_minor,
      );
      await this.eligibility.require(manager, current.customer_id);
      const observations = await manager.query<
        Array<{
          id: string;
          provider_key: string;
          provider_reference: string;
          provider_reference_hash: string;
          evidence_hash: string;
          amount_minor: string;
          currency: string;
        }>
      >(
        `SELECT o.id,o.provider_key,o.provider_reference,o.provider_reference_hash,o.evidence_hash,o.amount_minor::text,o.currency FROM inbound_funding_observations o JOIN virtual_accounts v ON v.id=$2 AND v.wallet_id=$3 AND v.status='ACTIVE' AND v.provider=o.provider_key AND v.bank_code=o.bank_code AND v.account_number=o.account_number WHERE o.id=$1 AND o.amount_minor=$4 AND o.currency='NGN' FOR SHARE OF o,v`,
        [
          current.inbound_observation_id,
          current.virtual_account_id,
          current.wallet_account_id,
          current.intended_amount_minor,
        ],
      );
      const obs = observations[0];
      if (!obs) throw new ConflictException('A7 verified observation does not match obligation');
      let authority: Awaited<ReturnType<A7InboundExecutionAuthority['authorize']>>;
      try {
        authority = await this.executionAuthority.authorize(manager, {
          commandId: current.command_id,
          customerId: current.customer_id,
          bindingId: current.binding_id,
          virtualAccountId: current.virtual_account_id,
          walletAccountId: current.wallet_account_id,
          observationId: obs.id,
          providerKey: obs.provider_key,
          providerReferenceHash: obs.provider_reference_hash,
          evidenceHash: obs.evidence_hash,
          amountMinor: obs.amount_minor,
          currency: obs.currency,
          admissionPolicyReference: current.policy_decision_reference,
        });
      } catch {
        throw new ServiceUnavailableException('Inbound execution authority unavailable');
      }
      if (authority.status === 'UNAVAILABLE')
        throw new ServiceUnavailableException('Inbound execution authority unavailable');
      if (authority.status !== 'AUTHORIZED')
        throw new ConflictException('Inbound execution authority denied');
      if (
        ![
          authority.policyReference,
          authority.obligationReference,
          authority.limitReference,
          authority.institutionReference,
        ].every((x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 180)
      )
        throw new ConflictException('Inbound execution evidence missing');
      const result = await this.inboundFunding.receiveInTransaction(manager, {
        providerKey: obs.provider_key,
        providerReference: obs.provider_reference,
        correlationId: `a7-execution:${lifecycleId}`,
        expectedWalletAccountId: current.wallet_account_id,
        expectedAmountMinor: current.intended_amount_minor,
        expectedCurrency: 'NGN',
        allowSuspense: false,
      });
      if (result.status !== 'CREDITED' || result.replayed)
        throw new ConflictException('Inbound receipt already used or requires review');
      const auth = await this.recordAuthorization(
        manager,
        principal.customerId,
        principal.sessionId,
        current.command_id,
        'transition',
      );
      await manager.query(
        `INSERT INTO a7_product_lifecycle_transitions(id,lifecycle_id,from_state,to_state,from_version,to_version,authorization_event_id,idempotency_key_hash,request_hash) VALUES($1,$2,$3,'LIFECYCLE_CREDITED',$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          lifecycleId,
          current.state,
          current.version,
          current.version + 1,
          auth,
          keyHash,
          requestHash,
        ],
      );
      const updated = await manager.query<A7PersistedLifecycle[]>(
        `WITH changed AS (UPDATE a7_product_lifecycles SET state='LIFECYCLE_CREDITED',version=version+1,execution_receipt_id=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING *) SELECT * FROM changed`,
        [lifecycleId, result.receiptId],
      );
      await this.audit.record(manager, {
        entityType: 'A7_PRODUCT_LIFECYCLE',
        entityId: lifecycleId,
        action: 'CREDITED',
        actor: principal.customerId,
        newValues: {
          receiptId: result.receiptId,
          journalId: result.journalId,
          observationId: obs.id,
          policyReference: authority.policyReference,
          obligationReference: authority.obligationReference,
          limitReference: authority.limitReference,
          institutionReference: authority.institutionReference,
        },
      });
      return { lifecycle: updated[0]!, replayed: false };
    });
  }

  private async authenticate(token: string) {
    const s = await this.sessions.validate({ token, audience: 'customer-api' });
    if (!s.valid || !s.principal) throw new UnauthorizedException('Customer session required');
    return s.principal;
  }
  private async lockSession(manager: EntityManager, sessionId: string, customerId: string) {
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT s.id FROM authentication_sessions s JOIN customer_authentication_credentials c ON c.id=s.credential_id AND c.customer_id=s.customer_id
      WHERE s.id=$1 AND s.customer_id=$2 AND s.status='ACTIVE' AND s.audience='customer-api' AND s.expires_at>clock_timestamp()
      AND c.deleted_at IS NULL AND c.status='ACTIVE' AND NOT c.account_locked AND NOT c.rotation_required
      AND (c.password_expires_at IS NULL OR c.password_expires_at>clock_timestamp())
      AND (s.onboarding_password_version IS NULL OR s.onboarding_password_version=c.password_version) FOR SHARE OF s,c`,
      [sessionId, customerId],
    );
    if (!rows[0]) throw new UnauthorizedException('Customer session no longer active');
  }
  private async recordAuthorization(
    manager: EntityManager,
    customerId: string,
    sessionId: string,
    commandId: string,
    action: 'create' | 'transition',
  ) {
    const decision = this.authorization.evaluate(
      {
        type: 'CUSTOMER',
        principalId: customerId,
        customerId,
        sessionId,
        audience: 'customer-api',
        roles: [],
        scopes: [],
        customerAccess: 'SELF',
      },
      {
        resourceType: 'a7-product-command',
        action: `a7:${action}`,
        allowedPrincipalTypes: ['CUSTOMER'],
        customerAccess: 'SELF',
        audience: 'customer-api',
      },
      { type: 'a7-product-command', id: commandId, customerId },
    );
    if (!decision.allowed) throw new UnauthorizedException('A7 access denied');
    const event = await this.audit.record(manager, {
      entityType: 'A7_ACCESS_AUTHORIZATION',
      entityId: commandId,
      action: 'ALLOWED',
      actor: customerId,
      occurredAt: decision.evaluatedAt,
      newValues: {
        customerId,
        sessionId,
        principalType: 'CUSTOMER',
        customerAccess: 'SELF',
        resourceType: decision.resourceType,
        resourceId: commandId,
        action: decision.action,
        allowed: true,
      },
    });
    return event.id;
  }
  private async recheckCommandAuthority(
    manager: EntityManager,
    command: {
      command_id: string;
      customer_id: string;
      session_id: string;
      authorization_event_id: string;
      binding_id: string;
      binding_version: number;
      customer_wallet_id: string;
      wallet_account_id: string;
      ledger_account_id: string;
    },
  ): Promise<void> {
    const events = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM audit_events
      WHERE id=$1 AND entity_type='A7_ACCESS_AUTHORIZATION' AND entity_id=$2 AND action='ALLOWED'
        AND actor=$3 AND new_values->>'customerId'=$3 AND new_values->>'sessionId'=$4
        AND new_values->>'resourceId'=$2::text AND new_values->>'action'='a7:create'
        AND new_values->>'allowed'='true' FOR SHARE`,
      [command.authorization_event_id, command.command_id, command.customer_id, command.session_id],
    );
    if (!events[0]) throw new ConflictException('A7 original authorization evidence mismatch');
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT b.id
      FROM customer_financial_account_bindings b JOIN customers c ON c.id=b.customer_id
      JOIN customer_wallets cw ON cw.id=b.customer_wallet_id AND cw.customer_id=c.id
      JOIN wallet_ownerships o ON o.wallet_id=cw.id AND o.customer_id=c.id
      JOIN wallet_accounts w ON w.id=b.wallet_account_id AND w.customer_id=c.id::text AND w.ledger_account_id=b.ledger_account_id
      JOIN ledger_accounts la ON la.id=b.ledger_account_id
      WHERE b.id=$1 AND b.version=$2 AND b.customer_id=$3 AND b.customer_wallet_id=$4 AND b.wallet_account_id=$5 AND b.ledger_account_id=$6
      AND b.state='ACTIVE' AND b.currency='NGN' AND b.accounting_unit='CUSTOMER_FUNDS'
      AND c.status='ACTIVE' AND c.deleted_at IS NULL AND c.version=b.source_customer_version
      AND cw.status='ACTIVE' AND cw.deleted_at IS NULL AND cw.version=b.source_customer_wallet_version AND cw.currency='NGN'
      AND o.deleted_at IS NULL AND w.status='ACTIVE' AND w.currency='NGN' AND w.owner_class='CUSTOMER'
      AND wallet_owner_class(w.customer_id)='CUSTOMER' AND la.is_active AND NOT la.allow_negative_balance
      AND la.currency='NGN' AND la.accounting_unit='CUSTOMER_FUNDS' AND la.account_type='LIABILITY' AND la.normal_balance='CREDIT'
      FOR SHARE OF b,c,cw,o,w,la`,
      [
        command.binding_id,
        command.binding_version,
        command.customer_id,
        command.customer_wallet_id,
        command.wallet_account_id,
        command.ledger_account_id,
      ],
    );
    if (!rows[0]) throw new ConflictException('A7 binding evidence is stale or mismatched');
  }

  private async checkPolicy(
    manager: EntityManager,
    reference: string,
    customerId: string,
    operation: A7PersistedOperationType,
    bindingId: string,
    requireAllow: boolean,
    intendedAmount: string | null = null,
  ) {
    const inbound = operation === 'INBOUND_FUNDING';
    const capability = inbound
      ? A7_INBOUND_ADMISSION_PROFILE.capability
      : 'product.virtual-account';
    const action = inbound ? 'admit' : 'assign';
    const rows = await manager.query<
      Array<{
        id: string;
        obligations: PolicyObligation[];
        profile_reference: string;
        definition_hash: string;
      }>
    >(
      `SELECT p.id,p.obligations,p.profile_reference,p.definition_hash FROM policy_decision_records p
      JOIN immutable_evidence_snapshot_attachments s ON s.snapshot_reference=p.snapshot_reference AND s.normalized_input_hash=p.normalized_input_hash
      JOIN policy_profile_versions v ON v.profile_reference=p.profile_reference AND v.definition_hash=p.definition_hash
        AND v.profile_version=p.profile_version AND v.policy_version=p.policy_version AND v.capability=p.capability
      WHERE p.decision_reference=$1 AND p.customer_id=$2 AND p.capability=$6 AND p.action=$3
      AND s.customer_id=p.customer_id AND s.capability=p.capability AND s.action=p.action
      AND s.snapshot_payload #>> '{policyRequestScope,targetBindingId}'=$4
      AND ($5::boolean=false OR (p.decision IN ('ALLOW','ALLOW_WITH_LIMITS') AND p.collection_status='COMPLETE'
        AND s.collection_status='COMPLETE' AND p.expires_at>clock_timestamp() AND (p.review_at IS NULL OR p.review_at>clock_timestamp())
        AND v.lifecycle_state='ACTIVE' AND v.effective_from<=clock_timestamp() AND (v.effective_to IS NULL OR v.effective_to>clock_timestamp())
        AND NOT EXISTS(SELECT 1 FROM policy_decision_records newer WHERE newer.supersedes_decision_reference=p.decision_reference))) FOR SHARE OF p,s,v`,
      [reference, customerId, action, bindingId, requireAllow, capability],
    );
    const row = rows[0];
    if (!row) throw new ConflictException('A7 policy evidence missing or mismatched');
    if (requireAllow) {
      const profile = inbound
        ? A7_INBOUND_ADMISSION_PROFILE
        : A7_PRODUCT_POLICY_PROFILES.find((item) => item.actions.includes(action));
      if (
        !profile ||
        profile.profileReference !== row.profile_reference ||
        profile.definitionHash !== row.definition_hash
      )
        throw new ConflictException('A7 policy profile is not the expected authoritative version');
      validateA7Obligations(row.obligations, profile.obligations, Date.now());
      const entity = await manager
        .getRepository(PolicyDecisionRecord)
        .findOne({ where: { id: row.id } });
      if (!entity) throw new ConflictException('A7 policy decision unavailable');
      const decision = entityToDecision(entity);
      const snapshotEntity = await manager
        .getRepository(ImmutableEvidenceSnapshotAttachment)
        .findOne({ where: { snapshotReference: entity.snapshotReference } });
      if (!snapshotEntity) throw new ConflictException('A7 policy snapshot unavailable');
      const snapshot = entityToSnapshot(snapshotEntity);
      if (
        inbound &&
        (!intendedAmount ||
          snapshot.policyRequestScope.evaluationContext?.limitUsage?.amountMinor !==
            intendedAmount ||
          snapshot.policyRequestScope.evaluationContext?.currency !== 'NGN')
      )
        throw new ConflictException('A7 policy amount does not match the inbound intent');
      if (
        calculatePolicyDecisionResultHash(decision) !== decision.resultHash ||
        calculateSnapshotInputHash(snapshot) !== entity.normalizedInputHash
      )
        throw new ConflictException('A7 policy evidence integrity mismatch');
    }
  }

  private uuid(value: string) {
    if (typeof value !== 'string' || !UUID.test(value))
      throw new BadRequestException('A7 identifier must be a UUID');
    return value.toLowerCase();
  }
  private key(value: string) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 255)
      throw new BadRequestException('A7 idempotency key required');
    return this.hash(value.trim());
  }
  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
  private async retry<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.transaction('SERIALIZABLE', callback);
      } catch (error) {
        if (!isRetryableTransactionError(error) || attempt === 2) throw error;
      }
    }
    throw new ConflictException('A7 transaction could not complete');
  }
}

/** Shared authoritative reads for A7 consumers; no idempotency response is an aggregate. */
export async function readPersistedA7Command(
  db: DataSource,
  reference: string,
): Promise<A7PersistedCommand | null> {
  const rows = await db.query<A7PersistedCommand[]>(
    'SELECT * FROM a7_product_commands WHERE command_reference=$1',
    [reference],
  );
  return rows[0] ?? null;
}
export async function readPersistedA7Lifecycle(
  db: DataSource,
  reference: string,
): Promise<A7PersistedLifecycle | null> {
  const rows = await db.query<A7PersistedLifecycle[]>(
    'SELECT * FROM a7_product_lifecycles WHERE lifecycle_reference=$1',
    [reference],
  );
  return rows[0] ?? null;
}

/** Validate the obligations as issued; this does not satisfy or waive any recheck. */
export function validateA7Obligations(
  actual: readonly PolicyObligation[],
  expected: readonly PolicyObligation[],
  now: number,
): void {
  if (!Array.isArray(actual) || actual.length !== expected.length)
    throw new ConflictException('A7 policy obligations missing or unexpected');
  const issued = actual as readonly PolicyObligation[];
  for (const required of expected) {
    const matches = issued.filter((entry) => entry && entry.code === required.code);
    const item = matches[0];
    if (
      matches.length !== 1 ||
      !item ||
      item.required !== required.required ||
      (item.reference ?? null) !== (required.reference ?? null)
    )
      throw new ConflictException('A7 policy obligation mismatched');
    for (const date of [item.dueAt, item.expiresAt])
      if (
        date !== undefined &&
        (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || Date.parse(date) <= now)
      )
        throw new ConflictException('A7 policy obligation expired');
  }
}
