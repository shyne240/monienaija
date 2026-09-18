import {
  A7ProductReconciliationModule,
  A7_PRODUCT_RECONCILIATION_PROVIDERS,
} from '../src/policy/a7-product-reconciliation.module';
import { A7ProductReconciliationService } from '../src/policy/a7-product-reconciliation.service';
import { A7ProductReconciliationRepository } from '../src/policy/a7-product-reconciliation.repository';

describe('A7T09 module', () => {
  it('wires the A7 product reconciliation module class', () => {
    const module = new A7ProductReconciliationModule();
    expect(module).toBeInstanceOf(A7ProductReconciliationModule);
  });

  it('exposes the A7 product reconciliation providers', () => {
    expect(A7_PRODUCT_RECONCILIATION_PROVIDERS).toContain(A7ProductReconciliationRepository);
    expect(A7_PRODUCT_RECONCILIATION_PROVIDERS).toContain(A7ProductReconciliationService);
  });
});
