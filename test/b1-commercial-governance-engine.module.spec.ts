import {
  B1CommercialGovernanceEngineModule,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_PROVIDERS,
} from '../src/policy/b1-commercial-governance-engine.module';
import { B1CommercialGovernanceEngineRepository } from '../src/policy/b1-commercial-governance-engine.repository';
import { B1CommercialGovernanceEngineService } from '../src/policy/b1-commercial-governance-engine.service';

describe('B1T10 B1 commercial-governance engine NestJS module', () => {
  it('exposes the B1 commercial-governance engine providers as a frozen array', () => {
    expect(Object.isFrozen(B1_COMMERCIAL_GOVERNANCE_ENGINE_PROVIDERS)).toBe(true);
    expect(B1_COMMERCIAL_GOVERNANCE_ENGINE_PROVIDERS).toContain(
      B1CommercialGovernanceEngineRepository,
    );
    expect(B1_COMMERCIAL_GOVERNANCE_ENGINE_PROVIDERS).toContain(
      B1CommercialGovernanceEngineService,
    );
  });

  it('exposes the B1 commercial-governance engine module class', () => {
    expect(typeof B1CommercialGovernanceEngineModule).toBe('function');
  });

  it('exposes the B1 commercial-governance engine repository class', () => {
    expect(typeof B1CommercialGovernanceEngineRepository).toBe('function');
  });

  it('exposes the B1 commercial-governance engine service class', () => {
    expect(typeof B1CommercialGovernanceEngineService).toBe('function');
  });
});
