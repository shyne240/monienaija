import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  AUTHORIZATION_FUNCTION_SEED,
  AUTHORIZATION_ROLE_FUNCTION_SEED,
  AUTHORIZATION_ROLE_SEED,
} from './authorization-catalogue.seed';
import { AuthorizationFunction } from './authorization-function.entity';
import { AuthorizationRoleFunction } from './authorization-role-function.entity';
import { AuthorizationRole } from './authorization-role.entity';

/**
 * Idempotent bootstrap seed for the authorization catalogue, mirroring the
 * existing CapabilitySeedService pattern (count-based, insert-missing-only,
 * never duplicates, safe to run on every boot).
 */
@Injectable()
export class AuthorizationCatalogueSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthorizationCatalogueSeedService.name);

  constructor(
    @InjectRepository(AuthorizationFunction)
    private readonly functionRepo: Repository<AuthorizationFunction>,
    @InjectRepository(AuthorizationRole)
    private readonly roleRepo: Repository<AuthorizationRole>,
    @InjectRepository(AuthorizationRoleFunction)
    private readonly roleFunctionRepo: Repository<AuthorizationRoleFunction>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedIfEmpty();
  }

  async seedIfEmpty(): Promise<{ functions: number; roles: number; roleFunctions: number }> {
    const functionsInserted = await this.seedFunctions();
    const rolesInserted = await this.seedRoles();
    const roleFunctionsInserted = await this.seedRoleFunctions();

    if (functionsInserted + rolesInserted + roleFunctionsInserted > 0) {
      this.logger.log(
        `Authorization catalogue: inserted ${functionsInserted} function(s), ${rolesInserted} role(s), ${roleFunctionsInserted} role/function assignment(s)`,
      );
    }

    return { functions: functionsInserted, roles: rolesInserted, roleFunctions: roleFunctionsInserted };
  }

  private async seedFunctions(): Promise<number> {
    let inserted = 0;
    for (const item of AUTHORIZATION_FUNCTION_SEED) {
      const exists = await this.functionRepo.findOne({ where: { functionCode: item.functionCode } as never });
      if (!exists) {
        await this.functionRepo.save(
          this.functionRepo.create({
            functionCode: item.functionCode,
            domain: item.domain,
            name: item.name,
            description: item.description,
            sensitivity: item.sensitivity,
            v1Status: item.v1Status,
            assignable: item.assignable,
            financeClassRestricted: item.financeClassRestricted ?? false,
            makerCheckerRequired: item.makerCheckerRequired ?? false,
            approvalRequired: item.approvalRequired ?? false,
            superAdminExcluded: item.superAdminExcluded ?? false,
            auditorVisible: item.auditorVisible ?? true,
            notes: item.notes ?? null,
          } as never) as never,
        );
        inserted++;
      }
    }
    return inserted;
  }

  private async seedRoles(): Promise<number> {
    let inserted = 0;
    for (const item of AUTHORIZATION_ROLE_SEED) {
      const exists = await this.roleRepo.findOne({ where: { roleKey: item.roleKey } as never });
      if (!exists) {
        await this.roleRepo.save(
          this.roleRepo.create({
            roleKey: item.roleKey,
            displayName: item.displayName,
            description: item.description,
            isActive: true,
            isSystemSeeded: true,
            financeRoleClass: item.financeRoleClass ?? false,
            administrativeCapability: item.administrativeCapability ?? false,
            readOnly: item.readOnly ?? false,
            makerEligible: item.makerEligible ?? false,
            checkerEligible: item.checkerEligible ?? false,
            createdBy: 'SYSTEM_SEED',
          } as never) as never,
        );
        inserted++;
      }
    }
    return inserted;
  }

  private async seedRoleFunctions(): Promise<number> {
    let inserted = 0;
    const roles = await this.roleRepo.find();
    const roleIdByKey = new Map(roles.map((r) => [r.roleKey, r.id]));

    for (const item of AUTHORIZATION_ROLE_FUNCTION_SEED) {
      const roleId = roleIdByKey.get(item.roleKey);
      if (!roleId) {
        this.logger.warn(`Authorization catalogue seed: role ${item.roleKey} not found, skipping assignment to ${item.functionCode}`);
        continue;
      }
      const exists = await this.roleFunctionRepo.findOne({
        where: { roleId, functionCode: item.functionCode } as never,
      });
      if (!exists) {
        await this.roleFunctionRepo.save(
          this.roleFunctionRepo.create({
            roleId,
            functionCode: item.functionCode,
            accessType: item.accessType,
            isActive: true,
            assignedBy: 'SYSTEM_SEED',
            assignedAt: new Date(),
          } as never) as never,
        );
        inserted++;
      }
    }
    return inserted;
  }

  /** For tests only: truncate and reseed from scratch. */
  async reseed(): Promise<{ functions: number; roles: number; roleFunctions: number }> {
    await this.roleFunctionRepo.query('TRUNCATE TABLE authorization_role_functions');
    await this.roleRepo.query('TRUNCATE TABLE authorization_roles CASCADE');
    await this.functionRepo.query('TRUNCATE TABLE authorization_functions CASCADE');
    return this.seedIfEmpty();
  }
}
