import type { QuotePaymentType } from '../quote/quote.enums';
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

    // Resolve fee rule: exactly one active effective product for NGN with an active rule
    // This mirrors BankingFeeBindingService's product-agnostic single-product check, but for preview
    // we compute the fee so the user sees the same number the commitment would bind.
    const products: Array<{ product_code: string }> = await this.dataSource.query(
      `SELECT DISTINCT r.product_code FROM fee_rules r JOIN products p ON p.code=r.product_code WHERE r.currency=$1 AND r.is_active AND p.enabled AND p.status='ACTIVE' AND r.effective_from <= clock_timestamp() AND (r.effective_to IS NULL OR r.effective_to > clock_timestamp())`,
      [currency],
    );

    if (products.length === 0) {
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
    if (products.length !== 1) {
      // Ambiguous pricing — do not guess. Return unauthoritative preview with zero fee and flag.
      return {
        principalMinor: amountMinor,
        currency,
        feeMinor: '0',
        vatMinor: '0',
        totalDebitMinor: amountMinor,
        pricingSource: 'AMBIGUOUS_PRICING' as const,
        beneficiaryId,
        bankCode: ben.destination_institution,
      };
    }

    const productCode = products[0]!.product_code;
    const rules: Array<{
      id: string;
      product_code: string;
      flat_fee_minor: string;
      percentage_bps: string;
      minimum_fee_minor: string | null;
      maximum_fee_minor: string | null;
      vat_bps: string;
      payment_type: string;
    }> = await this.dataSource.query(
      `SELECT id,product_code,flat_fee_minor::text,percentage_bps::text,minimum_fee_minor::text,maximum_fee_minor::text,vat_bps::text,payment_type FROM fee_rules WHERE product_code=$1 AND currency=$2 AND is_active AND effective_from <= clock_timestamp() AND (effective_to IS NULL OR effective_to > clock_timestamp()) ORDER BY effective_from DESC LIMIT 1`,
      [productCode, currency],
    );
    const rule = rules[0];
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
      paymentType: rule.payment_type as unknown as QuotePaymentType,
      flatFeeMinor: rule.flat_fee_minor,
      percentageBps: rule.percentage_bps,
      minimumFeeMinor: rule.minimum_fee_minor ?? undefined,
      maximumFeeMinor: rule.maximum_fee_minor ?? undefined,
      vatBps: rule.vat_bps,
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
