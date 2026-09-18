import {
  A7ProductFinancialEffectModule,
  A7_PRODUCT_FINANCIAL_EFFECT_PROVIDERS,
} from '../src/policy/a7-product-financial-effect.module';
import { A7ProductFinancialEffectRepository } from '../src/policy/a7-product-financial-effect.repository';
import { A7ProductFinancialEffectService } from '../src/policy/a7-product-financial-effect.service';

describe('A7T08 A7 product financial effect NestJS module', () => {
  it('exposes the A7 product financial effect providers as a frozen array', () => {
    expect(Object.isFrozen(A7_PRODUCT_FINANCIAL_EFFECT_PROVIDERS)).toBe(true);
    expect(A7_PRODUCT_FINANCIAL_EFFECT_PROVIDERS).toContain(A7ProductFinancialEffectRepository);
    expect(A7_PRODUCT_FINANCIAL_EFFECT_PROVIDERS).toContain(A7ProductFinancialEffectService);
  });

  it('exposes the A7 product financial effect module class', () => {
    expect(typeof A7ProductFinancialEffectModule).toBe('function');
  });

  it('exposes the A7 product financial effect repository class', () => {
    expect(typeof A7ProductFinancialEffectRepository).toBe('function');
  });

  it('exposes the A7 product financial effect service class', () => {
    expect(typeof A7ProductFinancialEffectService).toBe('function');
  });
});
