import { B1ReferralEngineModule } from '../src/policy/b1-referral-engine.module';
import { B1_REFERRAL_ENGINE_PROVIDERS } from '../src/policy/b1-referral-engine.module';
import { B1ReferralEngineRepository } from '../src/policy/b1-referral-engine.repository';
import { B1ReferralEngineService } from '../src/policy/b1-referral-engine.service';

describe('B1T07 B1 referral engine NestJS module', () => {
  it('exposes the B1 referral engine providers as a frozen array', () => {
    expect(Object.isFrozen(B1_REFERRAL_ENGINE_PROVIDERS)).toBe(true);
    expect(B1_REFERRAL_ENGINE_PROVIDERS).toContain(B1ReferralEngineRepository);
    expect(B1_REFERRAL_ENGINE_PROVIDERS).toContain(B1ReferralEngineService);
  });

  it('exposes the B1 referral engine module class', () => {
    expect(typeof B1ReferralEngineModule).toBe('function');
  });

  it('exposes the B1 referral engine repository class', () => {
    expect(typeof B1ReferralEngineRepository).toBe('function');
  });

  it('exposes the B1 referral engine service class', () => {
    expect(typeof B1ReferralEngineService).toBe('function');
  });
});
