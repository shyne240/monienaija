import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { BankModule } from '../bank/bank.module';
import { CustomerBeneficiaryModule } from '../customer-beneficiary/customer-beneficiary.module';
import { CustomerFundingInstrumentModule } from '../customer-funding-instrument/customer-funding-instrument.module';
import { OperationsModule } from '../operations/operations.module';
import { WalletModule } from '../wallet/wallet.module';
import { ExternalCallbackReceipt } from './external-callback-receipt.entity';
import { PartnerCallbackController } from './partner-callback.controller';
import { PartnerCallbackAuthenticationService } from './partner-callback-authentication.service';
import { PartnerCallbackIngestionService } from './partner-callback-ingestion.service';
import {
  EnvironmentPartnerCallbackSecretSource,
  PARTNER_CALLBACK_SECRET_SOURCE,
} from './partner-callback-authentication.service';
import { ExternalFundingTargetMappingService } from './external-funding-target.service';
import { ExternalOperation } from './external-operation.entity';
import { ExternalOperationReference } from './external-operation-reference.entity';
import { ExternalOperationLifecycleService } from './external-operation-lifecycle.service';
import { ExternalOperationService } from './external-operation.service';
import {
  EXTERNAL_OPERATION_STATUS_VERIFIER,
  UnavailableExternalOperationStatusVerifier,
} from './external-operation-status-verifier';
import { PartnerCircuitBreakerService } from './partner-circuit-breaker.service';
import { PartnerCapabilityRegistry } from './partner-capability.registry';
import { PartnerConnectionAuditService } from './partner-connection-audit.service';
import { PartnerConnectionService } from './partner-connection.service';
import {
  EnvironmentPartnerCredentialLoader,
  PARTNER_CREDENTIAL_LOADER,
} from './partner-credentials.service';
import {
  PARTNER_REQUEST_SIGNER,
  PartnerRequestSigningService,
} from './partner-request-signing.service';

@Module({
  imports: [
    AuthorizationModule,
    BankModule,
    CustomerBeneficiaryModule,
    CustomerFundingInstrumentModule,
    OperationsModule,
    TypeOrmModule.forFeature([
      ExternalCallbackReceipt,
      ExternalOperation,
      ExternalOperationReference,
    ]),
    WalletModule,
  ],
  controllers: [PartnerCallbackController],
  providers: [
    ExternalFundingTargetMappingService,
    PartnerCallbackAuthenticationService,
    PartnerCallbackIngestionService,
    EnvironmentPartnerCallbackSecretSource,
    {
      provide: PARTNER_CALLBACK_SECRET_SOURCE,
      useExisting: EnvironmentPartnerCallbackSecretSource,
    },
    ExternalOperationLifecycleService,
    ExternalOperationService,
    PartnerCircuitBreakerService,
    {
      provide: EXTERNAL_OPERATION_STATUS_VERIFIER,
      useClass: UnavailableExternalOperationStatusVerifier,
    },
    PartnerCapabilityRegistry,
    PartnerConnectionAuditService,
    PartnerConnectionService,
    EnvironmentPartnerCredentialLoader,
    {
      provide: PARTNER_CREDENTIAL_LOADER,
      useExisting: EnvironmentPartnerCredentialLoader,
    },
    PartnerRequestSigningService,
    {
      provide: PARTNER_REQUEST_SIGNER,
      useExisting: PartnerRequestSigningService,
    },
  ],
  exports: [
    ExternalFundingTargetMappingService,
    ExternalOperationLifecycleService,
    ExternalOperationService,
    PartnerCallbackAuthenticationService,
    PartnerCallbackIngestionService,
    PartnerCapabilityRegistry,
    PartnerCircuitBreakerService,
    PartnerConnectionAuditService,
    PartnerConnectionService,
    PARTNER_CREDENTIAL_LOADER,
    PARTNER_REQUEST_SIGNER,
  ],
})
export class PartnerModule {}
