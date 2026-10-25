import type { Environment } from '../config/environment';

export const PROOF_OF_ADDRESS_CONFIG = 'PROOF_OF_ADDRESS_CONFIG';
export const PROOF_OF_ADDRESS_STORAGE = 'PROOF_OF_ADDRESS_STORAGE';

export interface ProofOfAddressConfiguration {
  enabled: boolean;
  nodeEnv: Environment['NODE_ENV'];
  maxUploadBytes: number;
  storageProvider: Environment['POA_STORAGE_PROVIDER'];
  localStorageRoot: string;
  encryptionKeyFile: string;
  encryptionKeyringJson?: string;
  encryptionActiveKeyVersion: string;
  clamavHost: string;
  clamavPort: number;
  clamavTimeoutMs: number;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3ForcePathStyle: boolean;
}

export function proofOfAddressConfiguration(environment: Environment): ProofOfAddressConfiguration {
  return {
    enabled: environment.POA_UPLOADS_ENABLED,
    nodeEnv: environment.NODE_ENV,
    maxUploadBytes: environment.POA_MAX_UPLOAD_BYTES,
    storageProvider: environment.POA_STORAGE_PROVIDER,
    localStorageRoot: environment.POA_LOCAL_STORAGE_ROOT,
    encryptionKeyFile: environment.POA_ENCRYPTION_KEY_FILE,
    encryptionKeyringJson: environment.POA_ENCRYPTION_KEYRING_JSON,
    encryptionActiveKeyVersion: environment.POA_ENCRYPTION_ACTIVE_KEY_VERSION,
    clamavHost: environment.POA_CLAMAV_HOST,
    clamavPort: environment.POA_CLAMAV_PORT,
    clamavTimeoutMs: environment.POA_CLAMAV_TIMEOUT_MS,
    s3Bucket: environment.POA_S3_BUCKET,
    s3Region: environment.POA_S3_REGION,
    s3Endpoint: environment.POA_S3_ENDPOINT,
    s3ForcePathStyle: environment.POA_S3_FORCE_PATH_STYLE,
  };
}
