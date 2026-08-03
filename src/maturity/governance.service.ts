import { createHash, randomUUID } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ProductionConfigurationService } from '../production/production-configuration.service';
import { ProductionReadinessService } from '../production/production-readiness.service';
import { GovernanceMetadata } from './governance-metadata.entity';
import type { GovernanceMetadataView } from './maturity.types';

@Injectable()
export class GovernanceService {
  constructor(
    @InjectRepository(GovernanceMetadata)
    private readonly repository: Repository<GovernanceMetadata>,
    private readonly dataSource: DataSource,
    private readonly configurationService: ProductionConfigurationService,
    private readonly readinessService: ProductionReadinessService,
  ) {}

  async recordStartup(): Promise<GovernanceMetadataView> {
    const readiness = await this.readinessService.getReadiness();
    if (readiness.status !== 'ok') {
      throw new ConflictException('Cannot record governance metadata before readiness passes');
    }
    const configuration = this.configurationService.getSafeConfiguration();
    const startupTimestamp = new Date();
    const buildTimestamp = this.parseBuildTimestamp();
    const metadata = await this.dataSource.transaction(async (manager) =>
      manager.getRepository(GovernanceMetadata).save(
        manager.getRepository(GovernanceMetadata).create({
          id: randomUUID(),
          applicationVersion: configuration.version,
          migrationHead: `${readiness.migrations.latestTimestamp}:${readiness.migrations.latestName}`,
          configurationFingerprint: createHash('sha256')
            .update(JSON.stringify(configuration))
            .digest('hex'),
          buildTimestamp,
          startupTimestamp,
          environment: configuration.environment,
          apiVersion: configuration.apiVersion,
        }),
      ),
    );
    return this.toView(metadata);
  }

  async latest(): Promise<GovernanceMetadataView | null> {
    const records = await this.repository.find({
      order: { startupTimestamp: 'DESC' },
      take: 1,
    });
    const metadata = records[0];
    return metadata ? this.toView(metadata) : null;
  }

  private parseBuildTimestamp(): Date | null {
    const value = process.env.BUILD_TIMESTAMP;
    if (!value) {
      return null;
    }
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  }

  private toView(metadata: GovernanceMetadata): GovernanceMetadataView {
    return {
      id: metadata.id,
      applicationVersion: metadata.applicationVersion,
      migrationHead: metadata.migrationHead,
      configurationFingerprint: metadata.configurationFingerprint,
      buildTimestamp: metadata.buildTimestamp?.toISOString() ?? null,
      startupTimestamp: metadata.startupTimestamp.toISOString(),
      environment: metadata.environment,
      apiVersion: metadata.apiVersion,
      createdAt: metadata.createdAt.toISOString(),
    };
  }
}
