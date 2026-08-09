import { B1FeeEngineModule } from '../src/policy/b1-fee-engine.module';
import { B1FeeEngineRepository } from '../src/policy/b1-fee-engine.repository';
import { B1FeeEngineService } from '../src/policy/b1-fee-engine.service';
import { B1_FEE_ENGINE_PROVIDERS } from '../src/policy/b1-fee-engine.module';

describe('B1T04 B1 fee engine NestJS module', () => {
  it('exposes the B1 fee engine providers as a frozen array', () => {
    expect(Object.isFrozen(B1_FEE_ENGINE_PROVIDERS)).toBe(true);
    expect(B1_FEE_ENGINE_PROVIDERS).toContain(B1FeeEngineRepository);
    expect(B1_FEE_ENGINE_PROVIDERS).toContain(B1FeeEngineService);
  });

  it('exposes the B1 fee engine module class', () => {
    expect(typeof B1FeeEngineModule).toBe('function');
  });

  it('exposes the B1 fee engine repository class', () => {
    expect(typeof B1FeeEngineRepository).toBe('function');
  });

  it('exposes the B1 fee engine service class', () => {
    expect(typeof B1FeeEngineService).toBe('function');
  });
});
