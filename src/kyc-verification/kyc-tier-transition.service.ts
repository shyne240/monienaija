import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AuthorizationService } from '../authorization/authorization.service';
import { CustomerKycLevel, CustomerKycStatus } from '../customer/customer.enums';
import type { CreateKycAssessmentCommand } from '../customer/customer.types';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuditService } from '../operations/audit.service';
import {
  DEFAULT_SESSION_AUDIENCE,
  type AuthenticationSessionService,
} from '../customer-authentication/authentication-session.service';
import type { KycTierEvidenceReader } from './kyc-tier-evidence.reader';
import type { KycTierPolicyService } from './kyc-tier-policy.service';
import { decideTier, planTierTransition, type TierLevel } from './kyc-tier-decision';
import { UUID } from './kyc-orchestrator';

type CustomerRow = {
  id: string;
  kyc_level: TierLevel | 'LEVEL_3';
  kyc_status: string;
  deleted_at: Date | null;
};
/** Single transactional mutation boundary for governed automatic assessments. */
export class KycTierTransitionService {
  private readonly logger = new Logger(KycTierTransitionService.name);
  constructor(
    private readonly db: DataSource,
    private readonly policies: KycTierPolicyService,
    private readonly reader: KycTierEvidenceReader,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly sessions?: Pick<
      AuthenticationSessionService,
      'revokeAllForCustomerInManager'
    >,
  ) {}
  async reviews(principal: AuthorizationPrincipal | undefined) {
    if (!principal || !principal.sessionId || !UUID.test(principal.sessionId))
      throw new ForbiddenException('KYC authorization required');
    const d = await this.authorization.authorize(
      principal,
      {
        resourceType: 'kyc',
        action: 'kyc.review',
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredFunctions: ['kyc.review'],
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      { type: 'kyc' },
    );
    if (!d.allowed) throw new ForbiddenException('KYC authorization required');
    return this.db.query<
      Array<{
        customer_id: string;
        reason: string;
        policy_version: number | null;
        created_at: Date;
        hold_reason: string | null;
      }>
    >(`WITH latest AS (SELECT DISTINCT ON(customer_id) customer_id,reason,policy_version,created_at,outcome FROM kyc_tier_evaluations ORDER BY customer_id,created_at DESC,id DESC),
    subjects AS (SELECT customer_id FROM latest WHERE outcome='HOLD_FOR_REVIEW' AND reason NOT IN ('TRUSTED_EVIDENCE_UNAVAILABLE','POLICY_NOT_EFFECTIVE_OR_APPROVED') UNION SELECT customer_id FROM kyc_tier_manual_holds)
    SELECT s.customer_id,COALESCE(l.reason,h.reason) AS reason,l.policy_version,COALESCE(l.created_at,h.created_at) AS created_at,h.reason AS hold_reason FROM subjects s LEFT JOIN latest l ON l.customer_id=s.customer_id LEFT JOIN kyc_tier_manual_holds h ON h.customer_id=s.customer_id ORDER BY created_at DESC LIMIT 100`);
  }
  /** Queue revision is monotonic even after a worker completes it. */
  async enqueue(customerId: string): Promise<void> {
    if (!UUID.test(customerId)) throw new ConflictException('Invalid customer');
    await this.db.transaction(async (m) => {
      await this.lockCustomer(m, customerId);
      await m.query(
        `INSERT INTO kyc_evaluation_refresh(customer_id) VALUES($1) ON CONFLICT(customer_id) DO UPDATE SET revision=kyc_evaluation_refresh.revision+1,requested_at=clock_timestamp(),retry_after=clock_timestamp()`,
        [customerId],
      );
    });
  }
  private async lockCustomer(m: EntityManager, id: string): Promise<CustomerRow> {
    const rows = await m.query<CustomerRow[]>(
      'SELECT id,kyc_level,kyc_status,deleted_at FROM customers WHERE id=$1 FOR UPDATE',
      [id],
    );
    if (!rows[0] || rows[0].deleted_at) throw new NotFoundException('Customer unavailable');
    return rows[0];
  }
  async administrativeAssessment(
    customerId: string,
    command: CreateKycAssessmentCommand,
    principal: AuthorizationPrincipal | undefined,
  ) {
    const func =
      command.status === CustomerKycStatus.APPROVED
        ? 'kyc.approve'
        : command.status === CustomerKycStatus.REJECTED
          ? 'kyc.reject'
          : 'kyc.review';
    if (
      !principal ||
      principal.readOnlyPrincipal ||
      !principal.sessionId ||
      !UUID.test(principal.sessionId)
    )
      throw new ForbiddenException('KYC authorization required');
    const authorization = await this.authorization.authorize(
      principal,
      {
        resourceType: 'kyc',
        action: func,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredFunctions: [func],
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      { type: 'kyc' },
    );
    if (!authorization.allowed) throw new ForbiddenException('KYC authorization required');
    if (!UUID.test(customerId)) throw new ConflictException('Invalid customer');
    // An approval is evaluated from locked authoritative evidence, never from the body.
    if (command.status === CustomerKycStatus.APPROVED) {
      if (!['LEVEL_1', 'LEVEL_2'].includes(command.level))
        throw new ConflictException('Invalid requested tier');
      const result = await this.processInternal(customerId, {
        actor: principal.principalId,
        expected: command.level as TierLevel,
        allowLegacy: true,
        enqueue: true,
      });
      if (!result.assessment)
        throw new ConflictException('Evidence requirements are not satisfied');
      return result.assessment;
    }
    if (
      !['PENDING', 'REJECTED'].includes(command.status) ||
      command.level !== CustomerKycLevel.NONE ||
      !command.reason ||
      !['EVIDENCE_REVOKED', 'IDENTITY_CONFLICT', 'MANUAL_REVIEW'].includes(command.reason)
    )
      throw new ConflictException('A reason and a non-privileged tier are required');
    return this.db.transaction(async (m) => {
      const c = await this.lockCustomer(m, customerId);
      if (c.kyc_level === 'LEVEL_3')
        throw new ConflictException('Level 3 is outside this workflow');
      const current = await m.query<Array<{ id: string }>>(
        'SELECT id FROM customer_kyc_assessments WHERE customer_id=$1 AND is_current=true FOR UPDATE',
        [customerId],
      );
      const priorHold = await m.query<Array<{ actor: string; reason: string }>>(
        'SELECT actor,reason FROM kyc_tier_manual_holds WHERE customer_id=$1 FOR UPDATE',
        [customerId],
      );
      if (
        current[0] &&
        c.kyc_level === 'NONE' &&
        c.kyc_status === String(command.status) &&
        priorHold[0]?.actor === principal.principalId &&
        priorHold[0].reason === command.reason
      )
        return { id: current[0].id, customerId, level: 'NONE', status: command.status };
      if (current[0])
        await m.query(
          'UPDATE customer_kyc_assessments SET is_current=false,updated_at=clock_timestamp() WHERE id=$1',
          [current[0].id],
        );
      const id = randomUUID();
      const reason = command.reason!.trim();
      await m.query(
        `INSERT INTO customer_kyc_assessments(id,customer_id,kyc_level,kyc_status,reason,assessed_by,is_current,expires_at) VALUES($1,$2,'NONE',$3,$4,$5,true,NULL)`,
        [id, customerId, command.status, reason, principal.principalId],
      );
      await m.query(
        `UPDATE customers SET kyc_level='NONE',kyc_status=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2`,
        [command.status, customerId],
      );
      await m.query(
        `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,$2,$3) ON CONFLICT(customer_id) DO UPDATE SET actor=EXCLUDED.actor,reason=EXCLUDED.reason,created_at=clock_timestamp()`,
        [customerId, principal.principalId, reason],
      );
      await this.sessions?.revokeAllForCustomerInManager(
        m,
        customerId,
        principal.principalId,
        `KYC manual hold: ${reason}`,
        { audiences: [DEFAULT_SESSION_AUDIENCE], preserveSelfLogout: true },
      );
      await this.audit.record(m, {
        entityType: 'CUSTOMER_KYC_TRANSITION',
        entityId: id,
        action: 'ADMIN_REVOKED',
        actor: principal.principalId,
        previousValues: { level: c.kyc_level, status: c.kyc_status },
        newValues: {
          customerId,
          level: 'NONE',
          status: command.status,
          reason,
          policyVersion: null,
          evidenceIds: [],
          assessmentId: id,
        },
      });
      return { id, customerId, level: 'NONE', status: command.status };
    });
  }
  async process(customerId: string): Promise<'PROCESSED' | 'NO_WORK'> {
    return (
      await this.processInternal(customerId, { actor: 'SYSTEM_KYC_EVALUATOR', allowLegacy: false })
    ).state;
  }
  private async processInternal(
    customerId: string,
    context: { actor: string; expected?: TierLevel; allowLegacy: boolean; enqueue?: boolean },
  ): Promise<{
    state: 'PROCESSED' | 'NO_WORK';
    assessment?: { id: string; customerId: string; level: string; status: string };
  }> {
    if (!UUID.test(customerId)) throw new ConflictException('Invalid customer');
    return this.db.transaction(async (m) => {
      const c = await this.lockCustomer(m, customerId);
      const times = await m.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
      const now = times[0]!.now;
      // Holding the policy head lock until commit serializes publication with evaluation.
      const policy = await this.policies.effective(m, now);
      if (context.enqueue)
        await m.query(
          `INSERT INTO kyc_evaluation_refresh(customer_id) VALUES($1) ON CONFLICT(customer_id) DO UPDATE SET revision=kyc_evaluation_refresh.revision+1,requested_at=clock_timestamp(),retry_after=clock_timestamp()`,
          [customerId],
        );
      const queue = await m.query<Array<{ revision: string; processed_revision: string }>>(
        'SELECT revision,processed_revision FROM kyc_evaluation_refresh WHERE customer_id=$1 FOR UPDATE',
        [customerId],
      );
      if (!queue[0] || BigInt(queue[0].processed_revision) >= BigInt(queue[0].revision))
        return { state: 'NO_WORK' as const };
      const revision = queue[0].revision;
      const holds = await m.query<Array<{ customer_id: string }>>(
        'SELECT customer_id FROM kyc_tier_manual_holds WHERE customer_id=$1 FOR UPDATE',
        [customerId],
      );
      const source = await this.reader.read(m, customerId);
      const previous = await m.query<
        Array<{ assessment_id: string; policy_version: number | null; evidence_ids: string[] }>
      >(
        'SELECT assessment_id,policy_version,evidence_ids FROM kyc_tier_evaluations WHERE customer_id=$1 AND assessment_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
        [customerId],
      );
      const currentAssessment = await m.query<Array<{ id: string; expires_at: Date | null }>>(
        'SELECT id,expires_at FROM customer_kyc_assessments WHERE customer_id=$1 AND is_current=true FOR UPDATE',
        [customerId],
      );
      const legacy =
        (c.kyc_level !== 'NONE' || c.kyc_status !== 'NOT_STARTED') &&
        (!currentAssessment[0] || previous[0]?.assessment_id !== currentAssessment[0].id);
      const decision = source
        ? decideTier({
            customerId,
            identityRevision: source.identityRevision,
            now,
            policy,
            evidence: source.evidence,
          })
        : {
            status: 'REVIEW' as const,
            highestTier: null,
            reason: 'TRUSTED_EVIDENCE_UNAVAILABLE',
            policyVersion: policy?.version ?? null,
            supportingEvidenceIds: [],
          };
      const plan = planTierTransition({
        currentTier: c.kyc_level,
        legacyAssessment: (legacy || !!holds[0]) && !context.allowLegacy,
        decision,
      });
      if (
        context.expected &&
        (decision.status !== 'ELIGIBLE' || decision.highestTier !== context.expected)
      )
        throw new ConflictException('Evidence requirements are not satisfied');
      if (context.allowLegacy && c.kyc_level === 'LEVEL_3')
        throw new ConflictException('Level 3 is outside this workflow');
      if (context.allowLegacy) {
        if (holds.length > 0 || c.kyc_status !== 'APPROVED' || c.kyc_level === 'NONE') {
          await this.sessions?.revokeAllForCustomerInManager(
            m,
            customerId,
            context.actor,
            'KYC hold cleared; fresh authentication required',
            { audiences: [DEFAULT_SESSION_AUDIENCE], preserveSelfLogout: false },
          );
        }
        await m.query('DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1', [customerId]);
      }
      let assessmentId: string | null = null,
        newLevel: string | null = null;
      let candidate =
        plan.action === 'PROPOSE_TRANSITION'
          ? plan.newTier
          : plan.action === 'NO_CHANGE' && decision.status === 'ELIGIBLE'
            ? decision.highestTier
            : null;
      // A managed approval with contradictory/mismatched evidence is suspended for review.
      // An unavailable reader alone does not invalidate an unexpired legacy or managed approval.
      const reviewSuspension =
        !context.allowLegacy &&
        !legacy &&
        c.kyc_level !== 'LEVEL_3' &&
        !holds[0] &&
        c.kyc_status === 'APPROVED' &&
        !!source &&
        decision.status === 'REVIEW';
      const expiredSuspension =
        !context.allowLegacy &&
        !legacy &&
        c.kyc_level !== 'LEVEL_3' &&
        c.kyc_status === 'APPROVED' &&
        !!currentAssessment[0]?.expires_at &&
        currentAssessment[0].expires_at <= now &&
        candidate === null;
      if (reviewSuspension || expiredSuspension) candidate = 'NONE';
      const transitionReason = reviewSuspension
        ? decision.reason
        : expiredSuspension
          ? 'ASSESSMENT_EXPIRED'
          : decision.reason;
      const supportExpiry =
        candidate && candidate !== 'NONE'
          ? source!.evidence
              .filter((e) => decision.supportingEvidenceIds.includes(e.id))
              .map((e) => e.expiresAt!)
              .reduce((a, b) => (a < b ? a : b))
          : null;
      const expires =
        supportExpiry && policy?.effectiveUntil && policy.effectiveUntil < supportExpiry
          ? policy.effectiveUntil
          : supportExpiry;
      const needsRefresh =
        plan.action === 'NO_CHANGE' &&
        candidate !== null &&
        (c.kyc_status !== 'APPROVED' ||
          !currentAssessment[0] ||
          !currentAssessment[0].expires_at ||
          !expires ||
          currentAssessment[0].expires_at.getTime() !== expires.getTime() ||
          previous[0]?.assessment_id !== currentAssessment[0].id ||
          previous[0]?.policy_version !== Number(policy?.version) ||
          JSON.stringify(previous[0]?.evidence_ids ?? []) !==
            JSON.stringify(decision.supportingEvidenceIds));
      if (
        plan.action === 'PROPOSE_TRANSITION' ||
        needsRefresh ||
        reviewSuspension ||
        expiredSuspension
      ) {
        const status = candidate === 'NONE' ? 'PENDING' : 'APPROVED';
        if (currentAssessment[0])
          await m.query(
            'UPDATE customer_kyc_assessments SET is_current=false,updated_at=clock_timestamp() WHERE id=$1',
            [currentAssessment[0].id],
          );
        assessmentId = randomUUID();
        newLevel = candidate;
        await m.query(
          `INSERT INTO customer_kyc_assessments(id,customer_id,kyc_level,kyc_status,reason,assessed_by,is_current,expires_at) VALUES($1,$2,$3,$4,$5,$7,true,$6)`,
          [assessmentId, customerId, newLevel, status, transitionReason, expires, context.actor],
        );
        await m.query(
          'UPDATE customers SET kyc_level=$1,kyc_status=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$3',
          [newLevel, status, customerId],
        );
        if (reviewSuspension)
          await m.query(
            `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,$2,'MANUAL_REVIEW') ON CONFLICT(customer_id) DO NOTHING`,
            [customerId, context.actor],
          );
        if (candidate === 'NONE') {
          await this.sessions?.revokeAllForCustomerInManager(
            m,
            customerId,
            context.actor,
            `KYC eligibility withdrawn: ${transitionReason}`,
            { audiences: [DEFAULT_SESSION_AUDIENCE], preserveSelfLogout: true },
          );
        }
        await this.audit.record(m, {
          entityType: 'CUSTOMER_KYC_TRANSITION',
          entityId: assessmentId,
          action: 'TRANSITIONED',
          actor: context.actor,
          previousValues: { level: c.kyc_level, status: c.kyc_status },
          newValues: {
            customerId,
            level: newLevel,
            status,
            reason: transitionReason,
            policyVersion: policy?.version ?? null,
            evidenceIds: decision.supportingEvidenceIds,
            assessmentId,
          },
        });
      }
      await m.query(
        `INSERT INTO kyc_tier_evaluations(id,customer_id,revision,policy_version,outcome,reason,old_level,new_level,evidence_ids,assessment_id,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10,$11)`,
        [
          randomUUID(),
          customerId,
          revision,
          policy?.version ?? null,
          plan.action,
          transitionReason,
          c.kyc_level,
          newLevel,
          decision.supportingEvidenceIds,
          assessmentId,
          context.actor,
        ],
      );
      await m.query(
        'UPDATE kyc_evaluation_refresh SET processed_revision=$1 WHERE customer_id=$2 AND revision=$1',
        [revision, customerId],
      );
      if (context.expected) {
        const id = assessmentId ?? currentAssessment[0]?.id;
        const status = assessmentId ? (newLevel === 'NONE' ? 'PENDING' : 'APPROVED') : c.kyc_status;
        const level = newLevel ?? c.kyc_level;
        if (!id || status !== 'APPROVED' || level !== context.expected)
          throw new ConflictException('Evidence requirements are not satisfied');
        return { state: 'PROCESSED' as const, assessment: { id, customerId, level, status } };
      }
      return { state: 'PROCESSED' as const };
    });
  }
  async processBatch(limit = 50): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ConflictException('Invalid batch');
    const rows = await this.db.query<Array<{ customer_id: string; revision: string }>>(
      'SELECT customer_id,revision FROM kyc_evaluation_refresh WHERE revision>processed_revision AND retry_after<=clock_timestamp() ORDER BY requested_at,customer_id LIMIT $1',
      [limit],
    );
    let count = 0;
    for (const row of rows) {
      try {
        if ((await this.process(row.customer_id)) === 'PROCESSED') count++;
      } catch {
        this.logger.error('KYC evaluation failed; retry deferred');
        await this.db.query(
          `UPDATE kyc_evaluation_refresh SET retry_after=clock_timestamp()+interval '1 minute' WHERE customer_id=$1 AND revision=$2 AND processed_revision<revision`,
          [row.customer_id, row.revision],
        );
      }
    }
    return count;
  }
}
