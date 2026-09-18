import { B1CampaignEngineModule } from '../src/policy/b1-campaign-engine.module';
import { B1CampaignEngineRepository } from '../src/policy/b1-campaign-engine.repository';
import { B1CampaignEngineService } from '../src/policy/b1-campaign-engine.service';
import { B1_CAMPAIGN_ENGINE_PROVIDERS } from '../src/policy/b1-campaign-engine.module';

describe('B1T06 B1 campaign engine NestJS module', () => {
  it('exposes the B1 campaign engine providers as a frozen array', () => {
    expect(Object.isFrozen(B1_CAMPAIGN_ENGINE_PROVIDERS)).toBe(true);
    expect(B1_CAMPAIGN_ENGINE_PROVIDERS).toContain(B1CampaignEngineRepository);
    expect(B1_CAMPAIGN_ENGINE_PROVIDERS).toContain(B1CampaignEngineService);
  });

  it('exposes the B1 campaign engine module class', () => {
    expect(typeof B1CampaignEngineModule).toBe('function');
  });

  it('exposes the B1 campaign engine repository class', () => {
    expect(typeof B1CampaignEngineRepository).toBe('function');
  });

  it('exposes the B1 campaign engine service class', () => {
    expect(typeof B1CampaignEngineService).toBe('function');
  });
});
