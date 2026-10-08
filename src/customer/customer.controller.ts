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
import { CustomerStatus } from './customer.enums';
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

  @Get()
  list(@Query() query: CustomerQueryDto) {
    return this.customerService.list(query.status, query.type, query.page, query.limit);
  }

  @Get(':id')
  get(@Param('id') id: string) {
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
  createKycAssessment(@Param('id') id: string, @Body() dto: CreateKycAssessmentDto) {
    return this.customerService.createKycAssessment(id, dto);
  }

  @Get(':id/profile')
  getProfile(@Param('id') id: string) {
    return this.customerService.getProfile(id);
  }

  @Get(':id/addresses')
  getAddresses(@Param('id') id: string) {
    return this.customerService.listAddresses(id);
  }

  @Get(':id/contact-methods')
  getContactMethods(@Param('id') id: string) {
    return this.customerService.listContactMethods(id);
  }

  @Get(':id/identity-documents')
  getIdentityDocuments(@Param('id') id: string) {
    return this.customerService.listIdentityDocuments(id);
  }

  @Get(':id/kyc')
  getKyc(@Param('id') id: string) {
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
}
