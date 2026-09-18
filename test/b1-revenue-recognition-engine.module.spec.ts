import {
  B1RevenueRecognitionEngineModule,
  B1_REVENUE_RECOGNITION_ENGINE_PROVIDERS,
} from '../src/policy/b1-revenue-recognition-engine.module';
import { B1RevenueRecognitionEngineRepository } from '../src/policy/b1-revenue-recognition-engine.repository';
import { B1RevenueRecognitionEngineService } from '../src/policy/b1-revenue-recognition-engine.service';

describe('B1T08 B1 revenue-recognition engine NestJS module', () => {
  it('exposes the B1 revenue-recognition engine providers as a frozen array', () => {
    expect(Object.isFrozen(B1_REVENUE_RECOGNITION_ENGINE_PROVIDERS)).toBe(true);
    expect(B1_REVENUE_RECOGNITION_ENGINE_PROVIDERS).toContain(B1RevenueRecognitionEngineRepository);
    expect(B1_REVENUE_RECOGNITION_ENGINE_PROVIDERS).toContain(B1RevenueRecognitionEngineService);
  });

  it('exposes the B1 revenue-recognition engine module class', () => {
    expect(typeof B1RevenueRecognitionEngineModule).toBe('function');
  });

  it('exposes the B1 revenue-recognition engine repository class', () => {
    expect(typeof B1RevenueRecognitionEngineRepository).toBe('function');
  });

  it('exposes the B1 revenue-recognition engine service class', () => {
    expect(typeof B1RevenueRecognitionEngineService).toBe('function');
  });
});
