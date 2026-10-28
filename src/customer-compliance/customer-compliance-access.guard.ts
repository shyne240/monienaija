import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  ComplianceCaseRequest,
  type ComplianceCaseAccess,
  FRAUD_CASE_CATEGORIES,
  NON_FRAUD_CASE_CATEGORIES,
} from './customer-compliance-access';
import { ComplianceCaseCategory } from './customer-compliance.enums';

const COMPLIANCE_FUNCTION = 'compliance.manage_case';
const FRAUD_FUNCTION = 'risk_fraud.manage_fraud_case';
const CASE_FUNCTIONS = [COMPLIANCE_FUNCTION, FRAUD_FUNCTION] as const;
const WORKFORCE_TYPES = ['OPERATOR', 'PRIVILEGED'] as const;
const RESOURCE_TYPE = 'customer-compliance-case';

/**
 * Class-level gate for every case and subresource handler. The global guard must first
 * validate a workforce session. Function codes alone are insufficient for a write: the
 * catalogue runtime normally collapses VIEW/EXECUTE/INITIATE/APPROVE to the same scope.
 * Intersect that scope with the live, active role-function grant and its access type.
 */
@Injectable()
export class CustomerComplianceAccessGuard implements CanActivate {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ComplianceCaseRequest>();
    request.complianceCaseAccess = await this.resolveAccess(
      request.authorizationPrincipal,
      request.method,
      request.params,
    );
    return true;
  }

  /** Also used by case-summary widgets so they cannot bypass the same live grant boundary. */
  async resolveAccess(
    principal: AuthorizationPrincipal | undefined,
    method: string,
    params: { id?: string; caseId?: string } = {},
  ): Promise<ComplianceCaseAccess> {
    if (!principal) throw new UnauthorizedException('Authentication required');

    const isRead = ['GET', 'HEAD'].includes(method.toUpperCase());
    const allowedAccessTypes = isRead ? ['VIEW', 'EXECUTE'] : ['EXECUTE'];
    const rows: Array<{ function_code: string }> = await this.dataSource.query(
      `SELECT DISTINCT rf.function_code
         FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id
        WHERE r.role_key = ANY($1::varchar[])
          AND r.is_active = true AND rf.is_active = true
          AND rf.function_code = ANY($2::varchar[])
          AND rf.access_type = ANY($3::varchar[])`,
      [principal.roles, CASE_FUNCTIONS, allowedAccessTypes],
    );
    const eligible = new Set(rows.map((row) => row.function_code));
    const functions = CASE_FUNCTIONS.filter(
      (code) => eligible.has(code) && principal.scopes.includes(code),
    );

    // Filter only the two case functions before the audited authorization decision. This
    // causes VIEW-only, inactive or otherwise ineligible grants to be recorded as denied,
    // even though the general workforce scope resolver discards grant access types.
    const effectivePrincipal: AuthorizationPrincipal = {
      ...principal,
      scopes: principal.scopes.filter(
        (scope) =>
          !CASE_FUNCTIONS.some((code) => code === scope) ||
          functions.includes(scope as (typeof CASE_FUNCTIONS)[number]),
      ),
    };
    const toCheck = functions.length > 0 ? functions : [COMPLIANCE_FUNCTION];
    for (const functionCode of toCheck) {
      const decision = await this.authorization.authorize(
        effectivePrincipal,
        {
          resourceType: RESOURCE_TYPE,
          action: `${method.toUpperCase()}:${functionCode}`,
          allowedPrincipalTypes: WORKFORCE_TYPES,
          requiredFunctions: [functionCode],
          // Workforce sessions currently have customerAccess NONE and no customer assignment
          // mapping. SELF here retains the existing workforce convention; it does not mean
          // that an operator is assigned to this customer. The service separately binds every
          // case and subresource to the customer in the URL and the permitted category set.
          customerAccess: 'SELF',
        },
        { type: RESOURCE_TYPE, id: params.caseId, customerId: params.id },
      );
      if (!decision.allowed) {
        throw new ForbiddenException(`Authorization denied: ${decision.reason}`);
      }
    }

    const categories: ComplianceCaseCategory[] = [];
    if (functions.includes(COMPLIANCE_FUNCTION)) categories.push(...NON_FRAUD_CASE_CATEGORIES);
    if (functions.includes(FRAUD_FUNCTION)) categories.push(...FRAUD_CASE_CATEGORIES);
    return Object.freeze({
      actor: principal.principalId,
      categories: Object.freeze(categories),
    });
  }
}
