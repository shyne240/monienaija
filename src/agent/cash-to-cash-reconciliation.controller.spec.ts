import { ServiceUnavailableException } from '@nestjs/common';
import { CashToCashReconciliationController } from './cash-to-cash-reconciliation.controller';

describe('workforce cash-to-cash reconciliation scope', () => {
  it('does not disclose a handoff from a function grant without institution entitlement', async () => {
    const lookup = jest.fn();
    const requireFunction = jest.fn().mockResolvedValue(undefined);
    const controller = new CashToCashReconciliationController(
      { lookup } as never,
      { requireFunction } as never,
    );
    await expect(
      controller.lookup({}, '11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(requireFunction).toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
});
