import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { BankingVirtualAccountService } from './banking-virtual-account.service';
import { BankingReadinessService } from './banking-readiness.service';
import { BankingProviderRegistry } from './banking-provider.registry';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
  url: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Customer banking surface.
 *
 * Every route is CUSTOMER SELF. The customer id comes from the session principal and is never accepted
 * from the request, so there is no parameter a customer could change to address another customer's
 * receiving account. Where a wallet id is accepted, ownership is re-checked in the same transaction
 * that acts on it rather than trusted from the path.
 *
 * A customer is never shown a NUBAN that was not issued by a provider. `NOT_PROVISIONED`, `PENDING`
 * and `UNKNOWN` are all presented as distinct, honest states with no account number attached, because
 * showing a number that cannot receive money is worse than showing nothing.
 */
@Controller('customers/me/banking')
export class BankingCustomerController {
  constructor(
    private readonly accounts: BankingVirtualAccountService,
    private readonly readiness: BankingReadinessService,
    private readonly registry: BankingProviderRegistry,
  ) {}

  /**
   * The authenticated customer. Returns the id rather than the principal so every caller is forced to
   * use the session's identity instead of being able to reach for a request field.
   */
  private customerOf(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'CUSTOMER' || !principal.customerId) {
      throw new UnauthorizedException('Customer authentication required');
    }
    return principal.customerId;
  }

  /**
   * The customer's own receiving account.
   *
   * Returns the authoritative state, including the states in which there is no account number. The
   * wallet must belong to the caller; a wallet id from another customer is a 404, deliberately not a
   * 403, so the endpoint does not confirm that somebody else's wallet exists.
   */
  @Get('virtual-account')
  async virtualAccount(@Req() req: AuthenticatedRequest, @Query('walletId') walletId?: string) {
    const customerId = this.customerOf(req);
    if (!walletId || !UUID.test(walletId)) throw new BadRequestException('walletId must be a UUID');
    const account = await this.accounts.findForWallet(customerId, walletId.toLowerCase());
    if (!account) {
      return {
        state: 'NOT_PROVISIONED' as const,
        accountNumber: null,
        bankName: null,
        accountName: null,
        providerSupportsProvisioning: this.supportsProvisioning(),
      };
    }
    return account;
  }

  /**
   * Requests provisioning.
   *
   * The service refuses to submit again while an earlier attempt is `UNKNOWN`, and returns that state
   * instead. The customer sees "we are still confirming" rather than a second account.
   */
  @Post('virtual-account')
  async provision(@Req() req: AuthenticatedRequest, @Query('walletId') walletId?: string) {
    const customerId = this.customerOf(req);
    if (!walletId || !UUID.test(walletId)) throw new BadRequestException('walletId must be a UUID');
    const context = await this.accounts.customerProvisioningContext(
      customerId,
      walletId.toLowerCase(),
    );
    if (!context) throw new NotFoundException('Wallet not found');
    if (!context.institutionId) {
      // No institution means no approved provider, so provisioning cannot be authorized.
      throw new ForbiddenException('Wallet is not associated with an institution');
    }
    if (!context.elegible) throw new ForbiddenException('Customer is not eligible for banking');
    const provider = this.registry.find(context.providerKey);
    if (!provider) {
      throw new ServiceUnavailableException('Banking is not configured for this institution');
    }
    const usable = await this.readiness.capabilityUsable(
      context.institutionId,
      context.providerKey,
      provider.descriptor.environment,
      'VIRTUAL_ACCOUNT_PROVISION',
    );
    if (!usable.usable) {
      // Refused, and the reason is a state, not a guess.
      throw new ServiceUnavailableException(
        `Virtual account provisioning unavailable: ${usable.state}`,
      );
    }
    const result = await this.accounts.provision({
      institutionId: context.institutionId,
      walletId: walletId.toLowerCase(),
      providerKey: context.providerKey,
      environment: provider.descriptor.environment,
      accountReference: context.accountReference,
      accountName: context.accountName,
      customerName: context.customerName,
      customerEmail: context.customerEmail,
      currency: context.currency,
      correlationId: `va:${context.accountReference}`,
    });
    return {
      state: result.outcome,
      // Only a confirmed provision carries an account number.
      accounts: result.accounts,
      unknownPending: result.unknownPending,
    };
  }

  /** Deposit history for the caller, from verified inbound records only. */
  @Get('deposits')
  async deposits(@Req() req: AuthenticatedRequest, @Query('limit') limit?: string) {
    const customerId = this.customerOf(req);
    const parsed = limit === undefined ? 50 : Number(limit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
      throw new BadRequestException('limit must be between 1 and 200');
    }
    return this.accounts.depositHistoryForCustomer(customerId, parsed);
  }

  /**
   * Status of one outbound transfer, addressed by OUR reference.
   *
   * Never returns a provider status verbatim: a customer is told whether their transfer is pending,
   * settled, or being confirmed, not what string Monnify used internally. Unknown outcomes are
   * presented as `CONFIRMING` and are never shown as failures.
   */
  @Get('transfers/:operationReference')
  async transfer(
    @Req() req: AuthenticatedRequest,
    @Param('operationReference') operationReference: string,
  ) {
    const customerId = this.customerOf(req);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(operationReference)) {
      throw new BadRequestException('operationReference is invalid');
    }
    const record = await this.accounts.transferForCustomer(customerId, operationReference);
    if (!record) throw new NotFoundException('Transfer not found');
    return record;
  }

  private supportsProvisioning(): boolean {
    return this.registry
      .list()
      .some((provider) => provider.descriptor.capabilities.VIRTUAL_ACCOUNT_PROVISION === true);
  }
}
