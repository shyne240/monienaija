import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationCatalogueRuntimeService } from './authorization-catalogue-runtime.service';
import { AuthorizationCatalogueSeedService } from './authorization-catalogue-seed.service';
import { AuthorizationFunction } from './authorization-function.entity';
import { AuthorizationRoleFunction } from './authorization-role-function.entity';
import { AuthorizationRole } from './authorization-role.entity';

/**
 * V1-ADMIN-AUTHORIZATION-FOUNDATION-01 / V1-ADMIN-AUTHORIZATION-RUNTIME-01
 *
 * Standalone module housing the database-backed function catalogue / role /
 * role-function foundation, kept separate from `src/authorization/` (the A2
 * workforce/finance runtime) to keep this module's own surface small and
 * independently testable. As of V1-ADMIN-AUTHORIZATION-RUNTIME-01,
 * `AuthorizationCatalogueRuntimeService` (exported below) IS read by the live
 * runtime — `AuthorizationModule` imports this module specifically to consume it
 * from `A2WorkforceSessionService` and `A2FinanceRoleAdministrationService`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuthorizationFunction, AuthorizationRole, AuthorizationRoleFunction])],
  providers: [AuthorizationCatalogueSeedService, AuthorizationCatalogueRuntimeService],
  exports: [AuthorizationCatalogueSeedService, AuthorizationCatalogueRuntimeService],
})
export class AuthorizationCatalogueModule {}
