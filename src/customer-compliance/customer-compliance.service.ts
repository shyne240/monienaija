import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { AuditService } from '../operations/audit.service';
import { ComplianceCaseAssignment } from './compliance-case-assignment.entity';
import { ComplianceCaseComment } from './compliance-case-comment.entity';
import { ComplianceCaseEvidence } from './compliance-case-evidence.entity';
import { ComplianceCaseHistory } from './compliance-case-history.entity';
import { CustomerComplianceCase } from './customer-compliance-case.entity';
import { ComplianceCaseHistoryAction, ComplianceCaseStatus } from './customer-compliance.enums';
import type {
  CreateComplianceCaseAssignmentCommand,
  CreateComplianceCaseCommentCommand,
  CreateComplianceCaseCommand,
  CreateComplianceCaseEvidenceCommand,
  UpdateComplianceCaseCommand,
} from './customer-compliance.types';

@Injectable()
export class CustomerComplianceService {
  constructor(
    @InjectRepository(CustomerComplianceCase)
    private readonly caseRepository: Repository<CustomerComplianceCase>,
    @InjectRepository(ComplianceCaseHistory)
    private readonly historyRepository: Repository<ComplianceCaseHistory>,
    @InjectRepository(ComplianceCaseAssignment)
    private readonly assignmentRepository: Repository<ComplianceCaseAssignment>,
    @InjectRepository(ComplianceCaseComment)
    private readonly commentRepository: Repository<ComplianceCaseComment>,
    @InjectRepository(ComplianceCaseEvidence)
    private readonly evidenceRepository: Repository<ComplianceCaseEvidence>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createCase(
    customerId: string,
    command: CreateComplianceCaseCommand,
  ): Promise<CustomerComplianceCase> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const caseNumber = this.normalizeCaseNumber(command.caseNumber);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const repository = manager.getRepository(CustomerComplianceCase);
        const existing = await repository.findOne({ where: { caseNumber }, withDeleted: true });
        if (existing) {
          throw new ConflictException(`Compliance case number ${caseNumber} already exists`);
        }
        const now = new Date();
        const complianceCase = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            caseNumber,
            category: command.category,
            severity: command.severity,
            status: ComplianceCaseStatus.OPEN,
            openedBy: actor,
            assignedTo: null,
            resolution: null,
            openedAt: now,
            closedAt: null,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_COMPLIANCE_CASE',
          complianceCase.id,
          'CREATED',
          actor,
          undefined,
          this.caseValues(complianceCase),
        );
        await this.appendHistory(
          manager,
          complianceCase,
          ComplianceCaseHistoryAction.CASE_CREATED,
          actor,
          null,
          complianceCase.status,
          null,
          null,
          null,
          null,
          {},
        );
        return complianceCase;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`Compliance case number ${caseNumber} already exists`);
      }
      throw error;
    }
  }

  async listCases(customerId: string): Promise<CustomerComplianceCase[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const cases = await this.caseRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(cases.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async getCase(customerId: string, caseId: string): Promise<CustomerComplianceCase> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    await this.requireCustomer(this.customerRepository, customerId);
    return this.requireCase(this.caseRepository, customerId, caseId);
  }

  async updateCase(
    customerId: string,
    caseId: string,
    command: UpdateComplianceCaseCommand,
  ): Promise<CustomerComplianceCase> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    const actor = this.normalizeActor(command.actor);
    const resolution =
      command.resolution === undefined
        ? undefined
        : this.normalizeOptionalText(command.resolution, 'resolution', 1000);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerComplianceCase);
      const complianceCase = await this.requireCase(repository, customerId, caseId);
      if (complianceCase.status === ComplianceCaseStatus.CLOSED) {
        throw new ConflictException('Closed compliance cases cannot be modified');
      }
      if (command.version !== undefined && command.version !== complianceCase.version) {
        throw new ConflictException('Compliance case version is stale');
      }
      const statusChanged =
        command.status !== undefined && command.status !== complianceCase.status;
      const resolutionChanged =
        resolution !== undefined && resolution !== complianceCase.resolution;
      if (!statusChanged && !resolutionChanged) {
        return complianceCase;
      }
      if (statusChanged) {
        this.assertStatusTransition(complianceCase.status, command.status as ComplianceCaseStatus);
      }
      const previousCaseValues = this.caseValues(complianceCase);
      const previousStatus = complianceCase.status;
      const previousResolution = complianceCase.resolution;
      if (command.status !== undefined) {
        complianceCase.status = command.status;
      }
      if (resolution !== undefined) {
        complianceCase.resolution = resolution;
      }
      if (command.status === ComplianceCaseStatus.CLOSED) {
        complianceCase.closedAt = new Date();
      }
      const saved = await repository.save(complianceCase);
      await this.audit(
        manager,
        'CUSTOMER_COMPLIANCE_CASE',
        saved.id,
        'UPDATED',
        actor,
        previousCaseValues,
        this.caseValues(saved),
      );
      if (statusChanged) {
        await this.appendHistory(
          manager,
          saved,
          ComplianceCaseHistoryAction.STATUS_CHANGED,
          actor,
          previousStatus,
          saved.status,
          saved.assignedTo,
          saved.assignedTo,
          previousResolution,
          saved.resolution,
          {},
        );
      }
      if (command.status === ComplianceCaseStatus.CLOSED) {
        await this.appendHistory(
          manager,
          saved,
          ComplianceCaseHistoryAction.CASE_CLOSED,
          actor,
          previousStatus,
          saved.status,
          saved.assignedTo,
          saved.assignedTo,
          previousResolution,
          saved.resolution,
          {},
        );
      }
      if (resolutionChanged) {
        await this.appendHistory(
          manager,
          saved,
          ComplianceCaseHistoryAction.RESOLUTION_UPDATED,
          actor,
          saved.status,
          saved.status,
          saved.assignedTo,
          saved.assignedTo,
          previousResolution,
          saved.resolution,
          {},
        );
      }
      return saved;
    });
  }

  async addComment(
    customerId: string,
    caseId: string,
    command: CreateComplianceCaseCommentCommand,
  ): Promise<ComplianceCaseComment> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    const actor = this.normalizeActor(command.actor);
    const commentText = this.normalizeText(command.comment, 'comment', 4000);
    return this.dataSource.transaction(async (manager) => {
      const complianceCase = await this.requireCase(
        manager.getRepository(CustomerComplianceCase),
        customerId,
        caseId,
      );
      this.assertCaseMutable(complianceCase);
      const comment = await manager.getRepository(ComplianceCaseComment).save(
        manager.getRepository(ComplianceCaseComment).create({
          id: randomUUID(),
          caseId,
          customerId,
          comment: commentText,
          actor,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'COMPLIANCE_CASE_COMMENT',
        comment.id,
        'CREATED',
        actor,
        undefined,
        this.commentValues(comment),
      );
      await this.appendHistory(
        manager,
        complianceCase,
        ComplianceCaseHistoryAction.COMMENT_ADDED,
        actor,
        complianceCase.status,
        complianceCase.status,
        complianceCase.assignedTo,
        complianceCase.assignedTo,
        complianceCase.resolution,
        complianceCase.resolution,
        { commentId: comment.id },
      );
      return comment;
    });
  }

  async listComments(customerId: string, caseId: string): Promise<ComplianceCaseComment[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireCase(this.caseRepository, customerId, caseId);
    const comments = await this.commentRepository.find({ where: { caseId, customerId } });
    return this.sortByCreatedAt(comments.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async addEvidence(
    customerId: string,
    caseId: string,
    command: CreateComplianceCaseEvidenceCommand,
  ): Promise<ComplianceCaseEvidence> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    const documentName = this.normalizeText(command.documentName, 'documentName', 200);
    const documentType = this.normalizeText(command.documentType, 'documentType', 80);
    const reference = this.normalizeText(command.reference, 'reference', 160);
    const uploadedBy = this.normalizeActor(command.uploadedBy);
    return this.dataSource.transaction(async (manager) => {
      const complianceCase = await this.requireCase(
        manager.getRepository(CustomerComplianceCase),
        customerId,
        caseId,
      );
      this.assertCaseMutable(complianceCase);
      const evidence = await manager.getRepository(ComplianceCaseEvidence).save(
        manager.getRepository(ComplianceCaseEvidence).create({
          id: randomUUID(),
          caseId,
          customerId,
          documentName,
          documentType,
          reference,
          uploadedBy,
          uploadedAt: new Date(),
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'COMPLIANCE_CASE_EVIDENCE',
        evidence.id,
        'CREATED',
        uploadedBy,
        undefined,
        this.evidenceValues(evidence),
      );
      await this.appendHistory(
        manager,
        complianceCase,
        ComplianceCaseHistoryAction.EVIDENCE_ADDED,
        uploadedBy,
        complianceCase.status,
        complianceCase.status,
        complianceCase.assignedTo,
        complianceCase.assignedTo,
        complianceCase.resolution,
        complianceCase.resolution,
        { evidenceId: evidence.id },
      );
      return evidence;
    });
  }

  async listEvidence(customerId: string, caseId: string): Promise<ComplianceCaseEvidence[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireCase(this.caseRepository, customerId, caseId);
    const evidence = await this.evidenceRepository.find({ where: { caseId, customerId } });
    return this.sortByCreatedAt(evidence.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async assignCase(
    customerId: string,
    caseId: string,
    command: CreateComplianceCaseAssignmentCommand,
  ): Promise<ComplianceCaseAssignment> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    const actor = this.normalizeActor(command.actor);
    const assignedTo = this.normalizeActor(command.assignedTo);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerComplianceCase);
      const complianceCase = await this.requireCase(repository, customerId, caseId);
      this.assertCaseMutable(complianceCase);
      const previousAssignee = complianceCase.assignedTo;
      complianceCase.assignedTo = assignedTo;
      const savedCase = await repository.save(complianceCase);
      const assignment = await manager.getRepository(ComplianceCaseAssignment).save(
        manager.getRepository(ComplianceCaseAssignment).create({
          id: randomUUID(),
          caseId,
          customerId,
          assignedTo,
          assignedBy: actor,
          assignedAt: new Date(),
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'CUSTOMER_COMPLIANCE_CASE',
        savedCase.id,
        'ASSIGNMENT_UPDATED',
        actor,
        { assignedTo: previousAssignee },
        { assignedTo: assignedTo },
      );
      await this.audit(
        manager,
        'COMPLIANCE_CASE_ASSIGNMENT',
        assignment.id,
        'CREATED',
        actor,
        undefined,
        this.assignmentValues(assignment),
      );
      await this.appendHistory(
        manager,
        savedCase,
        ComplianceCaseHistoryAction.ASSIGNMENT_CHANGED,
        actor,
        savedCase.status,
        savedCase.status,
        previousAssignee,
        assignedTo,
        savedCase.resolution,
        savedCase.resolution,
        { assignmentId: assignment.id },
      );
      return assignment;
    });
  }

  async listAssignments(customerId: string, caseId: string): Promise<ComplianceCaseAssignment[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireCase(this.caseRepository, customerId, caseId);
    const assignments = await this.assignmentRepository.find({ where: { caseId, customerId } });
    return this.sortByCreatedAt(assignments.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async listHistory(customerId: string, caseId: string): Promise<ComplianceCaseHistory[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireCase(this.caseRepository, customerId, caseId);
    const history = await this.historyRepository.find({ where: { caseId } });
    return this.sortByCreatedAt(history.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  private async requireCustomer(
    repository: Repository<Customer>,
    customerId: string,
  ): Promise<Customer> {
    const customer = await repository.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
    return customer;
  }

  private async requireCase(
    repository: Repository<CustomerComplianceCase>,
    customerId: string,
    caseId: string,
  ): Promise<CustomerComplianceCase> {
    const complianceCase = await repository.findOne({ where: { id: caseId, customerId } });
    if (!complianceCase || !this.isNotDeleted(complianceCase.deletedAt))
      throw new NotFoundException(`Compliance case ${caseId} was not found`);
    return complianceCase;
  }

  private assertCaseMutable(complianceCase: CustomerComplianceCase): void {
    if (complianceCase.status === ComplianceCaseStatus.CLOSED)
      throw new ConflictException('Closed compliance cases cannot be modified');
  }

  private assertStatusTransition(current: ComplianceCaseStatus, next: ComplianceCaseStatus): void {
    const allowed: Record<ComplianceCaseStatus, ComplianceCaseStatus[]> = {
      [ComplianceCaseStatus.OPEN]: [
        ComplianceCaseStatus.UNDER_REVIEW,
        ComplianceCaseStatus.PENDING_CUSTOMER,
        ComplianceCaseStatus.ESCALATED,
        ComplianceCaseStatus.RESOLVED,
        ComplianceCaseStatus.CLOSED,
      ],
      [ComplianceCaseStatus.UNDER_REVIEW]: [
        ComplianceCaseStatus.PENDING_CUSTOMER,
        ComplianceCaseStatus.ESCALATED,
        ComplianceCaseStatus.RESOLVED,
        ComplianceCaseStatus.CLOSED,
      ],
      [ComplianceCaseStatus.PENDING_CUSTOMER]: [
        ComplianceCaseStatus.UNDER_REVIEW,
        ComplianceCaseStatus.ESCALATED,
        ComplianceCaseStatus.RESOLVED,
        ComplianceCaseStatus.CLOSED,
      ],
      [ComplianceCaseStatus.ESCALATED]: [
        ComplianceCaseStatus.UNDER_REVIEW,
        ComplianceCaseStatus.RESOLVED,
        ComplianceCaseStatus.CLOSED,
      ],
      [ComplianceCaseStatus.RESOLVED]: [ComplianceCaseStatus.CLOSED],
      [ComplianceCaseStatus.CLOSED]: [],
    };
    if (!allowed[current].includes(next))
      throw new ConflictException(`Invalid compliance case transition from ${current} to ${next}`);
  }

  private async appendHistory(
    manager: EntityManager,
    complianceCase: CustomerComplianceCase,
    action: ComplianceCaseHistoryAction,
    actor: string,
    previousStatus: ComplianceCaseStatus | null,
    newStatus: ComplianceCaseStatus | null,
    previousAssignee: string | null,
    newAssignee: string | null,
    previousResolution: string | null,
    newResolution: string | null,
    metadata: Record<string, unknown>,
  ): Promise<ComplianceCaseHistory> {
    const history = await manager.getRepository(ComplianceCaseHistory).save(
      manager.getRepository(ComplianceCaseHistory).create({
        id: randomUUID(),
        caseId: complianceCase.id,
        action,
        previousStatus,
        newStatus,
        previousAssignee,
        newAssignee,
        previousResolution,
        newResolution,
        actor,
        metadata,
        deletedAt: null,
      }),
    );
    await this.audit(
      manager,
      'COMPLIANCE_CASE_HISTORY',
      history.id,
      'CREATED',
      actor,
      undefined,
      this.historyValues(history),
    );
    return history;
  }

  private caseValues(value: CustomerComplianceCase): Record<string, unknown> {
    return {
      customerId: value.customerId,
      caseNumber: value.caseNumber,
      category: value.category,
      severity: value.severity,
      status: value.status,
      openedBy: value.openedBy,
      assignedTo: value.assignedTo,
      resolution: value.resolution,
      openedAt: value.openedAt,
      closedAt: value.closedAt,
      version: value.version,
    };
  }

  private historyValues(value: ComplianceCaseHistory): Record<string, unknown> {
    return {
      caseId: value.caseId,
      action: value.action,
      previousStatus: value.previousStatus,
      newStatus: value.newStatus,
      previousAssignee: value.previousAssignee,
      newAssignee: value.newAssignee,
      previousResolution: value.previousResolution,
      newResolution: value.newResolution,
      actor: value.actor,
      metadata: value.metadata,
    };
  }

  private assignmentValues(value: ComplianceCaseAssignment): Record<string, unknown> {
    return {
      caseId: value.caseId,
      customerId: value.customerId,
      assignedTo: value.assignedTo,
      assignedBy: value.assignedBy,
      assignedAt: value.assignedAt,
    };
  }
  private commentValues(value: ComplianceCaseComment): Record<string, unknown> {
    return {
      caseId: value.caseId,
      customerId: value.customerId,
      actor: value.actor,
      createdAt: value.createdAt,
    };
  }
  private evidenceValues(value: ComplianceCaseEvidence): Record<string, unknown> {
    return {
      caseId: value.caseId,
      customerId: value.customerId,
      documentName: value.documentName,
      documentType: value.documentType,
      reference: value.reference,
      uploadedBy: value.uploadedBy,
      uploadedAt: value.uploadedAt,
    };
  }

  private normalizeCaseNumber(value: string): string {
    return this.normalizeSafe(value, 'caseNumber', 100);
  }
  private normalizeActor(value: string): string {
    return this.normalizeText(value, 'actor', 160);
  }
  private normalizeOptionalText(
    value: string | undefined,
    field: string,
    max: number,
  ): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    if (normalized.length > max)
      throw new BadRequestException(`${field} must contain at most ${max} characters`);
    return normalized || null;
  }
  private normalizeText(value: string, field: string, max: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > max)
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    return normalized;
  }
  private normalizeSafe(value: string, field: string, max: number): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.:-]{0,159}$/.test(normalized) || normalized.length > max)
      throw new BadRequestException(`${field} must contain 1 to ${max} safe characters`);
    return normalized;
  }
  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      throw new BadRequestException(`${field} must be a UUID`);
  }
  private isNotDeleted(value: Date | null | undefined): boolean {
    return value === null || value === undefined;
  }
  private sortByCreatedAt<T extends { createdAt: Date }>(records: T[]): T[] {
    return [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  private async audit(
    manager: EntityManager,
    entityType: string,
    entityId: string,
    action: string,
    actor: string,
    previousValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType,
      entityId,
      action,
      actor,
      previousValues,
      newValues,
    });
  }
  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }
}
