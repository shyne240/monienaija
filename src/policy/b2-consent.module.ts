/**
 * B2T06 — B2 consent authority NestJS module.
 *
 * The B2 consent module wires the consent service to the shared
 * IdempotencyService, AuditService, OutboxService, and MetricsService
 * through OperationsModule and to the TypeORM persistence for the
 * b2_consent table. It does not create another Customer authority, does
 * not modify CustomerPreference, A1 identity, or A2 authorization, does
 * not execute notifications, does not activate products, and does not
 * communicate with external partners.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B2Consent } from './b2-consent.entity';
import { B2ConsentRepository } from './b2-consent.repository';
import { B2ConsentService } from './b2-consent.service';

export const B2_CONSENT_PROVIDERS: readonly Provider[] = Object.freeze([
  B2ConsentRepository,
  B2ConsentService,
]);

@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([B2Consent])],
  providers: B2_CONSENT_PROVIDERS as Provider[],
  exports: [B2ConsentService, B2ConsentRepository],
})
export class B2ConsentModule {}
