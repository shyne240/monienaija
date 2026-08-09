import {
  B2_ACTIVATION_WORKFLOW_CONTRACT_NAME,
  B2_ACTIVATION_WORKFLOW_CONTRACT_VERSION,
  B2_ACTIVATION_WORKFLOW_COHORT_KEY,
  B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_SCOPE,
} from '../src/policy/b2-activation-workflow.constants';

describe('B2 activation workflow types (B2T05)', () => {
  it('freezes the contract identity', () => {
    expect(B2_ACTIVATION_WORKFLOW_CONTRACT_NAME).toBe('B2-ACTIVATION-WORKFLOW');
    expect(B2_ACTIVATION_WORKFLOW_CONTRACT_VERSION).toBe(1);
    expect(B2_ACTIVATION_WORKFLOW_COHORT_KEY).toBe('b2.activation.cohort.inbound-funding');
    expect(B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_SCOPE).toBe('b2.activation-workflow.idempotency.v1');
  });
});
