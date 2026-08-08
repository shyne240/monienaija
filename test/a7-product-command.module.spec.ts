import { A7ProductCommandModule } from '../src/policy/a7-product-command.module';
import { A7ProductCommandRepository } from '../src/policy/a7-product-command.repository';
import { A7ProductCommandService } from '../src/policy/a7-product-command.service';
import { A7_PRODUCT_COMMAND_PROVIDERS } from '../src/policy/a7-product-command.module';

describe('A7T05 A7 product command NestJS module', () => {
  it('exposes the A7 product command providers as a frozen array', () => {
    expect(Object.isFrozen(A7_PRODUCT_COMMAND_PROVIDERS)).toBe(true);
    expect(A7_PRODUCT_COMMAND_PROVIDERS).toContain(A7ProductCommandRepository);
    expect(A7_PRODUCT_COMMAND_PROVIDERS).toContain(A7ProductCommandService);
  });

  it('exposes the A7 product command module class', () => {
    expect(typeof A7ProductCommandModule).toBe('function');
  });

  it('exposes the A7 product command repository class', () => {
    expect(typeof A7ProductCommandRepository).toBe('function');
  });

  it('exposes the A7 product command service class', () => {
    expect(typeof A7ProductCommandService).toBe('function');
  });
});
