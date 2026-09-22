import { Injectable } from '@nestjs/common';

import { CustomerTransactionPinService } from '../customer-authentication/customer-transaction-pin.service';

/**
 * Customer transaction step-up authorization boundary.
 *
 * AUTHENTICATION → AUTHORIZATION → FINANCIAL OPERATION.
 *
 * The runtime access guard already authenticated the CUSTOMER session and the
 * owning CustomerFinancialOperationsService already re-proved ownership
 * through the financial binding before this service is invoked. This service
 * adds the required step-up factor — a verified transaction PIN — and nothing
 * else: it NEVER executes financial operations itself.
 *
 * The PIN is forwarded only to the authentication domain for verification; it
 * is never read back, stored, logged, or included in any result.
 */
@Injectable()
export class CustomerTransactionAuthorizationService {
  constructor(private readonly transactionPinService: CustomerTransactionPinService) {}

  /**
   * Verifies the customer's transaction PIN as step-up authorization for a
   * financial operation. Resolves on success; throws the authentication
   * domain's mapped exception (400 malformed, 404 not configured, 401
   * invalid, 403 locked/inactive) otherwise.
   */
  async authorizeTransaction(customerId: string, transactionPin: string): Promise<void> {
    await this.transactionPinService.verifyTransactionPin(customerId, {
      pin: transactionPin,
      actor: `customer:${customerId}`,
    });
  }
}
