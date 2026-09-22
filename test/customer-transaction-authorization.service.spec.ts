import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import type { CustomerTransactionPinService } from '../src/customer-authentication/customer-transaction-pin.service';
import { CustomerTransactionAuthorizationService } from '../src/customer-financial-operations/customer-transaction-authorization.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

describe('CustomerTransactionAuthorizationService', () => {
  function fixture() {
    const pinService = { verifyTransactionPin: jest.fn().mockResolvedValue({ configured: true }) };
    const service = new CustomerTransactionAuthorizationService(
      pinService as unknown as CustomerTransactionPinService,
    );
    return { service, pinService };
  }

  it('authorizes a valid PIN against the authentication domain (and only there)', async () => {
    const { service, pinService } = fixture();
    await expect(service.authorizeTransaction(CUSTOMER_ID, '13579')).resolves.toBeUndefined();
    expect(pinService.verifyTransactionPin).toHaveBeenCalledWith(CUSTOMER_ID, {
      pin: '13579',
      actor: `customer:${CUSTOMER_ID}`,
    });
  });

  it('propagates the mapped authorization failures from the authentication domain', async () => {
    const { service, pinService } = fixture();

    pinService.verifyTransactionPin.mockRejectedValueOnce(new UnauthorizedException('Invalid transaction PIN'));
    await expect(service.authorizeTransaction(CUSTOMER_ID, '00000')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    pinService.verifyTransactionPin.mockRejectedValueOnce(
      new ForbiddenException('Transaction PIN is locked'),
    );
    await expect(service.authorizeTransaction(CUSTOMER_ID, '13579')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    pinService.verifyTransactionPin.mockRejectedValueOnce(
      new NotFoundException('Transaction PIN is not configured for this customer'),
    );
    await expect(service.authorizeTransaction(CUSTOMER_ID, '13579')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
