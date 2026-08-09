import {
  B1CommercialAnalyticsEngineModule,
  B1_COMMERCIAL_ANALYTICS_ENGINE_PROVIDERS,
} from '../src/policy/b1-commercial-analytics-engine.module';
import { B1CommercialAnalyticsEngineRepository } from '../src/policy/b1-commercial-analytics-engine.repository';
import { B1CommercialAnalyticsEngineService } from '../src/policy/b1-commercial-analytics-engine.service';

describe('B1T09 B1 commercial-analytics engine NestJS module', () => {
  it('exposes the B1 commercial-analytics engine providers as a frozen array', () => {
    expect(Object.isFrozen(B1_COMMERCIAL_ANALYTICS_ENGINE_PROVIDERS)).toBe(true);
    expect(B1_COMMERCIAL_ANALYTICS_ENGINE_PROVIDERS).toContain(
      B1CommercialAnalyticsEngineRepository,
    );
    expect(B1_COMMERCIAL_ANALYTICS_ENGINE_PROVIDERS).toContain(B1CommercialAnalyticsEngineService);
  });

  it('exposes the B1 commercial-analytics engine module class', () => {
    expect(typeof B1CommercialAnalyticsEngineModule).toBe('function');
  });

  it('exposes the B1 commercial-analytics engine repository class', () => {
    expect(typeof B1CommercialAnalyticsEngineRepository).toBe('function');
  });

  it('exposes the B1 commercial-analytics engine service class', () => {
    expect(typeof B1CommercialAnalyticsEngineService).toBe('function');
  });
});
