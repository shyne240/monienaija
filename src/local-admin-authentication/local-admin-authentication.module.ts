import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import { LocalAdminCredential } from './local-admin-credential.entity';
import { LocalAdminAuthenticationService } from './local-admin-authentication.service';
import { LocalAdminAuthenticationController } from './local-admin-authentication.controller';

/**
 * V1-ADMIN-LOCAL-LOGIN-01 — see LocalAdminAuthenticationService for the full rationale.
 * LOCAL DEVELOPMENT ONLY: every code path this module exposes independently refuses to
 * operate outside NODE_ENV=development/test.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LocalAdminCredential]), AuthorizationModule, OperationsModule],
  controllers: [LocalAdminAuthenticationController],
  providers: [LocalAdminAuthenticationService],
  exports: [LocalAdminAuthenticationService],
})
export class LocalAdminAuthenticationModule {}
