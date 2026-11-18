import {
  DisasterRecoveryService,
  RECOVERY_RESUME_STATE_SETS,
} from '../src/recovery/disaster-recovery.service';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';

/**
 * ARENA 3D Group 13 — DR/BC objectives and the post-restore resume rule.
 *
 * The resume rule is the part that protects money. The rest is reporting.
 */
describe('Group 13 — disaster recovery readiness', () => {
  describe('the resume rule', () => {
    /**
     * Every state in the lifecycle must be classified. A state added later without a decision would
     * otherwise default to whatever the code happens to do, which for a financial operation is not an
     * acceptable way to decide whether to re-send a transfer.
     */
    it('classifies every lifecycle state exactly once', () => {
      const allStates = Object.values(ExternalOperationLifecycleState);
      const safe = RECOVERY_RESUME_STATE_SETS.safe;
      const needsVerification = RECOVERY_RESUME_STATE_SETS.requiresVerification;

      for (const state of allStates) {
        const inSafe = safe.has(state);
        const inVerify = needsVerification.includes(state);
        expect({ state, classifiedExactlyOnce: inSafe !== inVerify }).toEqual({
          state,
          classifiedExactlyOnce: true,
        });
      }
      expect(safe.size + needsVerification.length).toBe(allStates.length);
    });

    it('never treats a sent-but-unconfirmed operation as safe to resume', () => {
      // These are the states in which the provider may already have executed. Resubmitting any of them
      // produces a second external effect, which for a withdrawal is a second payment.
      const service = new DisasterRecoveryService({});
      for (const state of [
        ExternalOperationLifecycleState.SUBMITTING,
        ExternalOperationLifecycleState.PENDING_PROVIDER,
        ExternalOperationLifecycleState.PENDING_VERIFICATION,
        ExternalOperationLifecycleState.UNKNOWN,
      ]) {
        const decision = service.resumeDecision(state);
        expect({ state, resumable: decision.resumable }).toEqual({ state, resumable: false });
        expect(decision.action).toBe('verify-with-provider');
        expect(decision.reason).toMatch(/may have reached the provider/i);
      }
    });

    it('routes an already-escalated operation to a human rather than back to verification', () => {
      const service = new DisasterRecoveryService({});
      const decision = service.resumeDecision(ExternalOperationLifecycleState.MANUAL_REVIEW);
      expect(decision.resumable).toBe(false);
      expect(decision.action).toBe('manual-review');
    });

    it('allows resume only where no provider-side effect can exist', () => {
      const service = new DisasterRecoveryService({});
      for (const state of [
        ExternalOperationLifecycleState.CREATED,
        ExternalOperationLifecycleState.FAILED,
        ExternalOperationLifecycleState.CANCELLED,
      ]) {
        const decision = service.resumeDecision(state);
        expect({ state, resumable: decision.resumable }).toEqual({ state, resumable: true });
        expect(decision.reason).toMatch(/never established a provider-side effect/);
      }
    });

    it('states the rule in operator-readable language, not only in code', () => {
      const report = new DisasterRecoveryService({}).readiness();
      expect(report.resumePolicy.statement).toMatch(
        /never resubmitted by recovery|Restores state; it does not replay intent/,
      );
    });
  });

  describe('objectives are configuration, never invented', () => {
    it('reports objectives as unconfigured when nothing is set, rather than guessing', () => {
      // A plausible-looking default would read like a commitment nobody made.
      const report = new DisasterRecoveryService({}).readiness();
      expect(report.status).toBe('objectives-not-configured');
      expect(report.configuredObjectives).toBe(0);
      expect(report.objectives.database.rpoSeconds).toBeNull();
      expect(report.objectives.database.rtoSeconds).toBeNull();
      expect(report.gaps.length).toBe(4);
    });

    it('does not treat a malformed or negative objective as zero', () => {
      // Zero would claim instant recovery; a negative number is nonsense. Both are configuration errors.
      const report = new DisasterRecoveryService({
        RECOVERY_RPO_SECONDS: 'not-a-number',
        RECOVERY_RTO_SECONDS: '-30',
        RECOVERY_APPLICATION_RTO_SECONDS: 'nonsense',
        RECOVERY_PROVIDER_CONNECTIVITY_RTO_SECONDS: '',
      }).readiness();
      expect(report.status).toBe('objectives-not-configured');
      expect(report.objectives.database.rpoSeconds).toBeNull();
      expect(report.objectives.database.rtoSeconds).toBeNull();
    });

    it('is ready only when all four objectives are configured', () => {
      const report = new DisasterRecoveryService({
        RECOVERY_RPO_SECONDS: '300',
        RECOVERY_RTO_SECONDS: '1800',
        RECOVERY_APPLICATION_RTO_SECONDS: '900',
        RECOVERY_PROVIDER_CONNECTIVITY_RTO_SECONDS: '600',
      }).readiness();
      expect(report.status).toBe('ready');
      expect(report.configuredObjectives).toBe(4);
      expect(report.gaps).toHaveLength(0);
      expect(report.objectives.database.rpoSeconds).toBe(300);
      expect(report.objectives.database.rtoSeconds).toBe(1800);
      expect(report.objectives.application.rtoSeconds).toBe(900);
      expect(report.objectives.providerConnectivity.rtoSeconds).toBe(600);
    });

    it('distinguishes a partially configured target from an unconfigured one and from ready', () => {
      // Three outcomes, not two. A system can be technically recoverable while nobody has agreed what
      // "recovered" means in time terms; that is a decision gap, not a technical fault.
      const partial = new DisasterRecoveryService({
        RECOVERY_RPO_SECONDS: '300',
        RECOVERY_RTO_SECONDS: '1800',
      }).readiness();
      expect(partial.status).toBe('not-ready');
      expect(partial.configuredObjectives).toBe(2);
      expect(partial.gaps).toHaveLength(2);
      expect(partial.gaps.join(' ')).toMatch(/application recovery time objective/);
      expect(partial.gaps.join(' ')).toMatch(/provider connectivity/);
    });

    it('names the missing configuration in every gap so an operator knows what to set', () => {
      const report = new DisasterRecoveryService({}).readiness();
      for (const gap of report.gaps) {
        expect(gap).toMatch(/RECOVERY_[A-Z_]+/);
      }
    });
  });
});
