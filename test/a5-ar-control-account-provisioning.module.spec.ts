import { A5ArControlAccountProvisioningService } from '../src/ledger/ar-control-account-provisioning.service';
import { LedgerModule } from '../src/ledger/ledger.module';

describe('A5T11 ledger module wiring', () => {
  it('exports the bounded provisioning service without adding a controller', () => {
    expect(A5ArControlAccountProvisioningService).toBeDefined();
    const controllers =
      (Reflect.getMetadata('controllers', LedgerModule) as Array<{ name?: string }> | undefined) ??
      [];
    expect(controllers.map((controller) => controller.name)).toEqual(['LedgerController']);
  });
});
