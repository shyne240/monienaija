import { B2FAccountingTreatmentModule } from '../src/policy/b2f-accounting-treatment.module';
import { B2FAccountingTreatmentService } from '../src/policy/b2f-accounting-treatment.service';
describe('B2F accounting treatment module (B2F07)', () => {
  it('wires internal adoption service and no controller', () => {
    expect(B2FAccountingTreatmentService).toBeDefined();
    expect(
      (Reflect.getMetadata('controllers', B2FAccountingTreatmentModule) as unknown[] | undefined) ??
        [],
    ).toHaveLength(0);
  });
});
