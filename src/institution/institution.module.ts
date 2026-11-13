import { Module, forwardRef } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import {
  AGENT_INSTITUTION_RESOLVER,
  DatabaseAgentInstitutionResolver,
} from './agent-institution-resolver';
import { FinancialInstitutionService } from './financial-institution.service';
import { InstitutionAffiliationService } from './institution-affiliation.service';
import { AgentAffiliationController, InstitutionController } from './institution.controller';
import { InstitutionReconciliationService } from './institution-reconciliation.service';
import { InstitutionWorkforceScopeService } from './institution-workforce-scope.service';

/**
 * ARENA 4 Phase 1 — institutional foundation.
 *
 * Exports {@link AGENT_INSTITUTION_RESOLVER} and the institution-scope service so Arena 1 and
 * Arena 2 financial paths can depend on the published resolution contract instead of re-deriving
 * affiliation. The resolver is bound to the database implementation here; a deployment must not
 * swap in a default-institution implementation.
 */
@Module({
  imports: [forwardRef(() => AuthorizationModule), forwardRef(() => OperationsModule)],
  controllers: [InstitutionController, AgentAffiliationController],
  providers: [
    FinancialInstitutionService,
    InstitutionAffiliationService,
    InstitutionWorkforceScopeService,
    InstitutionReconciliationService,
    DatabaseAgentInstitutionResolver,
    { provide: AGENT_INSTITUTION_RESOLVER, useExisting: DatabaseAgentInstitutionResolver },
  ],
  exports: [
    AGENT_INSTITUTION_RESOLVER,
    DatabaseAgentInstitutionResolver,
    FinancialInstitutionService,
    InstitutionAffiliationService,
    InstitutionWorkforceScopeService,
    InstitutionReconciliationService,
  ],
})
export class InstitutionModule {}
