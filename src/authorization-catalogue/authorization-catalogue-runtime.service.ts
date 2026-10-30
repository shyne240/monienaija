import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AuthorizationRole } from './authorization-role.entity';
import { AuthorizationRoleFunction } from './authorization-role-function.entity';

export interface CatalogueRoleResolution {
  /** The subset of the input role keys that exist as ACTIVE rows in `authorization_roles`. */
  recognizedRoleKeys: readonly string[];
  /** Union of ACTIVE `authorization_role_functions.function_code` across the recognized roles, regardless of access type. */
  functionCodes: readonly string[];
  /** True if ANY recognized role carries `administrative_capability = true` (generalizes the old single-literal FINANCE_ADMIN reservation). */
  hasAdministrativeCapability: boolean;
  /** True only when at least one role was recognized AND every recognized role is `read_only = true`. */
  allRecognizedRolesReadOnly: boolean;
}

const EMPTY_RESOLUTION: CatalogueRoleResolution = {
  recognizedRoleKeys: [],
  functionCodes: [],
  hasAdministrativeCapability: false,
  allRecognizedRolesReadOnly: false,
};

/**
 * V1-ADMIN-AUTHORIZATION-RUNTIME-01
 *
 * Read-only runtime bridge from "a set of role keys held by a principal" to the
 * database-backed function catalogue seeded by `AuthorizationCatalogueSeedService`
 * (V1-ADMIN-AUTHORIZATION-FOUNDATION-01). This is the ONLY place the live runtime
 * (A2WorkforceSessionService, A2FinanceRoleAdministrationService, AuthorizationService)
 * reads `authorization_roles` / `authorization_role_functions` — kept here, in the
 * catalogue module itself, so the shape of those tables never has to be duplicated
 * elsewhere.
 *
 * Deliberately does not distinguish INITIATE vs APPROVE vs EXECUTE vs VIEW access type
 * in `functionCodes` — it answers "does this set of roles touch function X at all",
 * which is the question route-level `requiredFunctions` policies need. Maker/checker
 * separation (who may INITIATE vs who may APPROVE a given governed action) remains the
 * responsibility of the existing, untouched `A2_MAKER_CHECKER_RULES_JSON` +
 * `PrivilegedActionApprovalService` machinery, which this service does not replace.
 */
@Injectable()
export class AuthorizationCatalogueRuntimeService {
  constructor(
    @InjectRepository(AuthorizationRole)
    private readonly roleRepo: Repository<AuthorizationRole>,
    @InjectRepository(AuthorizationRoleFunction)
    private readonly roleFunctionRepo: Repository<AuthorizationRoleFunction>,
  ) {}

  async resolveForRoleKeys(roleKeys: readonly string[]): Promise<CatalogueRoleResolution> {
    const unique = [...new Set(roleKeys)].filter((k) => k.length > 0);
    if (unique.length === 0) {
      return EMPTY_RESOLUTION;
    }

    const roles = await this.roleRepo.find({
      where: { roleKey: In(unique), isActive: true } as never,
    });
    if (roles.length === 0) {
      return EMPTY_RESOLUTION;
    }

    const roleIds = roles.map((r) => r.id);
    const assignments = await this.roleFunctionRepo.find({
      where: { roleId: In(roleIds), isActive: true } as never,
    });

    return {
      recognizedRoleKeys: roles.map((r) => r.roleKey).sort(),
      functionCodes: [...new Set(assignments.map((a) => a.functionCode))].sort(),
      hasAdministrativeCapability: roles.some((r) => r.administrativeCapability),
      allRecognizedRolesReadOnly: roles.every((r) => r.readOnly),
    };
  }
}
