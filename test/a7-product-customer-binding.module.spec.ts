import { A7ProductCustomerBindingModule } from '../src/policy/a7-product-customer-binding.module';
import { A7ProductCustomerBindingRepository } from '../src/policy/a7-product-customer-binding.repository';
import { A7ProductCustomerBindingService } from '../src/policy/a7-product-customer-binding.service';
import { A7_PRODUCT_CUSTOMER_BINDING_PROVIDERS } from '../src/policy/a7-product-customer-binding.module';

describe('A7T04 A4 product customer-binding NestJS module', () => {
  it('exposes the A7 product customer-binding providers as a frozen array', () => {
    expect(Object.isFrozen(A7_PRODUCT_CUSTOMER_BINDING_PROVIDERS)).toBe(true);
    expect(A7_PRODUCT_CUSTOMER_BINDING_PROVIDERS).toContain(A7ProductCustomerBindingRepository);
    expect(A7_PRODUCT_CUSTOMER_BINDING_PROVIDERS).toContain(A7ProductCustomerBindingService);
  });

  it('exposes the A7 product customer-binding module class', () => {
    expect(typeof A7ProductCustomerBindingModule).toBe('function');
  });

  it('exposes the A7 product customer-binding repository class', () => {
    expect(typeof A7ProductCustomerBindingRepository).toBe('function');
  });

  it('exposes the A7 product customer-binding service class', () => {
    expect(typeof A7ProductCustomerBindingService).toBe('function');
  });
});
