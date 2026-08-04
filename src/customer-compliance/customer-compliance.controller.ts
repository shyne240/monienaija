import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CustomerComplianceService } from './customer-compliance.service';
import { CreateComplianceCaseAssignmentDto } from './dto/create-compliance-case-assignment.dto';
import { CreateComplianceCaseCommentDto } from './dto/create-compliance-case-comment.dto';
import { CreateComplianceCaseDto } from './dto/create-compliance-case.dto';
import { CreateComplianceCaseEvidenceDto } from './dto/create-compliance-case-evidence.dto';
import { UpdateComplianceCaseDto } from './dto/update-compliance-case.dto';

@Controller('customers')
export class CustomerComplianceController {
  constructor(private readonly complianceService: CustomerComplianceService) {}

  @Post(':id/compliance-cases')
  createCase(@Param('id') id: string, @Body() dto: CreateComplianceCaseDto) {
    return this.complianceService.createCase(id, dto);
  }

  @Get(':id/compliance-cases')
  listCases(@Param('id') id: string) {
    return this.complianceService.listCases(id);
  }

  @Get(':id/compliance-cases/:caseId')
  getCase(@Param('id') id: string, @Param('caseId') caseId: string) {
    return this.complianceService.getCase(id, caseId);
  }

  @Patch(':id/compliance-cases/:caseId')
  updateCase(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: UpdateComplianceCaseDto,
  ) {
    return this.complianceService.updateCase(id, caseId, dto);
  }

  @Post(':id/compliance-cases/:caseId/comment')
  addComment(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: CreateComplianceCaseCommentDto,
  ) {
    return this.complianceService.addComment(id, caseId, dto);
  }

  @Get(':id/compliance-cases/:caseId/comments')
  listComments(@Param('id') id: string, @Param('caseId') caseId: string) {
    return this.complianceService.listComments(id, caseId);
  }

  @Post(':id/compliance-cases/:caseId/evidence')
  addEvidence(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: CreateComplianceCaseEvidenceDto,
  ) {
    return this.complianceService.addEvidence(id, caseId, dto);
  }

  @Get(':id/compliance-cases/:caseId/evidence')
  listEvidence(@Param('id') id: string, @Param('caseId') caseId: string) {
    return this.complianceService.listEvidence(id, caseId);
  }

  @Post(':id/compliance-cases/:caseId/assignment')
  assignCase(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: CreateComplianceCaseAssignmentDto,
  ) {
    return this.complianceService.assignCase(id, caseId, dto);
  }

  @Get(':id/compliance-cases/:caseId/assignments')
  listAssignments(@Param('id') id: string, @Param('caseId') caseId: string) {
    return this.complianceService.listAssignments(id, caseId);
  }

  @Get(':id/compliance-cases/:caseId/history')
  listHistory(@Param('id') id: string, @Param('caseId') caseId: string) {
    return this.complianceService.listHistory(id, caseId);
  }
}
