import type { DataSource, EntityManager } from 'typeorm';
import {
  LimitEnforcementService,
  type EnforceInput,
} from '../src/limit-catalog/limit-enforcement.service';
import type { LimitProfileResolverService } from '../src/limit-catalog/limit-profile-resolver.service';
import type { LimitUsageService } from '../src/limit-catalog/limit-usage.service';

const input: EnforceInput = {
  principalType: 'AGENT',
  principalId: 'agent-id',
  agentClassId: 'agent-class-id',
  product: 'WALLET_TRANSFER',
  currency: 'NGN',
  direction: 'OUTGOING',
  amountMinor: '100',
  idempotencyKey: 'limit-key',
  requestHash: 'hash',
  strictConfiguredRules: true,
};

describe('strict configured limit admission', () => {
  const resolve = jest.fn();
  const query = jest.fn();
  const manager = { query } as unknown as EntityManager;
  const service = new LimitEnforcementService(
    {} as DataSource,
    { resolve } as unknown as LimitProfileResolverService,
    {} as LimitUsageService,
  );
  beforeEach(() => {
    resolve.mockReset();
    query.mockReset();
  });

  it('fails closed on a missing profile while legacy callers remain advisory', async () => {
    resolve.mockResolvedValue(null);
    await expect(service.enforceWithManager(manager, input)).rejects.toMatchObject({ status: 503 });
    expect(resolve).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        principalType: 'AGENT',
        agentClassId: 'agent-class-id',
      }),
    );
    await expect(
      service.enforceWithManager(manager, { ...input, strictConfiguredRules: false }),
    ).resolves.toMatchObject({ allowed: true, limitProfileCode: null });
  });

  it('fails closed when there is no matching rule for the direction', async () => {
    resolve.mockResolvedValue({ limitProfileCode: 'AGENT', assignmentId: 'assignment' });
    query.mockResolvedValue([
      { id: 'rule', limit_profile_code: 'AGENT', direction: 'INCOMING', channel: null },
    ]);
    await expect(service.enforceWithManager(manager, input)).rejects.toMatchObject({ status: 503 });
    await expect(
      service.enforceWithManager(manager, { ...input, strictConfiguredRules: false }),
    ).resolves.toMatchObject({ allowed: true, evaluatedDimensions: [] });
  });

  it('evaluates the configured rule without inventing a threshold', async () => {
    resolve.mockResolvedValue({ limitProfileCode: 'AGENT', assignmentId: 'assignment' });
    query.mockResolvedValue([
      {
        id: 'rule',
        limit_profile_code: 'AGENT',
        direction: 'OUTGOING',
        channel: null,
        dimension: 'MAX_AMOUNT_PER_TX',
        limit_value_minor: '99',
        limit_value_count: null,
      },
    ]);
    await expect(service.enforceWithManager(manager, input)).rejects.toMatchObject({ status: 422 });
  });
});
