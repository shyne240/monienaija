import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthorizationService } from '../authorization/authorization.service';
import { ProtectedAuthorityModule } from '../authorization/protected-authority.module';
import { ProtectedAuthorityService } from '../authorization/protected-authority.service';
import type { Environment } from '../config/environment';
import { InstitutionModule } from '../institution/institution.module';
import { KycTierModule } from '../kyc-verification/kyc-tier.module';
import { OperationsModule } from '../operations/operations.module';

import { LimitAssignmentController } from './limit-assignment.controller';
import { LimitAssignmentService } from './limit-assignment.service';
import { LimitAssignment } from './limit-assignment.entity';
import { LimitCatalogController } from './limit-catalog.controller';
import { LimitCatalogService } from './limit-catalog.service';
import { CustomerLimitViewService } from './customer-limit-view.service';
import { LimitDiagnosticsService } from './limit-diagnostics.service';
import { LimitEnforcementService } from './limit-enforcement.service';
import { InstitutionKycLimitPolicyController } from './institution-kyc-limit-policy.controller';
import { InstitutionKycLimitPolicyService } from './institution-kyc-limit-policy.service';
import { LimitOperationsController } from './limit-operations.controller';
import { LimitProfile } from './limit-profile.entity';
import { LimitProfileResolverService } from './limit-profile-resolver.service';
import { LimitReservation } from './limit-reservation.entity';
import { LimitReservationRecoveryService } from './limit-reservation-recovery.service';
import { LimitRule } from './limit-rule.entity';
import { LimitUsage } from './limit-usage.entity';
import { LimitUsageService } from './limit-usage.service';
import { LimitRuleGovernanceService } from './limit-rule-governance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LimitProfile,
      LimitRule,
      LimitAssignment,
      LimitUsage,
      LimitReservation,
    ]),
    forwardRef(() => OperationsModule),
    forwardRef(() => AuthorizationModule),
    ProtectedAuthorityModule,
    forwardRef(() => KycTierModule),
    forwardRef(() => InstitutionModule),
  ],
  controllers: [
    LimitCatalogController,
    LimitAssignmentController,
    LimitOperationsController,
    InstitutionKycLimitPolicyController,
  ],
  providers: [
    LimitCatalogService,
    LimitRuleGovernanceService,
    LimitAssignmentService,
    LimitUsageService,
    LimitProfileResolverService,
    {
      provide: InstitutionKycLimitPolicyService,
      inject: [DataSource, AuthorizationService, ProtectedAuthorityService, ConfigService],
      useFactory: (
        db: DataSource,
        auth: AuthorizationService,
        protectedAuthority: ProtectedAuthorityService,
        config: ConfigService<Environment, true>,
      ) => new InstitutionKycLimitPolicyService(db, auth, protectedAuthority, config),
    },
    LimitEnforcementService,
    LimitDiagnosticsService,
    LimitReservationRecoveryService,
    CustomerLimitViewService,
  ],
  exports: [
    LimitCatalogService,
    LimitAssignmentService,
    LimitUsageService,
    LimitProfileResolverService,
    LimitEnforcementService,
    InstitutionKycLimitPolicyService,
    LimitDiagnosticsService,
    LimitReservationRecoveryService,
    CustomerLimitViewService,
  ],
})
export class LimitCatalogModule {}
