import { B1BillingEngineModule } from '../src/policy/b1-billing-engine.module';
import { B1BillingEngineRepository } from '../src/policy/b1-billing-engine.repository';
import { B1BillingEngineService } from '../src/policy/b1-billing-engine.service';
import { B1_BILLING_ENGINE_PROVIDERS } from '../src/policy/b1-billing-engine.module';

describe('B1T05 B1 billing engine NestJS module', () => {
  it('exposes the B1 billing engine providers as a frozen array', () => {
    expect(Object.isFrozen(B1_BILLING_ENGINE_PROVIDERS)).toBe(true);
    expect(B1_BILLING_ENGINE_PROVIDERS).toContain(B1BillingEngineRepository);
    expect(B1_BILLING_ENGINE_PROVIDERS).toContain(B1BillingEngineService);
  });

  it('exposes the B1 billing engine module class', () => {
    expect(typeof B1BillingEngineModule).toBe('function');
  });

  it('exposes the B1 billing engine repository class', () => {
    expect(typeof B1BillingEngineRepository).toBe('function');
  });

  it('exposes the B1 billing engine service class', () => {
    expect(typeof B1BillingEngineService).toBe('function');
  });
});
