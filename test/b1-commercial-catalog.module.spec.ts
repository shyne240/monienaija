import { B1CommercialCatalogModule } from '../src/policy/b1-commercial-catalog.module';
import { B1CommercialCatalogRepository } from '../src/policy/b1-commercial-catalog.repository';
import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1_COMMERCIAL_CATALOG_PROVIDERS } from '../src/policy/b1-commercial-catalog.module';

describe('B1T03 B1 commercial catalog NestJS module', () => {
  it('exposes the B1 commercial catalog providers as a frozen array', () => {
    expect(Object.isFrozen(B1_COMMERCIAL_CATALOG_PROVIDERS)).toBe(true);
    expect(B1_COMMERCIAL_CATALOG_PROVIDERS).toContain(B1CommercialCatalogRepository);
    expect(B1_COMMERCIAL_CATALOG_PROVIDERS).toContain(B1CommercialCatalogService);
  });

  it('exposes the B1 commercial catalog module class', () => {
    expect(typeof B1CommercialCatalogModule).toBe('function');
  });

  it('exposes the B1 commercial catalog repository class', () => {
    expect(typeof B1CommercialCatalogRepository).toBe('function');
  });

  it('exposes the B1 commercial catalog service class', () => {
    expect(typeof B1CommercialCatalogService).toBe('function');
  });
});
