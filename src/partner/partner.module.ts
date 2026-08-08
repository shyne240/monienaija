import { Module } from '@nestjs/common';

import { OperationsModule } from '../operations/operations.module';
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
  imports: [OperationsModule],
  providers: [
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
    PartnerCapabilityRegistry,
    PartnerConnectionAuditService,
    PartnerConnectionService,
    PARTNER_CREDENTIAL_LOADER,
    PARTNER_REQUEST_SIGNER,
  ],
})
export class PartnerModule {}
