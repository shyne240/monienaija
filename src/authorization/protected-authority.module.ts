import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import {
  PROTECTED_AUTHORITY_DATA_SOURCE,
  configValues,
  initializeProtectedAuthorityDataSource,
} from './protected-authority.config';
import { ProtectedAuthorityService } from './protected-authority.service';

/**
 * Supplies the credential-separated protected authority connection and its inspection service.
 * Global so every governance domain consumes the exact same authority rather than constructing a
 * second one, while still falling back to the ordinary connection for local/test profiles (which
 * production readiness rejects).
 */
@Global()
@Module({
  providers: [
    ProtectedAuthorityService,
    {
      provide: PROTECTED_AUTHORITY_DATA_SOURCE,
      inject: [DataSource, ConfigService],
      useFactory: (main: DataSource, config: ConfigService): Promise<DataSource> =>
        initializeProtectedAuthorityDataSource(configValues(config), main),
    },
  ],
  exports: [ProtectedAuthorityService, PROTECTED_AUTHORITY_DATA_SOURCE],
})
export class ProtectedAuthorityModule {}
