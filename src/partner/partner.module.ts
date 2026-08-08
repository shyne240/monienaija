import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { BankModule } from '../bank/bank.module';
import { CustomerBeneficiaryModule } from '../customer-beneficiary/customer-beneficiary.module';
import { CustomerFundingInstrumentModule } from '../customer-funding-instrument/customer-funding-instrument.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OperationsModule } from '../operations/operations.module';
import { PaymentModule } from '../payment/payment.module';
import { WalletModule } from '../wallet/wallet.module';
import { ExternalCallbackReceipt } from './external-callback-receipt.entity';
import { PartnerCallbackController } from './partner-callback.controller';
import { PartnerCallbackAuthenticationService } from './partner-callback-authentication.service';
import { PartnerCallbackIngestionService } from './partner-callback-ingestion.service';
import {
  EnvironmentPartnerCallbackSecretSource,
  PARTNER_CALLBACK_SECRET_SOURCE,
} from './partner-callback-authentication.service';
import { ExternalConsentAssertionEntity } from './external-consent-assertion.entity';
import { ExternalDataClassificationEntity } from './external-data-classification.entity';
import { ExternalDataClassificationRegistry } from './external-data-classification.registry';
import { ExternalDataMinimizationService } from './external-data-minimization.service';
import { ExternalFundingTargetMappingService } from './external-funding-target.service';
import { ExternalLegalHoldEntity } from './external-legal-hold.entity';
import { ExternalOperation } from './external-operation.entity';
import { ExternalOperationReference } from './external-operation-reference.entity';
import { ExternalOperationLifecycleService } from './external-operation-lifecycle.service';
import { ExternalOperationService } from './external-operation.service';
import {
  EXTERNAL_OPERATION_STATUS_VERIFIER,
  UnavailableExternalOperationStatusVerifier,
} from './external-operation-status-verifier';
import { ExternalRetentionClassificationEntity } from './external-retention-classification.entity';
import { ExternalSecretClassificationEntity } from './external-secret-classification.entity';
import { ExternalSettlement } from './external-settlement.entity';
import { ExternalSettlementService } from './external-settlement.service';
import { ExternalSuspenseEntry } from './external-suspense-entry.entity';
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
    LedgerModule,
    OperationsModule,
    PaymentModule,
    TypeOrmModule.forFeature([
      ExternalCallbackReceipt,
      ExternalConsentAssertionEntity,
      ExternalDataClassificationEntity,
      ExternalLegalHoldEntity,
      ExternalOperation,
      ExternalOperationReference,
      ExternalRetentionClassificationEntity,
      ExternalSecretClassificationEntity,
      ExternalSettlement,
      ExternalSuspenseEntry,
    ]),
    WalletModule,
  ],
  controllers: [PartnerCallbackController],
  providers: [
    ExternalDataClassificationRegistry,
    ExternalDataMinimizationService,
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
    ExternalSettlementService,
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
    ExternalDataClassificationRegistry,
    ExternalDataMinimizationService,
    ExternalFundingTargetMappingService,
    ExternalOperationLifecycleService,
    ExternalOperationService,
    ExternalSettlementService,
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
