import { B2F_FISCAL_PERIOD_PROVIDERS } from '../src/policy/b2f-fiscal-period.module';
import { B2FFiscalPeriodRepository } from '../src/policy/b2f-fiscal-period.repository';
import { B2FFiscalPeriodService } from '../src/policy/b2f-fiscal-period.service';

describe('B2F fiscal period module (B2F04)', () => {
  it('exports only the bounded repository and service providers', () => {
    expect(B2F_FISCAL_PERIOD_PROVIDERS).toEqual([
      B2FFiscalPeriodRepository,
      B2FFiscalPeriodService,
    ]);
  });

  it('does not include Ledger, B1, A6, API, or controller providers', () => {
    const names = B2F_FISCAL_PERIOD_PROVIDERS.map(
      (provider) => (provider as { name?: string }).name ?? '',
    );
    expect(names.some((name) => /Ledger|Journal|Balance|B1|Settlement|Controller/.test(name))).toBe(
      false,
    );
  });
});
