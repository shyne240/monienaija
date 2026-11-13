import { Module, forwardRef } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import {
  AGENT_INSTITUTION_RESOLVER,
  DatabaseAgentInstitutionResolver,
} from './agent-institution-resolver';
import { CustomerInstitutionEnrolmentService } from './customer-institution-enrolment.service';
import {
  DatabaseFinancialContextResolver,
  FINANCIAL_CONTEXT_RESOLVER,
  NotConfiguredFinancialContextResolver,
} from './financial-context-resolver';
import {
  FinancialContextController,
  InstitutionEnrolmentReadController,
  InstitutionFinancialOwnershipController,
  InstitutionLedgerController,
} from './financial-ownership.controller';
import { FinancialInstitutionService } from './financial-institution.service';
import { LedgerInstitutionScopeService } from './ledger-institution-scope.service';
import { WalletInstitutionAttributionService } from './wallet-institution-attribution.service';
import { InstitutionAffiliationService } from './institution-affiliation.service';
import { AgentAffiliationController, InstitutionController } from './institution.controller';
import { InstitutionReconciliationService } from './institution-reconciliation.service';
import { InstitutionWorkforceScopeService } from './institution-workforce-scope.service';

/**
 * ARENA 4 Phase 1 — institutional foundation, plus Phase 2 — institutional financial ownership.
 *
 * Exports {@link AGENT_INSTITUTION_RESOLVER}, {@link FINANCIAL_CONTEXT_RESOLVER} and the
 * institution-scope service so Arena 1 and Arena 2 financial paths can depend on published
 * resolution contracts instead of re-deriving affiliation or ownership. Both resolvers are bound to
 * their database implementations here; a deployment must not swap in a default-institution
 * implementation (`NotConfiguredFinancialContextResolver` fails closed and is only referenced by
 * tests that explicitly override the provider).
 */
@Module({
  imports: [forwardRef(() => AuthorizationModule), forwardRef(() => OperationsModule)],
  controllers: [
    InstitutionController,
    AgentAffiliationController,
    InstitutionFinancialOwnershipController,
    InstitutionLedgerController,
    InstitutionEnrolmentReadController,
    FinancialContextController,
  ],
  providers: [
    FinancialInstitutionService,
    InstitutionAffiliationService,
    InstitutionWorkforceScopeService,
    InstitutionReconciliationService,
    DatabaseAgentInstitutionResolver,
    { provide: AGENT_INSTITUTION_RESOLVER, useExisting: DatabaseAgentInstitutionResolver },
    CustomerInstitutionEnrolmentService,
    WalletInstitutionAttributionService,
    LedgerInstitutionScopeService,
    DatabaseFinancialContextResolver,
    NotConfiguredFinancialContextResolver,
    { provide: FINANCIAL_CONTEXT_RESOLVER, useExisting: DatabaseFinancialContextResolver },
  ],
  exports: [
    AGENT_INSTITUTION_RESOLVER,
    DatabaseAgentInstitutionResolver,
    FinancialInstitutionService,
    InstitutionAffiliationService,
    InstitutionWorkforceScopeService,
    InstitutionReconciliationService,
    CustomerInstitutionEnrolmentService,
    WalletInstitutionAttributionService,
    LedgerInstitutionScopeService,
    FINANCIAL_CONTEXT_RESOLVER,
    DatabaseFinancialContextResolver,
  ],
})
export class InstitutionModule {}
