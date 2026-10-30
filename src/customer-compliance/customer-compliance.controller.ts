import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';

import type { ComplianceCaseRequest } from './customer-compliance-access';
import { CustomerComplianceAccessGuard } from './customer-compliance-access.guard';
import { CustomerComplianceService } from './customer-compliance.service';
import { CreateComplianceCaseAssignmentDto } from './dto/create-compliance-case-assignment.dto';
import { CreateComplianceCaseCommentDto } from './dto/create-compliance-case-comment.dto';
import { CreateComplianceCaseDto } from './dto/create-compliance-case.dto';
import { CreateComplianceCaseEvidenceDto } from './dto/create-compliance-case-evidence.dto';
import { UpdateComplianceCaseDto } from './dto/update-compliance-case.dto';

@Controller('customers')
@UseGuards(CustomerComplianceAccessGuard)
export class CustomerComplianceController {
  constructor(private readonly complianceService: CustomerComplianceService) {}

  @Post(':id/compliance-cases')
  createCase(
    @Param('id') id: string,
    @Body() dto: CreateComplianceCaseDto,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.createCase(id, dto, req.complianceCaseAccess);
  }

  @Get(':id/compliance-cases')
  listCases(@Param('id') id: string, @Req() req: ComplianceCaseRequest) {
    return this.complianceService.listCases(id, req.complianceCaseAccess);
  }

  @Get(':id/compliance-cases/:caseId')
  getCase(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.getCase(id, caseId, req.complianceCaseAccess);
  }

  @Patch(':id/compliance-cases/:caseId')
  updateCase(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: UpdateComplianceCaseDto,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.updateCase(id, caseId, dto, req.complianceCaseAccess);
  }

  @Post(':id/compliance-cases/:caseId/comment')
  addComment(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: CreateComplianceCaseCommentDto,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.addComment(id, caseId, dto, req.complianceCaseAccess);
  }

  @Get(':id/compliance-cases/:caseId/comments')
  listComments(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.listComments(id, caseId, req.complianceCaseAccess);
  }

  @Post(':id/compliance-cases/:caseId/evidence')
  addEvidence(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: CreateComplianceCaseEvidenceDto,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.addEvidence(id, caseId, dto, req.complianceCaseAccess);
  }

  @Get(':id/compliance-cases/:caseId/evidence')
  listEvidence(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.listEvidence(id, caseId, req.complianceCaseAccess);
  }

  @Post(':id/compliance-cases/:caseId/assignment')
  assignCase(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: CreateComplianceCaseAssignmentDto,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.assignCase(id, caseId, dto, req.complianceCaseAccess);
  }

  @Get(':id/compliance-cases/:caseId/assignments')
  listAssignments(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.listAssignments(id, caseId, req.complianceCaseAccess);
  }

  @Get(':id/compliance-cases/:caseId/history')
  listHistory(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Req() req: ComplianceCaseRequest,
  ) {
    return this.complianceService.listHistory(id, caseId, req.complianceCaseAccess);
  }
}
