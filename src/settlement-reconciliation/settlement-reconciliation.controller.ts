import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  ImportSettlementReportDto,
  ListSettlementReconciliationQueryDto,
  ProposeReturnDisputeResolutionDto,
  ProposeSettlementMatchResolutionDto,
  ProposeTransactionMatchResolutionDto,
  ReviewReconciliationProposalDto,
} from './dto/settlement-reconciliation.dto';
import { SettlementReconciliationService } from './settlement-reconciliation.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const WORKFORCE_TYPES = ['OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;

/**
 * Finance → Reconciliation, "Provider Settlement Report & Statement Reconciliation".
 *
 * Strictly non-posting: imports provider reports/statements, matches transaction/fee/settlement/statement
 * and return/reversal/dispute records against internal evidence, and enforces MFA maker-checker review
 * (`FINANCE_PREPARER` proposes / imports; distinct `FINANCE_CONTROLLER` reviews).
 */
@Controller('internal/finance-operations/settlement-reconciliation')
export class SettlementReconciliationController {
  constructor(
    private readonly reconciliation: SettlementReconciliationService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('overview')
  async overview(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListSettlementReconciliationQueryDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_OVERVIEW',
    );
    return this.reconciliation.getWorkspaceOverview(principal, query);
  }

  @Post('imports/preview')
  async previewImport(@Req() req: AuthenticatedRequest, @Body() dto: ImportSettlementReportDto) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_IMPORT_PREVIEW',
    );
    return this.reconciliation.previewImport(principal, dto);
  }

  @Post('imports')
  async importReport(@Req() req: AuthenticatedRequest, @Body() dto: ImportSettlementReportDto) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_IMPORT_CREATE',
    );
    return this.reconciliation.importReport(principal, dto);
  }

  @Get('imports')
  async listImports(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListSettlementReconciliationQueryDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_IMPORTS_LIST',
    );
    return this.reconciliation.listImports(principal, query);
  }

  @Get('imports/:importId')
  async getImportDetail(
    @Req() req: AuthenticatedRequest,
    @Param('importId', new ParseUUIDPipe()) importId: string,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_IMPORT_DETAIL',
    );
    return this.reconciliation.getImportDetail(principal, importId);
  }

  @Get('transaction-matches')
  async listTransactionMatches(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListSettlementReconciliationQueryDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_MATCHES_LIST',
    );
    return this.reconciliation.listTransactionMatches(principal, query);
  }

  @Get('transaction-matches/:matchId')
  async getTransactionMatchDetail(
    @Req() req: AuthenticatedRequest,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_MATCH_DETAIL',
    );
    return this.reconciliation.getTransactionMatchDetail(principal, matchId);
  }

  @Post('transaction-matches/:matchId/propose')
  async proposeTransactionMatchResolution(
    @Req() req: AuthenticatedRequest,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Body() dto: ProposeTransactionMatchResolutionDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_MATCH_PROPOSE',
    );
    return this.reconciliation.proposeTransactionMatchResolution(principal, matchId, dto);
  }

  @Post('transaction-matches/:matchId/review')
  async reviewTransactionMatchResolution(
    @Req() req: AuthenticatedRequest,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Body() dto: ReviewReconciliationProposalDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_MATCH_REVIEW',
    );
    return this.reconciliation.reviewTransactionMatchResolution(principal, matchId, dto);
  }

  @Get('settlement-batches')
  async listSettlementBatches(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListSettlementReconciliationQueryDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_BATCHES_LIST',
    );
    return this.reconciliation.listSettlementBatches(principal, query);
  }

  @Get('settlement-batches/:batchId')
  async getSettlementBatchDetail(
    @Req() req: AuthenticatedRequest,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_BATCH_DETAIL',
    );
    return this.reconciliation.getSettlementBatchDetail(principal, batchId);
  }

  @Post('settlement-batches/:batchId/propose')
  async proposeSettlementBatchResolution(
    @Req() req: AuthenticatedRequest,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Body() dto: ProposeSettlementMatchResolutionDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_BATCH_PROPOSE',
    );
    return this.reconciliation.proposeSettlementBatchResolution(principal, batchId, dto);
  }

  @Post('settlement-batches/:batchId/review')
  async reviewSettlementBatchResolution(
    @Req() req: AuthenticatedRequest,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Body() dto: ReviewReconciliationProposalDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_BATCH_REVIEW',
    );
    return this.reconciliation.reviewSettlementBatchResolution(principal, batchId, dto);
  }

  @Get('return-dispute-cases')
  async listReturnDisputeCases(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListSettlementReconciliationQueryDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_CASES_LIST',
    );
    return this.reconciliation.listReturnDisputeCases(principal, query);
  }

  @Get('return-dispute-cases/:caseId')
  async getReturnDisputeCaseDetail(
    @Req() req: AuthenticatedRequest,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_CASE_DETAIL',
    );
    return this.reconciliation.getReturnDisputeCaseDetail(principal, caseId);
  }

  @Post('return-dispute-cases/:caseId/propose')
  async proposeReturnDisputeResolution(
    @Req() req: AuthenticatedRequest,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body() dto: ProposeReturnDisputeResolutionDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_CASE_PROPOSE',
    );
    return this.reconciliation.proposeReturnDisputeResolution(principal, caseId, dto);
  }

  @Post('return-dispute-cases/:caseId/review')
  async reviewReturnDisputeResolution(
    @Req() req: AuthenticatedRequest,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body() dto: ReviewReconciliationProposalDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_SETTLEMENT_RECONCILIATION_CASE_REVIEW',
    );
    return this.reconciliation.reviewReturnDisputeResolution(principal, caseId, dto);
  }

  private async require(
    req: AuthenticatedRequest,
    functionCode: string,
    resourceType: string,
  ): Promise<AuthorizationPrincipal> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    await this.auth.requireFunction(principal, functionCode, resourceType, WORKFORCE_TYPES);
    return principal;
  }
}
