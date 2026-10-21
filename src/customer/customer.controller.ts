import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CreateAddressDto } from './dto/create-address.dto';
import { CreateContactMethodDto } from './dto/create-contact-method.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateIdentityDocumentDto } from './dto/create-identity-document.dto';
import { CreateKycAssessmentDto } from './dto/create-kyc-assessment.dto';
import { CreateProfileDto } from './dto/create-profile.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerKycStatus, CustomerStatus } from './customer.enums';
import { CustomerService } from './customer.service';

interface AuthenticatedRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

// V1-ADMIN-AUTHORIZATION-HARDENING-01 (Decision 4): the PATCH :id lifecycle route stays a
// single unified route (per Decision 4's explicit allowance), but the catalogue models
// customer.suspend/.activate/.close as three distinct functions. The required function is
// derived from the target status actually requested, resolved BEFORE the service performs the
// transition. CustomerStatus.DRAFT has no corresponding catalogue function (nothing in the V1
// spec governs transitioning a customer back to DRAFT) and is intentionally left unmapped here
// — CustomerService.assertCustomerTransition already rejects it as an invalid transition target
// for every current status, so no function-based gate is needed for it.
const CUSTOMER_LIFECYCLE_FUNCTION_BY_STATUS: Partial<Record<CustomerStatus, string>> = {
  [CustomerStatus.ACTIVE]: 'customer.activate',
  [CustomerStatus.SUSPENDED]: 'customer.suspend',
  [CustomerStatus.CLOSED]: 'customer.close',
};

// V1-ADMIN-AUTHORIZATION-KYC-01 (Decision 5): `POST /customers/:id/kyc-assessment` is a single,
// unmodeled backend endpoint whose `dto.status` carries the actual decision intent (Decision 5
// explicitly permits keeping the single endpoint while modeling `kyc.review`/`kyc.approve`/
// `kyc.reject` as three distinct authorization functions — the same "derive the function from the
// request before authorizing" pattern Decision 4 already established for the customer-lifecycle
// PATCH route above). Approval and rejection are the two Decision-5 decision outcomes and map
// 1:1 to their own distinct EXECUTE functions; recording a PENDING assessment or resetting to
// NOT_STARTED is a non-decision review action and maps to the general `kyc.review` function —
// at no point does holding `kyc.review` alone grant `kyc.approve`/`kyc.reject` or vice versa,
// since each status maps to exactly one function and `AuthorizationService.requireFunction()`
// checks only the one function resolved for the specific request made.
const KYC_ASSESSMENT_FUNCTION_BY_STATUS: Record<CustomerKycStatus, string> = {
  [CustomerKycStatus.NOT_STARTED]: 'kyc.review',
  [CustomerKycStatus.PENDING]: 'kyc.review',
  [CustomerKycStatus.APPROVED]: 'kyc.approve',
  [CustomerKycStatus.REJECTED]: 'kyc.reject',
};

@Controller('customers')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly auth: AuthorizationService,
  ) {}

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  // V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01: `list`/`get` previously had no own authorization
  // check at all — reachable by any principal type the generic `/api/v1/customers*` route-policy
  // allows (`CUSTOMER` SELF + any `OPERATOR/SERVICE/PRIVILEGED`), with no function-level gate,
  // even though the catalogue's `customer.view` function ("View a customer profile and KYC
  // tier" — the exact data these two handlers return: the bare `Customer` record) is assigned
  // only to SUPER_ADMIN/FINANCE_AUDITOR/OPERATIONS/COMPLIANCE/CUSTOMER_SERVICE — meaning any
  // other OPERATOR-collapsing workforce role (FINANCE_PREPARER, FINANCE_CONTROLLER,
  // AGENT_NETWORK_MANAGER, RISK_FRAUD, TREASURY) could list/read any customer purely by virtue
  // of its principal type (the same gap class V1-ADMIN-AUTHORIZATION-READ-SURFACE-01 flagged and
  // KYC-01 already closed for the KYC sub-surface).
  @Get()
  async list(@Query() query: CustomerQueryDto, @Req() req: AuthenticatedRequest) {
    await this.requireCustomerViewFunction(req);
    return this.customerService.list(query.status, query.type, query.page, query.limit);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCustomerViewFunction(req);
    return this.customerService.get(id);
  }

  // Lifecycle transition (S-FIX-01, audit contradiction C-3). UpdateCustomerDto carries
  // lifecycle status only, so this route is workforce-privileged even though the other
  // endpoints on this controller remain available to CUSTOMER SELF per the route
  // policy. A CUSTOMER principal must not self-activate/self-unsuspend by supplying
  // its own id; workforce-gated at route level (route-policy-registry) AND here.
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.requireWorkforce(req, dto.status);
    return this.customerService.updateStatus(id, dto);
  }

  @Post(':id/profile')
  createProfile(@Param('id') id: string, @Body() dto: CreateProfileDto) {
    return this.customerService.createProfile(id, dto);
  }

  @Post(':id/address')
  createAddress(@Param('id') id: string, @Body() dto: CreateAddressDto) {
    return this.customerService.createAddress(id, dto);
  }

  @Post(':id/contact-method')
  createContactMethod(@Param('id') id: string, @Body() dto: CreateContactMethodDto) {
    return this.customerService.createContactMethod(id, dto);
  }

  @Post(':id/identity-document')
  createIdentityDocument(@Param('id') id: string, @Body() dto: CreateIdentityDocumentDto) {
    return this.customerService.createIdentityDocument(id, dto);
  }

  @Post(':id/kyc-assessment')
  async createKycAssessment(
    @Param('id') id: string,
    @Body() dto: CreateKycAssessmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.requireKycFunction(req, KYC_ASSESSMENT_FUNCTION_BY_STATUS[dto.status]);
    return this.customerService.createKycAssessment(id, dto);
  }

  // V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01: `customer.view`'s own catalogue name/description
  // ("View customer profile" / "View a customer profile and KYC tier") is a direct, literal
  // match for exactly this handler's data (CustomerProfile: displayName/legalName/dateOfBirth/
  // nationality) — unlike `/addresses`, `/contact-methods`, `/identity-documents` below, which
  // return distinct sub-resource PII (physical address, phone/email, government document
  // numbers) that no existing catalogue function's description covers, so those three are
  // deliberately left unmigrated (see the audit report for the documented gap).
  @Get(':id/profile')
  async getProfile(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCustomerViewFunction(req);
    return this.customerService.getProfile(id);
  }

  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01: previously left deliberately
  // unmigrated by V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01 (no catalogue function covered
  // address PII). Per docs/V1/V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01.md (approved),
  // this now requires its own dedicated `customer.view_address` function — never
  // `customer.view` — assigned to SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, COMPLIANCE,
  // CUSTOMER_SERVICE only. A real CUSTOMER principal is exempted exactly like
  // `requireCustomerViewFunction`/`requireKycFunction` above — this is the same workforce-only
  // gate pattern, not a change to CUSTOMER self-service.
  @Get(':id/addresses')
  async getAddresses(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requirePiiFunction(req, 'customer.view_address');
    return this.customerService.listAddresses(id);
  }

  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01: same pattern as `/addresses` above,
  // gated by the dedicated `customer.view_contact_methods` function (SUPER_ADMIN,
  // FINANCE_AUDITOR, OPERATIONS, COMPLIANCE, CUSTOMER_SERVICE).
  @Get(':id/contact-methods')
  async getContactMethods(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requirePiiFunction(req, 'customer.view_contact_methods');
    return this.customerService.listContactMethods(id);
  }

  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01: identity-document records carry
  // government document numbers (`documentNumber`), materially more sensitive than address/
  // contact-method PII. Per the approved decision, `customer.view_identity_documents` is
  // assigned ONLY to SUPER_ADMIN and COMPLIANCE — explicitly narrower than `customer.view` and
  // narrower than the address/contact-methods functions above (FINANCE_AUDITOR, OPERATIONS,
  // CUSTOMER_SERVICE are all denied here despite holding the other two PII functions).
  @Get(':id/identity-documents')
  async getIdentityDocuments(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requirePiiFunction(req, 'customer.view_identity_documents');
    return this.customerService.listIdentityDocuments(id);
  }

  @Get(':id/kyc')
  async getKyc(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireKycFunction(req, 'kyc.view');
    return this.customerService.getKyc(id);
  }

  // V1-ADMIN-AUTHORIZATION-HARDENING-01: function-based via customer.suspend/.activate/.close
  // (Decision 4), AND-combined with the pre-existing OPERATOR/SERVICE/PRIVILEGED principal-type
  // restriction (SUPPORT/CUSTOMER/AGENT/AGGREGATOR remain denied — UAT-DEFECT-001). Only
  // OPERATIONS and SUPER_ADMIN hold these EXECUTE functions in the catalogue; CUSTOMER_SERVICE
  // (view + support-case only), FINANCE_* , COMPLIANCE, RISK_FRAUD and TREASURY (all
  // principal.type OPERATOR) are now correctly denied instead of succeeding purely by virtue of
  // their principal type.
  private async requireWorkforce(req: AuthenticatedRequest, targetStatus: CustomerStatus): Promise<string> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const functionCode = CUSTOMER_LIFECYCLE_FUNCTION_BY_STATUS[targetStatus];
    if (functionCode) {
      // deniedStatus: 401 preserves this controller's pre-existing status code for an
      // authenticated-but-insufficiently-privileged principal (UnauthorizedException, not
      // ForbiddenException — see test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts).
      return this.auth.requireFunction(
        principal,
        functionCode,
        'customer-lifecycle',
        ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
        { deniedStatus: 401 },
      );
    }
    // No catalogue function governs this target status (e.g. DRAFT) — preserve the pre-existing
    // principal-type-only restriction rather than inventing a function for it.
    if (
      principal.type === 'AGENT' ||
      principal.type === 'CUSTOMER' ||
      (principal.type as string) === 'AGGREGATOR' ||
      principal.type === 'SUPPORT'
    ) {
      throw new UnauthorizedException('Privileged access required');
    }
    return principal.principalId;
  }

  // V1-ADMIN-AUTHORIZATION-KYC-01: `getKyc`/`createKycAssessment` previously had no own
  // authorization check at all — they were reachable by any principal type the generic
  // `/api/v1/customers/*` route-policy allows (`CUSTOMER` SELF + any `OPERATOR/SERVICE/
  // PRIVILEGED`), with zero function-level gate, even though the catalogue's `kyc.view`/
  // `.review`/`.approve`/`.reject` functions are assigned only to SUPER_ADMIN/COMPLIANCE
  // (plus `kyc.view` additionally to FINANCE_AUDITOR) — meaning any OPERATOR-collapsing
  // workforce role (FINANCE_PREPARER, FINANCE_CONTROLLER, RISK_FRAUD, CUSTOMER_SERVICE,
  // TREASURY, OPERATIONS, AGENT_NETWORK_MANAGER) could view/create KYC assessments for any
  // customer purely by virtue of its principal type (the exact gap
  // V1-ADMIN-AUTHORIZATION-READ-SURFACE-01 flagged).
  //
  // A real CUSTOMER principal is deliberately EXEMPTED from this function check and left on
  // its pre-existing, unchanged path (gated only by the route-policy's `customerAccess: 'SELF'`
  // check, enforced by RuntimeAccessGuard before this controller runs, identical to the other
  // customer sub-resource GETs on this controller — `/profile`, `/addresses`, `/identity-
  // documents`, etc.). Catalogue functions are a workforce-only authorization unit: a CUSTOMER
  // principal never holds any catalogue function in `principal.scopes` (see
  // `AuthorizationService.evaluate()`/`RuntimeAccessGuard`'s CUSTOMER branch), so requiring one
  // here would deny a customer's own pre-existing self-service reachability entirely — a
  // business-behavior change this task is explicitly not authorized to make (no KYC redesign,
  // no business-logic change). The gap this task closes is specifically the workforce
  // OPERATOR-collapse over-grant, not customer self-access.
  //
  // No `deniedStatus` override: this is a brand-new check with no pre-existing 401 convention
  // to preserve, so `AuthorizationService.requireFunction()`'s default behavior applies —
  // unauthenticated is 401, an authenticated-but-under-entitled workforce principal is 403.
  private async requireKycFunction(req: AuthenticatedRequest, functionCode: string): Promise<void> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') {
      return;
    }
    await this.auth.requireFunction(principal, functionCode, 'kyc', ['OPERATOR', 'SERVICE', 'PRIVILEGED']);
  }

  // V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01: identical exemption/gating pattern to
  // `requireKycFunction` above. A real CUSTOMER principal is deliberately EXEMPTED and left on
  // its pre-existing, unchanged path (gated only by the route-policy's `customerAccess: 'SELF'`
  // check, enforced by RuntimeAccessGuard before this controller runs) — catalogue functions are
  // a workforce-only authorization unit, a CUSTOMER principal never holds one in
  // `principal.scopes`, so requiring one here would deny a customer's own pre-existing
  // self-service reachability entirely (not this task's objective, and not authorized). The gap
  // closed is specifically the workforce OPERATOR-collapse over-grant on `list`/`get`/
  // `getProfile`. No `deniedStatus` override: these are brand-new checks with no pre-existing 401
  // convention to preserve — unauthenticated is 401, an authenticated-but-under-entitled
  // workforce principal is 403 (AuthorizationService.requireFunction()'s default behavior).
  private async requireCustomerViewFunction(req: AuthenticatedRequest): Promise<void> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') {
      return;
    }
    await this.auth.requireFunction(principal, 'customer.view', 'customer', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }

  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01: identical exemption/gating pattern
  // to `requireCustomerViewFunction`/`requireKycFunction` above, parameterized by the specific
  // PII function code for each of `/addresses`, `/contact-methods`, `/identity-documents`. A
  // real CUSTOMER principal is deliberately EXEMPTED and left on its pre-existing, unchanged
  // path (gated only by the route-policy's `customerAccess: 'SELF'` check, enforced by
  // RuntimeAccessGuard before this controller runs) — catalogue functions are a workforce-only
  // authorization unit, a CUSTOMER principal never holds one in `principal.scopes`, so
  // requiring one here would deny a customer's own pre-existing self-service reachability
  // entirely (not this task's objective, and not authorized: no change to CUSTOMER
  // self-service, ownership checks, response shape, or business logic). No `deniedStatus`
  // override: these are brand-new checks with no pre-existing 401 convention to preserve —
  // unauthenticated is 401, an authenticated-but-under-entitled workforce principal is 403
  // (AuthorizationService.requireFunction()'s default behavior — FUNCTION_MISSING never
  // collapses into 401).
  private async requirePiiFunction(req: AuthenticatedRequest, functionCode: string): Promise<void> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') {
      return;
    }
    await this.auth.requireFunction(principal, functionCode, 'customer', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }
}
