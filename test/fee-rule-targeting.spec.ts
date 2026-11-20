import { FeeRuleResolverService } from '../src/fee-rules/fee-rule-resolver.service';

const fee = (id: string, priority: number, target: Record<string, unknown> = {}) => ({
  id,
  version: 2,
  flat_fee_minor: '100',
  percentage_bps: null,
  minimum_fee_minor: null,
  maximum_fee_minor: null,
  vat_bps: null,
  effective_from: '2030-01-01T00:00:00.000Z',
  effective_to: null,
  priority,
  customer_class_code: null,
  agent_class_id: null,
  institution_id: null,
  ...target,
});

describe('fee targeting resolver', () => {
  const dataSource = { query: jest.fn() };
  const resolver = new FeeRuleResolverService(dataSource as never);

  beforeEach(() => dataSource.query.mockReset());

  it('uses highest priority before targeting specificity', async () => {
    dataSource.query.mockResolvedValue([
      fee('global-higher-priority', 10),
      fee('class-lower-priority', 9, { customer_class_code: 'GOLD' }),
    ]);
    const result = await resolver.resolve({
      productCode: 'WALLET_TRANSFER',
      customerClassCode: 'gold',
      at: '2030-01-02T00:00:00.000Z',
    });
    expect(result.status).toBe('RESOLVED');
    expect(result.rule?.ruleId).toBe('global-higher-priority');
  });

  it('uses the more specific matching target when priorities tie', async () => {
    dataSource.query.mockResolvedValue([
      fee('global', 7),
      fee('class', 7, { customer_class_code: 'GOLD' }),
      fee('institution', 7, { institution_id: '11111111-1111-4111-8111-111111111111' }),
    ]);
    const result = await resolver.resolve({
      productCode: 'WALLET_TRANSFER',
      customerClassCode: 'GOLD',
      institutionId: '11111111-1111-4111-8111-111111111111',
      at: '2030-01-02T00:00:00.000Z',
    });
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.ambiguousRuleIds).toEqual(['class', 'institution']);
  });

  it('fails closed for ties at equal priority and specificity', async () => {
    dataSource.query.mockResolvedValue([
      fee('a', 5, { customer_class_code: 'GOLD' }),
      fee('b', 5, { customer_class_code: 'GOLD' }),
      fee('global', 4),
    ]);
    const result = await resolver.resolve({
      productCode: 'WALLET_TRANSFER',
      customerClassCode: 'GOLD',
      at: '2030-01-02T00:00:00.000Z',
    });
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.ambiguousRuleIds).toEqual(['a', 'b']);
  });

  it('does not match class- or institution-targeted rules without the corresponding context', async () => {
    dataSource.query.mockResolvedValue([
      fee('gold', 10, { customer_class_code: 'GOLD' }),
      fee('bank', 9, { institution_id: '11111111-1111-4111-8111-111111111111' }),
    ]);
    const result = await resolver.resolve({ productCode: 'WALLET_TRANSFER' });
    expect(result.status).toBe('NOT_CONFIGURED');
  });
});
