import { B2FFinanceControlModule } from '../src/policy/b2f-finance-control.module';
import { B2FFinanceControlService } from '../src/policy/b2f-finance-control.service';
describe('B2F Finance control module (B2F06)', () => {
  it('wires internal control service and no controller', () => {
    expect(B2FFinanceControlService).toBeDefined();
    expect(
      (Reflect.getMetadata('controllers', B2FFinanceControlModule) as unknown[] | undefined) ?? [],
    ).toHaveLength(0);
  });
});
