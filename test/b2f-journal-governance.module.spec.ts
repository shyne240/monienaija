import { B2FJournalGovernanceModule } from '../src/policy/b2f-journal-governance.module';
import { B2FJournalGovernanceService } from '../src/policy/b2f-journal-governance.service';
describe('B2F journal governance module (B2F05)', () => {
  it('exposes internal module/service without a controller', () => {
    expect(B2FJournalGovernanceModule).toBeDefined();
    expect(B2FJournalGovernanceService).toBeDefined();
    expect(
      (Reflect.getMetadata('controllers', B2FJournalGovernanceModule) as unknown[] | undefined) ??
        [],
    ).toHaveLength(0);
  });
});
