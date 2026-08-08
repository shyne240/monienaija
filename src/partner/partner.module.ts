import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { BankModule } from '../bank/bank.module';
import { CustomerBeneficiaryModule } from '../customer-beneficiary/customer-beneficiary.module';
import { CustomerFundingInstrumentModule } from '../customer-funding-instrument/customer-funding-instrument.module';
import { OperationsModule } from '../operations/operations.module';
import { WalletModule } from '../wallet/wallet.module';
import { ExternalFundingTargetMappingService } from './external-funding-target.service';
import { ExternalOperation } from './external-operation.entity';
import { ExternalOperationReference } from './external-operation-reference.entity';
import { ExternalOperationService } from './external-operation.service';
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
    TypeOrmModule.forFeature([ExternalOperation, ExternalOperationReference]),
    WalletModule,
  ],
  providers: [
    ExternalFundingTargetMappingService,
    ExternalOperationService,
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
    ExternalOperationService,
    PartnerCapabilityRegistry,
    PartnerConnectionAuditService,
    PartnerConnectionService,
    PARTNER_CREDENTIAL_LOADER,
    PARTNER_REQUEST_SIGNER,
  ],
})
export class PartnerModule {}
