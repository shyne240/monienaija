import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import {
  DecideProviderProposalDto,
  ProposeProviderConfigurationDto,
  ResolveReconciliationExceptionDto,
  StartReconciliationDto,
} from './banking-admin.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { BankingProviderGovernanceService } from './banking-provider-governance.service';
import { BankingReadinessService } from './banking-readiness.service';
import { BankingReconciliationService } from './banking-reconciliation.service';
import { BankingProviderRegistry } from './banking-provider.registry';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Administrative banking surface.
 *
 * Every route resolves through the authorization policy registry before it is reached, and each
 * handler additionally requires a specific catalogue function so that reaching this controller is not
 * sufficient on its own. The two layers are deliberate: the registry decides *who may address the
 * route at all*, and the function check decides *what they may do*, which keeps a future registry
 * mistake from becoming an authority grant.
 *
 * What these routes will not return: credentials, raw provider payloads, provider identifiers beyond
 * references the caller is already authorized to see, or any figure that is not attributable to a
 * record.
 */
@Controller('internal/banking')
export class BankingAdminController {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly readiness: BankingReadinessService,
    private readonly governance: BankingProviderGovernanceService,
    private readonly reconciliation: BankingReconciliationService,
    private readonly registry: BankingProviderRegistry,
  ) {}

  // ------------------------------------------------------------------ readiness

  @Get('providers')
  async providers(
    @Req() req: AuthenticatedRequest,
    @Query('institutionId') institutionId?: string,
  ) {
    await this.require(req, 'banking.provider.view');
    if (!institutionId || !UUID.test(institutionId)) {
      throw new BadRequestException('institutionId must be a UUID');
    }
    return {
      registered: this.registry.list().map((p) => p.descriptor.key),
      // Readiness is per institution because approval, credentialing and operational status are all
      // institution-scoped facts. A global "provider ready" flag would be a lie about somebody.
      providers: await this.readiness.forInstitution(institutionId.toLowerCase()),
    };
  }

  @Get('capabilities')
  capabilities() {
    // Static capability description: what this build can do, with no institution claim attached.
    return this.registry.list().map((provider) => ({
      providerKey: provider.descriptor.key,
      displayName: provider.descriptor.displayName,
      environment: provider.descriptor.environment,
      capabilities: provider.descriptor.capabilities,
      descriptors: provider.descriptor.descriptors,
    }));
  }

  // ----------------------------------------------------------------- governance

  @Get('governance/:institutionId')
  async governanceView(
    @Req() req: AuthenticatedRequest,
    @Param('institutionId') institutionId: string,
  ) {
    await this.require(req, 'banking.provider.view');
    return this.governance.view(req.authorizationPrincipal, institutionId);
  }

  @Post('governance/:institutionId/proposals')
  async propose(
    @Req() req: AuthenticatedRequest,
    @Param('institutionId') institutionId: string,
    @Body() body: ProposeProviderConfigurationDto,
  ) {
    await this.require(req, 'banking.provider.propose');
    return this.governance.propose(req.authorizationPrincipal, {
      institutionId,
      requestId: body.requestId,
      expectedVersion: body.expectedVersion,
      providerKey: body.providerKey,
      environment: body.environment,
      definition: body.definition,
      credentialBundleFingerprint: body.credentialBundleFingerprint ?? null,
      routingApproved: body.routingApproved,
      operationalReady: body.operationalReady,
      reason: body.reason,
    });
  }

  @Post('governance/:institutionId/proposals/:proposalId/decide')
  async decide(
    @Req() req: AuthenticatedRequest,
    @Param('institutionId') institutionId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: DecideProviderProposalDto,
  ) {
    await this.require(req, 'banking.provider.approve');
    return this.governance.decide(
      req.authorizationPrincipal,
      institutionId,
      proposalId,
      body.approve,
    );
  }

  // -------------------------------------------------------------- reconciliation

  @Get('reconciliation/:institutionId/runs')
  async reconciliationRuns(
    @Req() req: AuthenticatedRequest,
    @Param('institutionId') institutionId: string,
  ) {
    await this.require(req, 'reconciliation.view');
    // Runs are listed per institution; there is no global "show me everything" variant, because a
    // reconciliation view that crosses institutions is a cross-customer disclosure.
    return this.dbRuns(institutionId);
  }

  @Post('reconciliation/:institutionId/runs')
  async startReconciliation(
    @Req() req: AuthenticatedRequest,
    @Param('institutionId') institutionId: string,
    @Body() body: StartReconciliationDto,
  ) {
    await this.require(req, 'banking.reconciliation.run');
    const providerKey = body.providerKey;
    if (!this.registry.find(providerKey)) {
      throw new NotFoundException('Provider is not registered');
    }
    const runId = await this.reconciliation.startRun({
      institutionId: institutionId.toLowerCase(),
      providerKey,
      environment: this.registry.find(providerKey)!.descriptor.environment,
    });
    return { runId, state: 'RUNNING' as const };
  }

  @Get('reconciliation/:institutionId/exceptions')
  async exceptions(
    @Req() req: AuthenticatedRequest,
    @Param('institutionId') institutionId: string,
    @Query('limit') limit?: string,
  ) {
    await this.require(req, 'reconciliation.view');
    const parsed = limit === undefined ? 100 : Number(limit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 500) {
      throw new BadRequestException('limit must be between 1 and 500');
    }
    return this.reconciliation.openExceptions(institutionId.toLowerCase(), parsed);
  }

  @Post('reconciliation/exceptions/:exceptionId/resolve')
  async resolveException(
    @Req() req: AuthenticatedRequest,
    @Param('exceptionId') exceptionId: string,
    @Body() body: ResolveReconciliationExceptionDto,
  ) {
    await this.require(req, 'banking.reconciliation.resolve');
    const resolution = body.resolution;
    const principal = req.authorizationPrincipal;
    await this.reconciliation.resolve(
      exceptionId,
      resolution,
      principal?.principalId ?? 'unknown',
      body.note,
    );
    // Returns no financial figures: resolving an exception records a decision, it does not move money.
    return { exceptionId, resolution };
  }

  /** Run history for one institution, read-only. */
  private async dbRuns(institutionId: string) {
    return this.reconciliation.listRuns(institutionId.toLowerCase());
  }

  /**
   * Function gate. The resource type is distinct per concern so an audit record says which banking
   * surface was addressed, not merely that "banking" was.
   */
  private async require(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'BANKING_ADMIN');
  }
}
