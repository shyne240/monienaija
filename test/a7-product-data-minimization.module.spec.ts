import {
  A7ProductDataMinimizationModule,
  A7_PRODUCT_DATA_MINIMIZATION_PROVIDERS,
} from '../src/policy/a7-product-data-minimization.module';
import { A7ProductDataMinimizationRepository } from '../src/policy/a7-product-data-minimization.repository';
import { A7ProductDataMinimizationService } from '../src/policy/a7-product-data-minimization.service';

describe('A7T10 module', () => {
  it('wires the A7 product data minimization module class', () => {
    const module = new A7ProductDataMinimizationModule();
    expect(module).toBeInstanceOf(A7ProductDataMinimizationModule);
  });

  it('exposes the A7 product data minimization providers', () => {
    expect(A7_PRODUCT_DATA_MINIMIZATION_PROVIDERS).toContain(A7ProductDataMinimizationRepository);
    expect(A7_PRODUCT_DATA_MINIMIZATION_PROVIDERS).toContain(A7ProductDataMinimizationService);
  });
});
