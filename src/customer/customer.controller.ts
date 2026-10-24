import {
  Body,
  Controller,
  ForbiddenException,
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
import { maskCustomerReference, maskIdentityDocumentNumber } from './customer-privacy';
import { CreateAddressDto } from './dto/create-address.dto';
import { CreateContactMethodDto } from './dto/create-contact-method.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateIdentityDocumentDto } from './dto/create-identity-document.dto';
import { CreateKycAssessmentDto } from './dto/create-kyc-assessment.dto';
import { CreateProfileDto } from './dto/create-profile.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerKycStatus, CustomerStatus } from './customer.enums';
import { CustomerIdentityDocument } from './customer-identity-document.entity';
import { Customer } from './customer.entity';
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
  async create(@Body() dto: CreateCustomerDto, @Req() req: AuthenticatedRequest) {
    const actor = await this.requireWorkforceFunction(req, 'customer.create');
    // Manual creation is always a draft. Activation remains exclusively on the lifecycle
    // endpoint, which enforces the verified-primary-phone gate and its own function check.
    const customer = await this.customerService.create({
      ...dto,
      status: CustomerStatus.DRAFT,
      actor,
    });
    return this.toWorkforceCustomerView(customer);
  }

  @Get()
  async list(@Query() query: CustomerQueryDto, @Req() req: AuthenticatedRequest) {
    await this.requireWorkforceFunction(req, 'customer.view');
    const customers = await this.customerService.list(
      query.status,
      query.type,
      query.page,
      query.limit,
    );
    return customers.map((customer) => this.toWorkforceCustomerView(customer));
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCustomerViewFunction(req);
    const customer = await this.customerService.get(id);
    return req.authorizationPrincipal?.type === 'CUSTOMER'
      ? customer
      : this.toWorkforceCustomerView(customer);
  }

  // Lifecycle transitions remain workforce-only and independently function-gated. The actor
  // is always taken from the authenticated principal; a request body cannot spoof audit identity.
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireWorkforce(req, dto.status);
    const customer = await this.customerService.updateStatus(id, { ...dto, actor });
    return this.toWorkforceCustomerView(customer);
  }

  @Post(':id/profile')
  async createProfile(
    @Param('id') id: string,
    @Body() dto: CreateProfileDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireCustomerWriteFunction(req, id, 'customer.create');
    return this.customerService.createProfile(id, { ...dto, actor });
  }

  @Post(':id/address')
  async createAddress(
    @Param('id') id: string,
    @Body() dto: CreateAddressDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireCustomerWriteFunction(req, id, 'customer.create');
    return this.customerService.createAddress(id, { ...dto, actor });
  }

  @Post(':id/contact-method')
  async createContactMethod(
    @Param('id') id: string,
    @Body() dto: CreateContactMethodDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireCustomerWriteFunction(req, id, 'customer.create');
    return this.customerService.createContactMethod(id, { ...dto, actor });
  }

  @Post(':id/identity-document')
  async createIdentityDocument(
    @Param('id') id: string,
    @Body() dto: CreateIdentityDocumentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireCustomerWriteFunction(req, id, 'customer.view_identity_documents');
    if (req.authorizationPrincipal?.type !== 'CUSTOMER') {
      await this.auth.requireFunction(
        req.authorizationPrincipal,
        'kyc.review',
        'customer',
        ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
      );
    }
    const document = await this.customerService.createIdentityDocument(id, { ...dto, actor });
    return this.toSafeIdentityDocument(document);
  }

  @Post(':id/kyc-assessment')
  async createKycAssessment(
    @Param('id') id: string,
    @Body() dto: CreateKycAssessmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireKycMutationFunction(
      req,
      KYC_ASSESSMENT_FUNCTION_BY_STATUS[dto.status],
    );
    return this.customerService.createKycAssessment(id, { ...dto, assessedBy: actor });
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
    const documents = await this.customerService.listIdentityDocuments(id);
    return documents.map((document) => this.toSafeIdentityDocument(document));
  }

  @Get(':id/kyc')
  async getKyc(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireKycReadFunction(req, 'kyc.view');
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

  private async requireWorkforceFunction(
    req: AuthenticatedRequest,
    functionCode: string,
  ): Promise<string> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER' || principal.type === 'AGENT' || principal.type === 'AGGREGATOR') {
      throw new ForbiddenException('Workforce authorization is required');
    }
    return this.auth.requireFunction(
      principal,
      functionCode,
      'customer',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
  }

  private async requireCustomerWriteFunction(
    req: AuthenticatedRequest,
    customerId: string,
    functionCode: string,
  ): Promise<string> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') {
      if (principal.customerId !== customerId) {
        throw new ForbiddenException('A customer may only update their own profile data');
      }
      return principal.customerId;
    }
    return this.requireWorkforceFunction(req, functionCode);
  }

  private async requireCustomerViewFunction(req: AuthenticatedRequest): Promise<void> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') return;
    await this.auth.requireFunction(
      principal,
      'customer.view',
      'customer',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
  }

  private async requirePiiFunction(
    req: AuthenticatedRequest,
    functionCode: string,
  ): Promise<void> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') return;
    await this.auth.requireFunction(
      principal,
      functionCode,
      'customer',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
  }

  private async requireKycReadFunction(
    req: AuthenticatedRequest,
    functionCode: string,
  ): Promise<void> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') return;
    await this.auth.requireFunction(
      principal,
      functionCode,
      'kyc',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
  }

  private async requireKycMutationFunction(
    req: AuthenticatedRequest,
    functionCode: string,
  ): Promise<string> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') {
      throw new ForbiddenException('KYC assessment changes require an authorized workforce principal');
    }
    return this.auth.requireFunction(
      principal,
      functionCode,
      'kyc',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
  }

  private toWorkforceCustomerView(customer: Customer) {
    return {
      id: customer.id,
      reference: maskCustomerReference(customer.reference),
      type: customer.type,
      status: customer.status,
      kycLevel: customer.kycLevel,
      kycStatus: customer.kycStatus,
      version: customer.version,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      deletedAt: customer.deletedAt,
    };
  }

  private toSafeIdentityDocument(document: CustomerIdentityDocument) {
    return {
      id: document.id,
      customerId: document.customerId,
      type: document.type,
      maskedDocumentNumber: maskIdentityDocumentNumber(document.documentNumber),
      issuingCountry: document.issuingCountry,
      issuedAt: document.issuedAt,
      expiresAt: document.expiresAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
