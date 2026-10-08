import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationCatalogueSeedService } from './authorization-catalogue-seed.service';
import { AuthorizationFunction } from './authorization-function.entity';
import { AuthorizationRoleFunction } from './authorization-role-function.entity';
import { AuthorizationRole } from './authorization-role.entity';

/**
 * V1-ADMIN-AUTHORIZATION-FOUNDATION-01
 *
 * Standalone, fully additive module housing the database-backed function
 * catalogue / role / role-function foundation. Deliberately separate from
 * `src/authorization/` (the existing A2 workforce/finance runtime) so this
 * task does not touch that sensitive, already-wired module. Nothing in the
 * live AuthorizationService/RoutePolicyRegistry/guards reads from this
 * module yet — wiring the live runtime onto this model is a later task.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuthorizationFunction, AuthorizationRole, AuthorizationRoleFunction])],
  providers: [AuthorizationCatalogueSeedService],
  exports: [AuthorizationCatalogueSeedService],
})
export class AuthorizationCatalogueModule {}
