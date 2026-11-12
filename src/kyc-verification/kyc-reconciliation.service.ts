import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { UUID } from './kyc-orchestrator';
import { KycFoundationError } from './kyc.types';

export type ReconciliationAction = 'REVIEW' | 'TERMINAL';
export type ReconciliationReason =
  | 'PROVIDER_UNAVAILABLE'
  | 'OUTCOME_UNPROVEN'
  | 'MANUAL_INVESTIGATION';
/**
 * Restricted manual reconciliation. Neither action verifies the customer nor releases an identity
 * claim: a closed unresolved case still blocks retries until a supported provider reconciliation
 * protocol and a governed claim-release workflow exist. Principals must come from the runtime guard.
 */
export class KycReconciliationService {
  constructor(
    private readonly db: DataSource,
    private readonly authorization: AuthorizationService,
  ) {}
  async decide(
    principal: AuthorizationPrincipal | undefined,
    command: {
      caseId: string;
      requestId: string;
      action: ReconciliationAction;
      reason: ReconciliationReason;
    },
  ): Promise<{ status: 'REVIEW' | 'TERMINAL'; replay: boolean }> {
    if (
      !UUID.test(command.caseId) ||
      !UUID.test(command.requestId) ||
      !['REVIEW', 'TERMINAL'].includes(command.action) ||
      !['PROVIDER_UNAVAILABLE', 'OUTCOME_UNPROVEN', 'MANUAL_INVESTIGATION'].includes(command.reason)
    )
      throw new KycFoundationError('INVALID');
    if (
      principal &&
      (principal.readOnlyPrincipal ||
        !principal.sessionId ||
        !UUID.test(principal.sessionId) ||
        !UUID.test(principal.principalId))
    )
      throw new KycFoundationError('BLOCKED');
    const permission = command.action === 'REVIEW' ? 'kyc.review' : 'kyc.approve';
    const decision = await this.authorization.authorize(
      principal,
      {
        resourceType: 'KYC_RECONCILIATION',
        action: permission,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredFunctions: [permission],
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      { type: 'KYC_RECONCILIATION', id: command.caseId },
    );
    if (!decision.allowed || !principal) throw new KycFoundationError('BLOCKED');
    const lookup = await this.db.query<Array<{ customer_id: string; attempt_id: string }>>(
      'SELECT customer_id,attempt_id FROM kyc_reconciliation_cases WHERE id=$1',
      [command.caseId],
    );
    if (!lookup[0]) throw new KycFoundationError('NOT_FOUND');
    return this.db.transaction(async (m) => {
      const customer = await m.query<Array<{ id: string }>>(
        'SELECT id FROM customers WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
        [lookup[0]!.customer_id],
      );
      if (!customer[0]) throw new KycFoundationError('BLOCKED');
      const attempts = await m.query<Array<{ outcome: string }>>(
        'SELECT outcome FROM kyc_verification_attempts WHERE id=$1 AND customer_id=$2 FOR UPDATE',
        [lookup[0]!.attempt_id, lookup[0]!.customer_id],
      );
      const cases = await m.query<Array<{ customer_id: string; status: string }>>(
        'SELECT customer_id,status FROM kyc_reconciliation_cases WHERE id=$1 FOR UPDATE',
        [command.caseId],
      );
      if (!cases[0]) throw new KycFoundationError('NOT_FOUND');
      const prior = await m.query<
        Array<{ actor_id: string; action: ReconciliationAction; reason_code: string }>
      >(
        'SELECT actor_id,action,reason_code FROM kyc_reconciliation_reviews WHERE case_id=$1 AND request_id=$2',
        [command.caseId, command.requestId],
      );
      if (prior[0]) {
        if (
          prior[0].actor_id !== principal.principalId ||
          prior[0].action !== command.action ||
          prior[0].reason_code !== command.reason
        )
          throw new KycFoundationError('CONFLICT');
        return { status: prior[0].action, replay: true };
      }
      if (command.action === 'REVIEW' && cases[0].status !== 'OPEN')
        throw new KycFoundationError('CONFLICT');
      if (command.action === 'TERMINAL') {
        if (cases[0].status !== 'REVIEW') throw new KycFoundationError('CONFLICT');
        if (!attempts[0] || !['UNKNOWN', 'CONSENT_WITHDRAWN'].includes(attempts[0].outcome))
          throw new KycFoundationError('BLOCKED');
        const reviewers = await m.query<Array<{ actor_id: string }>>(
          "SELECT actor_id FROM kyc_reconciliation_reviews WHERE case_id=$1 AND action='REVIEW' ORDER BY created_at DESC LIMIT 1",
          [command.caseId],
        );
        if (!reviewers[0] || reviewers[0].actor_id === principal.principalId)
          throw new KycFoundationError('BLOCKED');
      }
      const reviewId = randomUUID();
      await m.query(
        'INSERT INTO kyc_reconciliation_reviews(id,case_id,request_id,actor_id,action,reason_code) VALUES($1,$2,$3,$4,$5,$6)',
        [
          reviewId,
          command.caseId,
          command.requestId,
          principal.principalId,
          command.action,
          command.reason,
        ],
      );
      await m.query(
        "UPDATE kyc_reconciliation_cases SET status=$1::varchar,closed_at=CASE WHEN $1::varchar='TERMINAL' THEN clock_timestamp() ELSE NULL END WHERE id=$2",
        [command.action, command.caseId],
      );
      await m.query(
        'INSERT INTO kyc_private_audit(id,customer_id,resource_id,action,actor_id,outcome) VALUES($1,$2,$3,$4,$5,NULL)',
        [
          randomUUID(),
          cases[0].customer_id,
          reviewId,
          command.action === 'REVIEW' ? 'RECONCILIATION_REVIEW' : 'RECONCILIATION_TERMINAL',
          principal.principalId,
        ],
      );
      return { status: command.action, replay: false };
    });
  }
}
