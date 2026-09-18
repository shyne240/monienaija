import { B2FAccountMappingModule } from '../src/policy/b2f-account-mapping.module';
import { B2FAccountMappingService } from '../src/policy/b2f-account-mapping.service';
describe('B2F account mapping module prerequisite', () => {
  it('wires mapping service without controller', () => {
    expect(B2FAccountMappingService).toBeDefined();
    expect(
      (Reflect.getMetadata('controllers', B2FAccountMappingModule) as unknown[] | undefined) ?? [],
    ).toHaveLength(0);
  });
});
