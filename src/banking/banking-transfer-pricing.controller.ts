import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { FeeEngine } from '../fee/fee.engine';
import { WALLET_TO_BANK } from '../product-catalog/banking-product-identities';
import {
  selectCurrentWalletToBankFeeRule,
  WALLET_TO_BANK_PAYMENT_TYPE,
} from './banking-fee-rule-selection';

interface AuthenticatedRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * Server-authoritative pricing preview for wallet→bank transfers.
 *
 * The preview is not an authorization; it is the exact fee the commitment would bind,
 * computed from the same approved fee rule the commitment uses. The commitment re-prices
 * inside its own SERIALIZABLE transaction and refuses if the total differs, so a client
 * cannot lock in a stale quote. Showing the preview prevents the customer from authorizing
 * a total they have not seen, but it never replaces the commitment's own binding.
 *
 * When no approved fee rule exists the preview reports zero fee — the same behaviour the
 * commitment's fee binding has (it returns null and the commitment proceeds without a fee).
 * No tariff is invented.
 */
@Controller()
export class BankingTransferPricingController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly feeEngine: FeeEngine,
  ) {}

  @Get('customers/me/banking/bank-transfer-preview')
  async customerPreview(
    @Req() req: AuthenticatedRequest,
    @Query('beneficiaryId') beneficiaryId?: string,
    @Query('amountMinor') amountMinor?: string,
    @Query('walletId') walletId?: string,
  ) {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'CUSTOMER' || !principal.customerId)
      throw new UnauthorizedException('Customer authentication required');
    return this.preview(principal.customerId, 'CUSTOMER', beneficiaryId, amountMinor, walletId);
  }

  @Get('agents/me/banking/bank-transfer-preview')
  async agentPreview(
    @Req() req: AuthenticatedRequest,
    @Query('beneficiaryId') beneficiaryId?: string,
    @Query('amountMinor') amountMinor?: string,
    @Query('walletId') walletId?: string,
  ) {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId)
      throw new UnauthorizedException('Agent authentication required');
    return this.preview(principal.agentId, 'AGENT', beneficiaryId, amountMinor, walletId);
  }

  private async preview(
    ownerId: string,
    ownerType: 'CUSTOMER' | 'AGENT',
    beneficiaryId: string | undefined,
    amountMinor: string | undefined,
    walletId: string | undefined,
  ) {
    if (
      !beneficiaryId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beneficiaryId)
    )
      throw new BadRequestException('beneficiaryId must be a UUID');
    if (!amountMinor || !/^[1-9]\d{0,18}$/.test(amountMinor))
      throw new BadRequestException('amountMinor must be a positive integer');
    const currency = 'NGN';

    // Verify caller owns the beneficiary and it is ACTIVE, verified BANK_ACCOUNT
    const ownerColumn = ownerType === 'CUSTOMER' ? 'customer_id' : 'agent_id';
    const benRows: Array<{
      destination_institution: string;
      destination_identifier: string;
      status: string;
      verified: boolean;
      beneficiary_type: string;
    }> = await this.dataSource.query(
      `SELECT destination_institution,destination_identifier,status,verified,beneficiary_type FROM customer_beneficiaries WHERE id=$1 AND ${ownerColumn}=$2 AND deleted_at IS NULL LIMIT 1`,
      [beneficiaryId, ownerId],
    );
    if (benRows.length === 0) throw new BadRequestException('Beneficiary not found');
    const ben = benRows[0]!;
    if (ben.status !== 'ACTIVE' || !ben.verified || ben.beneficiary_type !== 'BANK_ACCOUNT')
      throw new BadRequestException('Beneficiary is not an active verified bank account');

    // Verify wallet ownership if supplied
    if (walletId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(walletId))
        throw new BadRequestException('walletId must be a UUID');
      const wRows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM wallet_accounts WHERE id=$1 AND customer_id=$2::text AND owner_class=$3 AND status='ACTIVE' LIMIT 1`,
        [walletId.toLowerCase(), ownerId, ownerType],
      );
      if (wRows.length === 0) throw new BadRequestException('Wallet not found');
    }

    // PR #27: price against the canonical product for this direction only.
    //
    // This used to resolve "whichever single product in NGN happens to have an active rule", which
    // made the number the customer saw depend on unrelated products and made the preview report
    // AMBIGUOUS_PRICING as soon as a second product was priced. The catalogue now names the product,
    // and `BankingFeeBindingService` — the thing the commitment actually calls — selects by the same
    // product code, so the preview and the bound fee cannot diverge.
    const productCode = WALLET_TO_BANK.productCode;
    // Same selector the commitment's binding uses — see banking-fee-rule-selection.ts.
    const rule = await selectCurrentWalletToBankFeeRule(this.dataSource.manager, currency);
    if (!rule) {
      return {
        principalMinor: amountMinor,
        currency,
        feeMinor: '0',
        vatMinor: '0',
        totalDebitMinor: amountMinor,
        pricingSource: 'NO_FEE_RULE' as const,
        beneficiaryId,
        bankCode: ben.destination_institution,
      };
    }

    const calc = this.feeEngine.calculate(amountMinor, currency, {
      paymentType: WALLET_TO_BANK_PAYMENT_TYPE,
      // A rule with NULL flat and NULL percentage is an approved "no charge" rule, distinct from a
      // missing rule. Absent is zero here, exactly as in BankingFeeBindingService.
      flatFeeMinor: rule.flat_fee_minor ?? '0',
      percentageBps: rule.percentage_bps ?? 0,
      minimumFeeMinor: rule.minimum_fee_minor ?? '0',
      maximumFeeMinor: rule.maximum_fee_minor ?? undefined,
      vatBps: rule.vat_bps ?? 0,
    });

    return {
      principalMinor: calc.amountMinor,
      currency: calc.currency,
      feeMinor: calc.feeMinor,
      vatMinor: calc.vatMinor,
      totalDebitMinor: calc.totalMinor,
      pricingSource: 'APPROVED_RULE' as const,
      feeRuleId: rule.id,
      productCode,
      beneficiaryId,
      bankCode: ben.destination_institution,
    };
  }
}
