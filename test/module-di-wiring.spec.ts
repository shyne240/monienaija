/**
 * Focused regression test for NestJS module wiring of the P0-A governed-change surfaces.
 *
 * Background (real Windows PG run at a604aa2): AppModule boot failed with
 * "Nest can't resolve dependencies of the ProductGovernanceController (ProductGovernanceService,
 * ?, AuthorizationService). Please make sure that the argument CommercialRuleGovernanceService
 * at index [1] is available in the ProductGovernanceModule module." — the registry controllers
 * inject CommercialRuleGovernanceService + AuthorizationService (exported by
 * AuthorizationModule) but RewardModule / ProductCatalogModule / ProductGovernanceModule never
 * imported AuthorizationModule, so every AppModule bootstrap failed at dependency resolution.
 *
 * This spec compiles each affected module graph with only the DataSource stubbed (no database):
 * if a controller's constructor dependencies stop resolving, compilation throws here, in the
 * fast unit run — before any PostgreSQL run is attempted.
 */
import { ConfigModule } from '@nestjs/config';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ObjectLiteral, Repository } from 'typeorm';

import { AuthorizationModule } from '../src/authorization/authorization.module';
import { CommercialRuleGovernanceService } from '../src/authorization/commercial-rule-governance.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { CommissionModule } from '../src/commission/commission.module';
import { FeeRulesModule } from '../src/fee-rules/fee-rules.module';
import { LedgerModule } from '../src/ledger/ledger.module';
import { ProductCatalogModule } from '../src/product-catalog/product-catalog.module';
import { ProductGovernanceModule } from '../src/product-governance/product-governance.module';
import { RewardModule } from '../src/reward/reward.module';

// AppModule's ConfigModule.forRoot() validates the environment at module evaluation, so the
// required DB_* values must exist before AppModule is required (it is required lazily below).
process.env.DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
process.env.DB_NAME = process.env.DB_NAME ?? 'monienaija';
process.env.DB_USER = process.env.DB_USER ?? 'monienaija';
process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? 'monienaija-pw';

const stubDataSource = {
  // Shape expected by @nestjs/typeorm's repository factory + nothing else in this test.
  options: { type: 'postgres' },
  entityMetadatas: [] as Array<{ target: unknown; treeType?: unknown }>,
  getRepository: () => ({} as unknown as Repository<ObjectLiteral>),
  getTreeRepository: () => ({} as unknown as Repository<ObjectLiteral>),
  getMongoRepository: () => ({} as unknown as Repository<ObjectLiteral>),
  createQueryRunner: () => {
    throw new Error('stub DataSource must not run queries in this wiring test');
  },
} as unknown as DataSource;

function testingModuleBuilder(imports: unknown[]) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      // Stand in for AppModule's TypeOrmCoreModule so forFeature() repositories resolve
      // against the stub; nothing in this test touches a real database.
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        username: 'stub',
        password: 'stub',
        database: 'stub',
        entities: [],
      } as never),
      ...(imports as never[]),
    ],
  })
    .overrideProvider(DataSource)
    .useValue(stubDataSource);
}

const REGISTRY_MODULES: Array<[string, Type<unknown>]> = [
  ['FeeRulesModule', FeeRulesModule],
  ['CommissionModule', CommissionModule],
  ['RewardModule', RewardModule],
  ['ProductCatalogModule', ProductCatalogModule],
  ['ProductGovernanceModule', ProductGovernanceModule],
  ['LedgerModule', LedgerModule],
];

describe('P0-A module wiring (registry controllers vs AuthorizationModule exports)', () => {
  it.each(REGISTRY_MODULES)(
    '%s resolves every controller dependency (CommercialRuleGovernanceService, AuthorizationService, ...)',
    async (_name, moduleType) => {
      const moduleRef = await testingModuleBuilder([moduleType]).compile();
      expect(moduleRef).toBeDefined();
      await moduleRef.close();
    },
  );

  it('AuthorizationModule exports CommercialRuleGovernanceService and AuthorizationService', async () => {
    const moduleRef = await testingModuleBuilder([AuthorizationModule]).compile();
    expect(moduleRef.get(CommercialRuleGovernanceService)).toBeDefined();
    expect(moduleRef.get(AuthorizationService)).toBeDefined();
    await moduleRef.close();
  });

  it('AppModule boots: every controller in the application graph resolves', async () => {
    // Lazy require: AppModule evaluates ConfigModule.forRoot() at import time and must see the
    // DB_* environment defaults set above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { AppModule } = require('../src/app.module') as { AppModule: unknown };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule as never] })
      .overrideProvider(DataSource)
      .useValue(stubDataSource)
      .compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 120_000);
});
