import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import { CustomerAddress } from '../customer/customer-address.entity';
import {
  PROOF_OF_ADDRESS_CONFIG,
  PROOF_OF_ADDRESS_STORAGE,
  type ProofOfAddressConfiguration,
} from './customer-proof-of-address.config';
import { CustomerProofOfAddressController } from './customer-proof-of-address.controller';
import { CustomerProofOfAddressDocumentHistory } from './customer-proof-of-address-document-history.entity';
import { CustomerProofOfAddressService } from './customer-proof-of-address.service';
import { CustomerProofOfAddressSubmission } from './customer-proof-of-address-submission.entity';
import { ClamAvMalwareScanner } from './clamav-malware-scanner.service';
import {
  LocalPrivateProofOfAddressStorage,
  S3PrivateProofOfAddressStorage,
} from './private-document-storage.adapters';
import { PrivateDocumentEncryptionService } from './private-document-encryption.service';
import { PROOF_OF_ADDRESS_MALWARE_SCANNER } from './customer-proof-of-address.tokens';

@Module({
  imports: [
    AuthorizationModule,
    OperationsModule,
    TypeOrmModule.forFeature([
      CustomerAddress,
      CustomerProofOfAddressSubmission,
      CustomerProofOfAddressDocumentHistory,
    ]),
  ],
  controllers: [CustomerProofOfAddressController],
  providers: [
    {
      provide: PROOF_OF_ADDRESS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ProofOfAddressConfiguration => ({
        enabled: config.get<boolean>('POA_UPLOADS_ENABLED', false),
        nodeEnv: config.get<ProofOfAddressConfiguration['nodeEnv']>('NODE_ENV', 'development'),
        maxUploadBytes: config.get<number>('POA_MAX_UPLOAD_BYTES', 10 * 1024 * 1024),
        storageProvider: config.get<ProofOfAddressConfiguration['storageProvider']>(
          'POA_STORAGE_PROVIDER',
          'local',
        ),
        localStorageRoot: config.get<string>(
          'POA_LOCAL_STORAGE_ROOT',
          './data/private-poa/objects',
        ),
        encryptionKeyFile: config.get<string>(
          'POA_ENCRYPTION_KEY_FILE',
          './data/private-poa/encryption.key',
        ),
        encryptionKeyringJson: config.get<string>('POA_ENCRYPTION_KEYRING_JSON'),
        encryptionActiveKeyVersion: config.get<string>('POA_ENCRYPTION_ACTIVE_KEY_VERSION', 'v1'),
        clamavHost: config.get<string>('POA_CLAMAV_HOST', '127.0.0.1'),
        clamavPort: config.get<number>('POA_CLAMAV_PORT', 3310),
        clamavTimeoutMs: config.get<number>('POA_CLAMAV_TIMEOUT_MS', 5_000),
        s3Bucket: config.get<string>('POA_S3_BUCKET'),
        s3Region: config.get<string>('POA_S3_REGION'),
        s3Endpoint: config.get<string>('POA_S3_ENDPOINT'),
        s3ForcePathStyle: config.get<boolean>('POA_S3_FORCE_PATH_STYLE', false),
      }),
    },
    {
      provide: PROOF_OF_ADDRESS_STORAGE,
      inject: [PROOF_OF_ADDRESS_CONFIG],
      useFactory: (config: ProofOfAddressConfiguration) =>
        config.storageProvider === 's3'
          ? new S3PrivateProofOfAddressStorage(config)
          : new LocalPrivateProofOfAddressStorage(config),
    },
    ClamAvMalwareScanner,
    { provide: PROOF_OF_ADDRESS_MALWARE_SCANNER, useExisting: ClamAvMalwareScanner },
    PrivateDocumentEncryptionService,
    CustomerProofOfAddressService,
  ],
  exports: [CustomerProofOfAddressService],
})
export class CustomerProofOfAddressModule {}
