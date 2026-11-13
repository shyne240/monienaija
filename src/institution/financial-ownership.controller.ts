import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuthorizationService } from '../authorization/authorization.service';
import { CustomerInstitutionEnrolmentService } from './customer-institution-enrolment.service';
import {
  DesignatePlatformLedgerAccountDto,
  ExecuteEnrolmentDto,
  ExecuteWalletAttributionDto,
  FinancialContextQueryDto,
  OpenInstitutionLedgerAccountDto,
  RequestEnrolmentDto,
  RequestWalletAttributionDto,
} from './dto/institution.dto';
import {
  FINANCIAL_CONTEXT_RESOLVER,
  type FinancialContextResolver,
} from './financial-context-resolver';
import { Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LedgerInstitutionScopeService } from './ledger-institution-scope.service';
import { InstitutionWorkforceScopeService } from './institution-workforce-scope.service';
import { WalletInstitutionAttributionService } from './wallet-institution-attribution.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const WORKFORCE_TYPES = ['OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;

/**
 * Institutional financial ownership surface (ARENA 4 Phase 2).
 *
 * Institution-scoped routes require an ACTIVE `workforce_institution_assignments` row (or the
 * explicit platform marker) resolved at request time, exactly like Phase 1. Nothing here can set an
 * institutional attribution or an enrolment directly: every write goes through make → independent
 * check → atomic consume-and-apply.
 */
@Controller('internal/institutions')
export class InstitutionFinancialOwnershipController {
  constructor(
    private readonly enrolments: CustomerInstitutionEnrolmentService,
    private readonly attributions: WalletInstitutionAttributionService,
    private readonly ledgerScope: LedgerInstitutionScopeService,
    private readonly scope: InstitutionWorkforceScopeService,
    private readonly authorization: AuthorizationService,
  ) {}

  // ------------------------------------------------------------- customer enrolments

  @Post(':institutionId/enrolments')
  @HttpCode(HttpStatus.CREATED)
  async requestEnrolment(
    @Param('institutionId') institutionId: string,
    @Body() dto: RequestEnrolmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.enrolment.prepare',
      'institution-enrolment-prepare',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.enrolments.requestChange({
      customerId: dto.customerId,
      institutionId,
      reference: dto.reference,
      targetStatus: dto.targetStatus,
      financialEligibility: dto.financialEligibility,
      statusReason: dto.statusReason,
      kycReuse: dto.kycReuse ?? null,
      expiresInSeconds: dto.expiresInSeconds,
      principal,
    });
  }

  @Post(':institutionId/enrolments/execute')
  @HttpCode(HttpStatus.CREATED)
  async executeEnrolment(
    @Param('institutionId') institutionId: string,
    @Body() dto: ExecuteEnrolmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.enrolment.approve',
      'institution-enrolment-approve',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.enrolments.executeChange({
      customerId: dto.customerId,
      institutionId,
      reference: dto.reference,
      targetStatus: dto.targetStatus,
      financialEligibility: dto.financialEligibility,
      statusReason: dto.statusReason,
      kycReuse: dto.kycReuse ?? null,
      approvalId: dto.approvalId,
      expiresInSeconds: dto.expiresInSeconds,
      principal,
    });
  }

  @Get(':institutionId/enrolments')
  async listEnrolments(
    @Param('institutionId') institutionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.view',
      'institution-enrolments-read',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.enrolments.getForInstitution(institutionId);
  }

  // --------------------------------------------------------- wallet attribution (governed)

  @Post(':institutionId/wallet-attributions')
  @HttpCode(HttpStatus.CREATED)
  async requestAttribution(
    @Param('institutionId') institutionId: string,
    @Body() dto: RequestWalletAttributionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.attribution.prepare',
      'institution-attribution-prepare',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.attributions.requestAttribution({
      walletId: dto.walletId,
      institutionId,
      evidenceType: dto.evidenceType,
      evidenceReference: dto.evidenceReference,
      reason: dto.reason,
      expiresInSeconds: dto.expiresInSeconds,
      principal,
    });
  }

  @Post(':institutionId/wallet-attributions/execute')
  @HttpCode(HttpStatus.CREATED)
  async executeAttribution(
    @Param('institutionId') institutionId: string,
    @Body() dto: ExecuteWalletAttributionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.attribution.approve',
      'institution-attribution-approve',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.attributions.executeAttribution({
      walletId: dto.walletId,
      institutionId,
      evidenceType: dto.evidenceType,
      evidenceReference: dto.evidenceReference,
      reason: dto.reason,
      approvalId: dto.approvalId,
      expiresInSeconds: dto.expiresInSeconds,
      principal,
    });
  }

  @Get(':institutionId/wallet-attributions')
  async listAttributions(
    @Param('institutionId') institutionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.view',
      'institution-attributions-read',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.attributions.listForInstitution(institutionId);
  }

  // ------------------------------------------------ institution settlement/suspense accounts

  @Post(':institutionId/ledger-accounts')
  @HttpCode(HttpStatus.CREATED)
  async openInstitutionAccount(
    @Param('institutionId') institutionId: string,
    @Body() dto: OpenInstitutionLedgerAccountDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.manage',
      'institution-ledger-account-open',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.ledgerScope.openInstitutionAccount({
      institutionId,
      code: dto.code,
      name: dto.name,
      accountType: dto.accountType,
      normalBalance: dto.normalBalance,
      currency: dto.currency,
      purpose: dto.purpose,
      allowNegativeBalance: dto.allowNegativeBalance,
      principal,
    });
  }

  @Get(':institutionId/ledger-accounts')
  async listInstitutionAccounts(
    @Param('institutionId') institutionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.view',
      'institution-ledger-accounts-read',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.ledgerScope.listAccounts(institutionId);
  }

  private requirePrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  }
}

/**
 * Platform-level institutional ledger administration and unattributed-account visibility.
 * Every route here requires the explicit platform marker `institution.attribution.view` (reads) or
 * `institution.manage` (platform account designation).
 */
@Controller('internal/institution-ledger')
export class InstitutionLedgerController {
  constructor(
    private readonly ledgerScope: LedgerInstitutionScopeService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post('platform-accounts')
  @HttpCode(HttpStatus.CREATED)
  async designatePlatformAccount(
    @Body() dto: DesignatePlatformLedgerAccountDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.manage',
      'institution-platform-account',
      WORKFORCE_TYPES,
    );
    return this.ledgerScope.designatePlatformAccount({
      ledgerAccountId: dto.ledgerAccountId,
      principal,
    });
  }

  @Get('unattributed')
  async unattributed(
    @Query('limit') limit: string | undefined,
    @Query('entity') entity: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.attribution.view',
      'institution-unattributed-accounts',
      WORKFORCE_TYPES,
    );
    return this.ledgerScope.listUnattributed({
      limit: limit === undefined ? undefined : Number(limit),
      entity: entity === 'WALLET' || entity === 'LEDGER_ACCOUNT' ? entity : undefined,
    });
  }

  @Get('coverage')
  async coverage(@Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.attribution.view',
      'institution-financial-coverage',
      WORKFORCE_TYPES,
    );
    return this.ledgerScope.coverage();
  }

  private requirePrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  }
}

/**
 * Customer- and wallet-anchored institutional reads. These are cross-entity lookups, so they require
 * the explicit platform marker: an institution-scoped operator can never enumerate another
 * institution's customer relationship through a shared customer identity.
 */
@Controller('internal/institution-enrolments')
export class InstitutionEnrolmentReadController {
  constructor(
    private readonly enrolments: CustomerInstitutionEnrolmentService,
    private readonly attributions: WalletInstitutionAttributionService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get('customers/:customerId')
  async forCustomer(@Param('customerId') customerId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(principal, 'institution-customer-enrolments');
    return this.enrolments.listForCustomer(customerId);
  }

  @Get('wallets/:walletId')
  async forWallet(@Param('walletId') walletId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(principal, 'institution-wallet-attribution');
    return this.attributions.getForWallet(walletId);
  }

  private async requirePlatform(principal: AuthorizationPrincipal, resourceType: string) {
    await this.authorization.requireFunction(
      principal,
      'institution.attribution.view',
      resourceType,
      WORKFORCE_TYPES,
    );
  }

  private requirePrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  }
}

/**
 * Financial context validation probe. Read-only and platform-scoped; it exists so an integration
 * suite (and later a consolidated consumer) can prove exactly what the published
 * `FinancialContextResolver` contract returns for a given set of parties.
 */
@Controller('internal/financial-context')
export class FinancialContextController {
  constructor(
    @Inject(FINANCIAL_CONTEXT_RESOLVER)
    private readonly resolver: FinancialContextResolver,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validate(@Body() dto: FinancialContextQueryDto, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.attribution.view',
      'institution-financial-context',
      WORKFORCE_TYPES,
    );
    // Read-only probe: the contract requires the caller's transaction, and this adapter supplies a
    // short-lived one with SHARE locks so the answer is never assembled from a torn read.
    return this.dataSource.transaction((manager) =>
      this.resolver.resolve(manager, {
        institutionId: dto.institutionId,
        agentId: dto.agentId,
        customerId: dto.customerId,
        walletIds: dto.walletIds,
        ledgerAccountIds: dto.ledgerAccountIds,
        lock: 'SHARE',
      }),
    );
  }

  private requirePrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  }
}
