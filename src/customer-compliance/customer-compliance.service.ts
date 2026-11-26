import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import type { CustomerRecordScopeResolution } from '../institution/institution-workforce-scope.service';
import { AuditService } from '../operations/audit.service';
import {
  type ComplianceCaseAccess,
  FRAUD_CASE_CATEGORIES,
  NON_FRAUD_CASE_CATEGORIES,
} from './customer-compliance-access';
import { ComplianceCaseAssignment } from './compliance-case-assignment.entity';
import { ComplianceCaseComment } from './compliance-case-comment.entity';
import { ComplianceCaseEvidence } from './compliance-case-evidence.entity';
import { ComplianceCaseHistory } from './compliance-case-history.entity';
import { CustomerComplianceCase } from './customer-compliance-case.entity';
import {
  ComplianceCaseCategory,
  ComplianceCaseHistoryAction,
  ComplianceCaseSeverity,
  ComplianceCaseStatus,
} from './customer-compliance.enums';
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
    access: ComplianceCaseAccess,
  ): Promise<CustomerComplianceCase> {
    this.assertUuid(customerId, 'customerId');
    if (!this.categories(access).includes(command.category)) {
      throw new ForbiddenException('Compliance case category not authorized');
    }
    const actor = this.actorFromAccess(access);
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

  async listCases(
    customerId: string,
    access: ComplianceCaseAccess,
  ): Promise<CustomerComplianceCase[]> {
    this.assertUuid(customerId, 'customerId');
    const categories = this.categories(access);
    await this.requireCustomer(this.customerRepository, customerId);
    const cases = await this.caseRepository.find({
      where: { customerId, category: In(categories) },
    });
    return this.sortByCreatedAt(cases.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async listQueueCases(options: {
    domainScope: 'COMPLIANCE' | 'FRAUD';
    access: ComplianceCaseAccess;
    recordScope: CustomerRecordScopeResolution;
    canExecute: boolean;
    canViewCustomer: boolean;
    principalId: string;
    status?: string;
    severity?: string;
    category?: string;
    assignedTo?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const allowedCategories = this.categories(options.access).filter((cat) =>
      options.domainScope === 'FRAUD'
        ? FRAUD_CASE_CATEGORIES.includes(cat)
        : NON_FRAUD_CASE_CATEGORIES.includes(cat),
    );
    if (allowedCategories.length === 0) {
      throw new ForbiddenException('Compliance case queue category not authorized');
    }

    const baseConditions: string[] = [
      'cc.deleted_at IS NULL',
      'cu.deleted_at IS NULL',
      'cc.category = ANY($1::varchar[])',
    ];
    const baseParams: unknown[] = [allowedCategories];

    const { recordScope } = options;
    if (
      (recordScope.mode === 'EXPLICIT_INSTITUTION' ||
        recordScope.mode === 'ASSIGNED_INSTITUTIONS') &&
      recordScope.enrolmentsTablePresent
    ) {
      baseParams.push(recordScope.institutionIds);
      baseConditions.push(
        `EXISTS (SELECT 1 FROM customer_institution_enrolments cie WHERE cie.customer_id = cc.customer_id AND cie.institution_id = ANY($${baseParams.length}::uuid[]))`,
      );
    } else if (
      recordScope.mode === 'UNASSIGNED_DIRECT_ONLY' &&
      recordScope.enrolmentsTablePresent
    ) {
      baseConditions.push(
        `NOT EXISTS (SELECT 1 FROM customer_institution_enrolments cie WHERE cie.customer_id = cc.customer_id)`,
      );
    }

    const countRows = await this.dataSource.query<
      Array<{
        total: string;
        open_count: string;
        escalated_count: string;
        under_review_count: string;
        pending_customer_count: string;
        unassigned_count: string;
        critical_high_count: string;
      }>
    >(
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE cc.status = 'OPEN')::text AS open_count,
         count(*) FILTER (WHERE cc.status = 'ESCALATED')::text AS escalated_count,
         count(*) FILTER (WHERE cc.status = 'UNDER_REVIEW')::text AS under_review_count,
         count(*) FILTER (WHERE cc.status = 'PENDING_CUSTOMER')::text AS pending_customer_count,
         count(*) FILTER (WHERE cc.assigned_to IS NULL AND cc.status NOT IN ('RESOLVED', 'CLOSED'))::text AS unassigned_count,
         count(*) FILTER (WHERE cc.severity IN ('CRITICAL', 'HIGH') AND cc.status NOT IN ('RESOLVED', 'CLOSED'))::text AS critical_high_count
       FROM customer_compliance_cases cc
       JOIN customers cu ON cu.id = cc.customer_id
       WHERE ${baseConditions.join(' AND ')}`,
      baseParams,
    );

    const conditions = [...baseConditions];
    const params = [...baseParams];

    const status = options.status?.trim().toUpperCase();
    if (status && status !== 'ALL') {
      if (status === 'ACTIVE') {
        conditions.push(`cc.status NOT IN ('RESOLVED', 'CLOSED')`);
      } else if (Object.values(ComplianceCaseStatus).includes(status as ComplianceCaseStatus)) {
        params.push(status);
        conditions.push(`cc.status = $${params.length}`);
      } else {
        throw new BadRequestException('Invalid compliance case status filter');
      }
    }

    const severity = options.severity?.trim().toUpperCase();
    if (severity && severity !== 'ALL') {
      if (!Object.values(ComplianceCaseSeverity).includes(severity as ComplianceCaseSeverity)) {
        throw new BadRequestException('Invalid compliance case severity filter');
      }
      params.push(severity);
      conditions.push(`cc.severity = $${params.length}`);
    }

    const category = options.category?.trim().toUpperCase();
    if (category && category !== 'ALL') {
      if (!allowedCategories.includes(category as ComplianceCaseCategory)) {
        throw new BadRequestException('Invalid or unauthorized compliance case category filter');
      }
      params.push(category);
      conditions.push(`cc.category = $${params.length}`);
    }

    const assignedTo = options.assignedTo?.trim();
    if (assignedTo && assignedTo !== 'ALL') {
      if (assignedTo === 'UNASSIGNED') {
        conditions.push(`cc.assigned_to IS NULL`);
      } else if (assignedTo === 'ME') {
        params.push(options.principalId);
        conditions.push(`cc.assigned_to = $${params.length}`);
      } else {
        params.push(assignedTo);
        conditions.push(`cc.assigned_to = $${params.length}`);
      }
    }

    const search = options.search?.trim();
    if (search) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search)) {
        params.push(search.toLowerCase());
        const idx = params.length;
        conditions.push(`(cc.customer_id = $${idx}::uuid OR cc.id = $${idx}::uuid)`);
      } else {
        const escaped = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
        params.push(escaped);
        const idx = params.length;
        conditions.push(
          `(cc.case_number ILIKE $${idx} ESCAPE '\\' OR cu.reference ILIKE $${idx} ESCAPE '\\')`,
        );
      }
    }

    const page = Math.max(Math.trunc(Number(options.page) || 1), 1);
    const limit = Math.min(Math.max(Math.trunc(Number(options.limit) || 25), 1), 100);
    const offset = (page - 1) * limit;

    const filteredTotalRows = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count
         FROM customer_compliance_cases cc
         JOIN customers cu ON cu.id = cc.customer_id
        WHERE ${conditions.join(' AND ')}`,
      params,
    );
    const total = Number(filteredTotalRows[0]?.count ?? '0');
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    const rowParams = [...params, limit, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows = await this.dataSource.query<
      Array<{
        id: string;
        customer_id: string;
        customer_reference: string;
        display_name: string | null;
        legal_name: string | null;
        case_number: string;
        category: ComplianceCaseCategory;
        severity: ComplianceCaseSeverity;
        status: ComplianceCaseStatus;
        opened_by: string;
        assigned_to: string | null;
        resolution: string | null;
        opened_at: Date;
        closed_at: Date | null;
        version: number;
        created_at: Date;
        updated_at: Date;
      }>
    >(
      `SELECT
         cc.id,
         cc.customer_id,
         cu.reference AS customer_reference,
         cp.display_name,
         cp.legal_name,
         cc.case_number,
         cc.category,
         cc.severity,
         cc.status,
         cc.opened_by,
         cc.assigned_to,
         cc.resolution,
         cc.opened_at,
         cc.closed_at,
         cc.version,
         cc.created_at,
         cc.updated_at
       FROM customer_compliance_cases cc
       JOIN customers cu ON cu.id = cc.customer_id
       LEFT JOIN LATERAL (
         SELECT display_name, legal_name
           FROM customer_profiles p
          WHERE p.customer_id = cu.id AND p.is_active = TRUE AND p.deleted_at IS NULL
          ORDER BY p.created_at DESC LIMIT 1
       ) cp ON TRUE
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE cc.status
           WHEN 'ESCALATED' THEN 0
           WHEN 'OPEN' THEN 1
           WHEN 'UNDER_REVIEW' THEN 2
           WHEN 'PENDING_CUSTOMER' THEN 3
           WHEN 'RESOLVED' THEN 4
           ELSE 5
         END ASC,
         CASE cc.severity
           WHEN 'CRITICAL' THEN 0
           WHEN 'HIGH' THEN 1
           WHEN 'MEDIUM' THEN 2
           ELSE 3
         END ASC,
         cc.opened_at DESC,
         cc.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      rowParams,
    );

    const topCounts = countRows[0];
    return {
      items: rows.map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        customerReference: row.customer_reference,
        customerDisplayName: options.canViewCustomer
          ? (row.display_name ?? row.legal_name ?? null)
          : null,
        caseNumber: row.case_number,
        category: row.category,
        severity: row.severity,
        status: row.status,
        openedBy: row.opened_by,
        assignedTo: row.assigned_to,
        resolution: row.resolution,
        openedAt: row.opened_at.toISOString(),
        closedAt: row.closed_at?.toISOString() ?? null,
        version: row.version,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      counts: {
        total: Number(topCounts?.total ?? '0'),
        open: Number(topCounts?.open_count ?? '0'),
        escalated: Number(topCounts?.escalated_count ?? '0'),
        underReview: Number(topCounts?.under_review_count ?? '0'),
        pendingCustomer: Number(topCounts?.pending_customer_count ?? '0'),
        unassigned: Number(topCounts?.unassigned_count ?? '0'),
        criticalOrHigh: Number(topCounts?.critical_high_count ?? '0'),
      },
      capabilities: {
        canExecute: options.canExecute,
        canViewCustomer: options.canViewCustomer,
        scopeMode: recordScope.mode,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  /** Internal policy evaluation needs the complete evidence set; this is not an HTTP case API. */
  async listCasesForPolicyEvidence(customerId: string): Promise<CustomerComplianceCase[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const cases = await this.caseRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(cases.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async getCase(
    customerId: string,
    caseId: string,
    access: ComplianceCaseAccess,
  ): Promise<CustomerComplianceCase> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    await this.requireCustomer(this.customerRepository, customerId);
    return this.requireCase(this.caseRepository, customerId, caseId, access);
  }

  async updateCase(
    customerId: string,
    caseId: string,
    command: UpdateComplianceCaseCommand,
    access: ComplianceCaseAccess,
  ): Promise<CustomerComplianceCase> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    const actor = this.actorFromAccess(access);
    const resolution =
      command.resolution === undefined
        ? undefined
        : this.normalizeOptionalText(command.resolution, 'resolution', 1000);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerComplianceCase);
      const complianceCase = await this.requireCase(
        repository,
        customerId,
        caseId,
        access,
        'pessimistic_write',
      );
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
    access: ComplianceCaseAccess,
  ): Promise<ComplianceCaseComment> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    const actor = this.actorFromAccess(access);
    const commentText = this.normalizeText(command.comment, 'comment', 4000);
    return this.dataSource.transaction(async (manager) => {
      const complianceCase = await this.requireCase(
        manager.getRepository(CustomerComplianceCase),
        customerId,
        caseId,
        access,
        'pessimistic_write',
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

  async listComments(
    customerId: string,
    caseId: string,
    access: ComplianceCaseAccess,
  ): Promise<ComplianceCaseComment[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      await this.requireCase(
        manager.getRepository(CustomerComplianceCase),
        customerId,
        caseId,
        access,
        'pessimistic_read',
      );
      const comments = await manager
        .getRepository(ComplianceCaseComment)
        .find({ where: { caseId, customerId } });
      return this.sortByCreatedAt(comments.filter((entry) => this.isNotDeleted(entry.deletedAt)));
    });
  }

  async addEvidence(
    customerId: string,
    caseId: string,
    command: CreateComplianceCaseEvidenceCommand,
    access: ComplianceCaseAccess,
  ): Promise<ComplianceCaseEvidence> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    const documentName = this.normalizeText(command.documentName, 'documentName', 200);
    const documentType = this.normalizeText(command.documentType, 'documentType', 80);
    const reference = this.normalizeText(command.reference, 'reference', 160);
    const uploadedBy = this.actorFromAccess(access);
    return this.dataSource.transaction(async (manager) => {
      const complianceCase = await this.requireCase(
        manager.getRepository(CustomerComplianceCase),
        customerId,
        caseId,
        access,
        'pessimistic_write',
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

  async listEvidence(
    customerId: string,
    caseId: string,
    access: ComplianceCaseAccess,
  ): Promise<ComplianceCaseEvidence[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      await this.requireCase(
        manager.getRepository(CustomerComplianceCase),
        customerId,
        caseId,
        access,
        'pessimistic_read',
      );
      const evidence = await manager
        .getRepository(ComplianceCaseEvidence)
        .find({ where: { caseId, customerId } });
      return this.sortByCreatedAt(evidence.filter((entry) => this.isNotDeleted(entry.deletedAt)));
    });
  }

  async assignCase(
    customerId: string,
    caseId: string,
    command: CreateComplianceCaseAssignmentCommand,
    access: ComplianceCaseAccess,
  ): Promise<ComplianceCaseAssignment> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    const actor = this.actorFromAccess(access);
    const assignedTo = this.normalizeActor(command.assignedTo);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerComplianceCase);
      const complianceCase = await this.requireCase(
        repository,
        customerId,
        caseId,
        access,
        'pessimistic_write',
      );
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

  async listAssignments(
    customerId: string,
    caseId: string,
    access: ComplianceCaseAccess,
  ): Promise<ComplianceCaseAssignment[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      await this.requireCase(
        manager.getRepository(CustomerComplianceCase),
        customerId,
        caseId,
        access,
        'pessimistic_read',
      );
      const assignments = await manager
        .getRepository(ComplianceCaseAssignment)
        .find({ where: { caseId, customerId } });
      return this.sortByCreatedAt(
        assignments.filter((entry) => this.isNotDeleted(entry.deletedAt)),
      );
    });
  }

  async listHistory(
    customerId: string,
    caseId: string,
    access: ComplianceCaseAccess,
  ): Promise<ComplianceCaseHistory[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(caseId, 'caseId');
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      await this.requireCase(
        manager.getRepository(CustomerComplianceCase),
        customerId,
        caseId,
        access,
        'pessimistic_read',
      );
      const history = await manager
        .getRepository(ComplianceCaseHistory)
        .find({ where: { caseId } });
      return this.sortByCreatedAt(history.filter((entry) => this.isNotDeleted(entry.deletedAt)));
    });
  }

  private async requireCustomer(
    repository: Repository<Customer>,
    customerId: string,
  ): Promise<Customer> {
    const customer = await repository.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
    return customer;
  }

  private actorFromAccess(access: ComplianceCaseAccess): string {
    // Fail closed at the service boundary too, even if an internal caller omitted the guard context.
    this.categories(access);
    return this.normalizeActor(access.actor);
  }

  private categories(access: ComplianceCaseAccess): ComplianceCaseCategory[] {
    if (
      !access ||
      typeof access.actor !== 'string' ||
      !access.actor.trim() ||
      !Array.isArray(access.categories) ||
      access.categories.length === 0
    ) {
      throw new ForbiddenException('Compliance case access required');
    }
    const valid = new Set<string>(Object.values(ComplianceCaseCategory));
    const result: ComplianceCaseCategory[] = [];
    for (const category of access.categories as unknown[]) {
      if (typeof category !== 'string' || !valid.has(category)) {
        throw new ForbiddenException('Invalid compliance case access');
      }
      result.push(category as ComplianceCaseCategory);
    }
    return result;
  }

  private async requireCase(
    repository: Repository<CustomerComplianceCase>,
    customerId: string,
    caseId: string,
    access: ComplianceCaseAccess,
    lock?: 'pessimistic_read' | 'pessimistic_write',
  ): Promise<CustomerComplianceCase> {
    const complianceCase = await repository.findOne({
      where: { id: caseId, customerId, category: In(this.categories(access)) },
      ...(lock ? { lock: { mode: lock } } : {}),
    });
    // Wrong customer, hidden category and nonexistent case are indistinguishable.
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
