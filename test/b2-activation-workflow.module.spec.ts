import { B2_ACTIVATION_WORKFLOW_PROVIDERS } from '../src/policy/b2-activation-workflow.module';

describe('B2 activation workflow module (B2T05)', () => {
  it('exposes the expected providers', () => {
    expect(Array.isArray(B2_ACTIVATION_WORKFLOW_PROVIDERS)).toBe(true);
    expect(B2_ACTIVATION_WORKFLOW_PROVIDERS.length).toBeGreaterThanOrEqual(2);
  });
});
