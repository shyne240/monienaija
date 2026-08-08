import { A7ProductLifecycleModule } from '../src/policy/a7-product-lifecycle.module';
import { A7ProductLifecycleRepository } from '../src/policy/a7-product-lifecycle.repository';
import { A7ProductLifecycleService } from '../src/policy/a7-product-lifecycle.service';
import { A7_PRODUCT_LIFECYCLE_PROVIDERS } from '../src/policy/a7-product-lifecycle.module';

describe('A7T07 A7 product lifecycle NestJS module', () => {
  it('exposes the A7 product lifecycle providers as a frozen array', () => {
    expect(Object.isFrozen(A7_PRODUCT_LIFECYCLE_PROVIDERS)).toBe(true);
    expect(A7_PRODUCT_LIFECYCLE_PROVIDERS).toContain(A7ProductLifecycleRepository);
    expect(A7_PRODUCT_LIFECYCLE_PROVIDERS).toContain(A7ProductLifecycleService);
  });

  it('exposes the A7 product lifecycle module class', () => {
    expect(typeof A7ProductLifecycleModule).toBe('function');
  });

  it('exposes the A7 product lifecycle repository class', () => {
    expect(typeof A7ProductLifecycleRepository).toBe('function');
  });

  it('exposes the A7 product lifecycle service class', () => {
    expect(typeof A7ProductLifecycleService).toBe('function');
  });
});
