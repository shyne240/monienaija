/**
 * B2T10 — B2 public API authentication NestJS module.
 *
 * The module wires the public API authentication service to the shared
 * IdempotencyService, AuditService, OutboxService, and MetricsService
 * through OperationsModule and to the TypeORM persistence for the
 * authentication decision table. It consumes previous B2 modules only
 * through their published consumer ports and never duplicates an
 * existing authority. It reuses the A2 AuthenticationSession /
 * PrivilegedActionApproval primitives and never creates a second vault.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B2PublicApiAuthentication } from './b2-public-api-authentication.entity';
import { B2PublicApiAuthenticationRepository } from './b2-public-api-authentication.repository';
import { B2PublicApiAuthenticationService } from './b2-public-api-authentication.service';

export const B2_PUBLIC_API_AUTHENTICATION_PROVIDERS: readonly Provider[] = Object.freeze([
  B2PublicApiAuthenticationRepository,
  B2PublicApiAuthenticationService,
]);

@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([B2PublicApiAuthentication])],
  providers: B2_PUBLIC_API_AUTHENTICATION_PROVIDERS as Provider[],
  exports: [B2PublicApiAuthenticationService, B2PublicApiAuthenticationRepository],
})
export class B2PublicApiAuthenticationModule {}
