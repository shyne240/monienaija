import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../operations/audit.service';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import type { AuthorizationPrincipal } from './authorization.types';
import {
  A2FinanceRoleAssignment,
  A2WorkforceBootstrapConsumption,
} from './workforce-authentication.entity';
import { A2_WORKFORCE_CONFIG } from './workforce-oidc.service';
import type {
  A2BootstrapStatementV1,
  A2FinanceRoleAssignmentViewV1,
  A2RoleAssignmentCommandV1,
  A2WorkforceConfigurationV1,
} from './workforce-authentication.types';
import { canonical, instant, parseCompactJws, sha256, text, verifyRs256 } from './workforce-crypto';
const INITIAL_BOOTSTRAP_ASSIGNABLE_ROLES = new Set([
  'FINANCE_PREPARER',
  'FINANCE_CONTROLLER',
  'FINANCE_AUDITOR',
]);
@Injectable()
export class A2FinanceRoleAdministrationService {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly approvals: PrivilegedActionApprovalService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly config: A2WorkforceConfigurationV1,
  ) {}
  async consumeBootstrap(compact: string, principal: AuthorizationPrincipal, now = new Date()) {
    if (!this.config.bootstrapEnabled) throw new ForbiddenException('Bootstrap disabled');
    if (principal.assuranceLevel !== 'MFA') throw new ForbiddenException('Bootstrap requires MFA');
    const j = parseCompactJws(compact),
      kid = String(j.header.kid),
      key = this.config.bootstrapKeys.find(
        (k) => k.kid === kid && k.environment === this.config.environment,
      );
    if (!key) throw new UnauthorizedException('Unknown bootstrap signing key');
    verifyRs256(j, key, now);
    const encoded = Buffer.from(canonical(j.payload)).toString('base64url');
    if (compact.split('.')[1] !== encoded)
      throw new UnauthorizedException('Bootstrap payload is not canonical');
    const s = this.statement(j.payload),
      statementHash = sha256(canonical(s));
    if (
      s.schemaVersion !== 1 ||
      s.environment !== this.config.environment ||
      s.audience !== this.config.bootstrapAudience ||
      s.principalId !== `${s.issuer}:${s.workforceSubject}` ||
      s.principalId !== principal.principalId ||
      s.signingKeyReference !== kid
    )
      throw new UnauthorizedException('Bootstrap identity or environment mismatch');
    if (
      s.initialRoleKey !== 'FINANCE_ADMIN' ||
      canonical([...s.scopes].sort()) !==
        canonical([...this.config.bootstrapFinanceAdminScopes].sort())
    )
      throw new ForbiddenException('Bootstrap role or scopes not allowed');
    const from = instant(s.effectiveFrom, 'effectiveFrom'),
      to = instant(s.effectiveTo, 'effectiveTo'),
      issued = instant(s.issuedAt, 'issuedAt'),
      expires = instant(s.expiresAt, 'expiresAt');
    if (to <= from || from > now || to <= now || issued > now || expires <= now)
      throw new UnauthorizedException('Bootstrap outside validity');
    return this.ds.transaction('SERIALIZABLE', async (m) => {
      const cr = m.getRepository(A2WorkforceBootstrapConsumption);
      const existing = await cr.findOne({ where: { nonce: s.nonce } });
      if (existing)
        throw new ConflictException(
          existing.statementHash === statementHash
            ? 'Bootstrap replayed'
            : 'Bootstrap nonce conflict',
        );
      const ar = m.getRepository(A2FinanceRoleAssignment);
      if (await ar.findOne({ where: { roleKey: 'FINANCE_ADMIN', status: 'ACTIVE' } }))
        throw new ConflictException('Finance bootstrap already completed');
      const ref = this.reference(s.principalId, 'FINANCE_ADMIN'),
        assignment = await ar.save(
          ar.create({
            id: randomUUID(),
            assignmentReference: ref,
            assignmentVersion: 1,
            principalId: s.principalId,
            roleKey: 'FINANCE_ADMIN',
            scopes: s.scopes,
            status: 'ACTIVE',
            interim: true,
            effectiveFrom: from,
            effectiveTo: to,
            assignedBy: `bootstrap:${s.approvalChangeReference}`,
            assignedAt: now,
            revokedBy: null,
            revokedAt: null,
            bootstrapReference: `a2-bootstrap-${statementHash.slice(0, 32)}`,
            approvalIds: [],
            auditReferences: [],
            recordVersion: 1,
            createdAt: now,
            updatedAt: now,
          }),
        );
      const event = await this.audit.record(m, {
        entityType: 'A2_FINANCE_ROLE_ASSIGNMENT',
        entityId: assignment.id,
        action: 'WORKFORCE_BOOTSTRAP_CONSUMED',
        actor: principal.principalId,
        newValues: {
          bootstrapReference: assignment.bootstrapReference,
          nonce: s.nonce,
          issuer: s.issuer,
          subject: s.workforceSubject,
          principalId: s.principalId,
          role: 'FINANCE_ADMIN',
          scopes: s.scopes,
          environment: s.environment,
          audience: s.audience,
          effectiveFrom: from,
          effectiveTo: to,
          approvalChangeReference: s.approvalChangeReference,
          signingKeyReference: s.signingKeyReference,
          kid,
        },
      });
      assignment.auditReferences = [event.id];
      await ar.save(assignment);
      await cr.save(
        cr.create({
          id: randomUUID(),
          bootstrapReference: assignment.bootstrapReference!,
          nonce: s.nonce,
          statementHash,
          principalId: s.principalId,
          roleKey: 'FINANCE_ADMIN',
          scopes: s.scopes,
          environment: s.environment,
          audience: s.audience,
          signingKeyReference: s.signingKeyReference,
          approvalChangeReference: s.approvalChangeReference,
          consumedAt: now,
          auditReference: event.id,
          createdAt: now,
        }),
      );
      return this.view(assignment, now);
    });
  }
  async assign(c: A2RoleAssignmentCommandV1): Promise<A2FinanceRoleAssignmentViewV1> {
    this.validateCommand(c);
    if (c.principal.principalId === c.targetPrincipalId)
      throw new ForbiddenException('Self assignment prohibited');
    if (c.principal.assuranceLevel !== 'MFA')
      throw new ForbiddenException('Finance administration requires MFA');
    if (c.roleKey === 'FINANCE_ADMIN')
      throw new ForbiddenException('FINANCE_ADMIN assignment prohibited');
    const first =
      (await this.ds
        .getRepository(A2FinanceRoleAssignment)
        .count({ where: { roleKey: c.roleKey, status: 'ACTIVE' } })) === 0;
    if (first) {
      if (
        !c.principal.roles.includes('FINANCE_ADMIN') ||
        !INITIAL_BOOTSTRAP_ASSIGNABLE_ROLES.has(c.roleKey)
      )
        throw new ForbiddenException('Initial Finance role assignment denied');
    } else {
      const rule = this.config.makerCheckerRules.find(
        (item) => item.action === 'FINANCE_ROLE_ASSIGN',
      );
      if (!rule?.initiatingRoles.some((role) => c.principal.roles.includes(role)))
        throw new ForbiddenException('Finance role assignment initiator denied');
      await this.consumeApprovals('FINANCE_ROLE_ASSIGN', c);
    }
    return this.persist(c, 'FINANCE_ROLE_ASSIGN', c.approvalIds ?? []);
  }
  async revoke(c: A2RoleAssignmentCommandV1) {
    this.validateCommand(c);
    if (c.principal.principalId === c.targetPrincipalId)
      throw new ForbiddenException('Self revocation prohibited');
    await this.consumeApprovals('FINANCE_ROLE_REVOKE', c);
    const ref = this.reference(c.targetPrincipalId, c.roleKey),
      r = this.ds.getRepository(A2FinanceRoleAssignment),
      row = await r.findOne({ where: { assignmentReference: ref, status: 'ACTIVE' } });
    if (!row) throw new ConflictException('Active assignment not found');
    row.status = 'REVOKED';
    row.revokedBy = c.principal.principalId;
    row.revokedAt = c.now ?? new Date();
    await r.save(row);
    return this.view(row, c.now ?? new Date());
  }
  async exportForB9() {
    const rows = await this.ds
      .getRepository(A2FinanceRoleAssignment)
      .find({ order: { principalId: 'ASC', roleKey: 'ASC', assignmentVersion: 'ASC' } });
    return {
      schemaVersion: 1,
      authority: 'A2_INTERIM',
      assignments: rows.map((r) => this.view(r, new Date(0))),
    };
  }
  fingerprint(op: 'FINANCE_ROLE_ASSIGN' | 'FINANCE_ROLE_REVOKE', c: A2RoleAssignmentCommandV1) {
    const d = this.config.roles.find((r) => r.roleKey === c.roleKey);
    return sha256(
      canonical({
        operation: op,
        assignmentReference: this.reference(c.targetPrincipalId, c.roleKey),
        targetPrincipalId: c.targetPrincipalId,
        roleKey: c.roleKey,
        scopes: d?.scopes ?? [],
        effectiveFrom: new Date(c.effectiveFrom).toISOString(),
        effectiveTo: new Date(c.effectiveTo).toISOString(),
        expectedVersion: c.expectedVersion ?? null,
        environment: this.config.environment,
      }),
    );
  }
  private async consumeApprovals(
    action: 'FINANCE_ROLE_ASSIGN' | 'FINANCE_ROLE_REVOKE',
    c: A2RoleAssignmentCommandV1,
  ) {
    const rule = this.config.makerCheckerRules.find((item) => item.action === action);
    if (!rule) throw new ForbiddenException('Role approval policy missing');
    const ids = [...new Set(c.approvalIds ?? [])];
    if (ids.length < rule.minimumApprovals) throw new ForbiddenException('Insufficient approvals');
    const approvers = new Set<string>();
    for (const approvalId of ids) {
      const result = await this.approvals.consume({
        principal: c.principal,
        approvalId,
        actionType: action,
        resource: {
          type: 'A2_FINANCE_ROLE_ASSIGNMENT',
          id: this.reference(c.targetPrincipalId, c.roleKey),
        },
        actionFingerprint: this.fingerprint(action, c),
        now: c.now,
      });
      if (!result.approved || !result.approval?.approvedBy)
        throw new ForbiddenException(`Role approval rejected: ${result.reason}`);
      approvers.add(result.approval.approvedBy);
    }
    if (approvers.size < rule.minimumApprovals)
      throw new ForbiddenException('Distinct approval count insufficient');
    if (rule.selfApprovalProhibited && approvers.has(c.principal.principalId))
      throw new ForbiddenException('Self approval prohibited');
  }
  private async persist(c: A2RoleAssignmentCommandV1, _op: string, approvalIds: readonly string[]) {
    const d = this.config.roles.find((r) => r.roleKey === c.roleKey)!,
      now = c.now ?? new Date(),
      ref = this.reference(c.targetPrincipalId, c.roleKey),
      r = this.ds.getRepository(A2FinanceRoleAssignment);
    if (await r.findOne({ where: { assignmentReference: ref, status: 'ACTIVE' } }))
      throw new ConflictException('Active assignment exists');
    const row = await r.save(
      r.create({
        id: randomUUID(),
        assignmentReference: ref,
        assignmentVersion: 1,
        principalId: c.targetPrincipalId,
        roleKey: c.roleKey,
        scopes: d.scopes,
        status: 'ACTIVE',
        interim: true,
        effectiveFrom: new Date(c.effectiveFrom),
        effectiveTo: new Date(c.effectiveTo),
        assignedBy: c.principal.principalId,
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        bootstrapReference: null,
        approvalIds,
        auditReferences: [],
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const e = await this.audit.record(this.ds.manager, {
      entityType: 'A2_FINANCE_ROLE_ASSIGNMENT',
      entityId: row.id,
      action: 'FINANCE_ROLE_ASSIGNED',
      actor: c.principal.principalId,
      correlationId: c.correlationId,
      newValues: {
        assignmentReference: ref,
        targetPrincipalId: c.targetPrincipalId,
        roleKey: c.roleKey,
        scopes: d.scopes,
        effectiveFrom: c.effectiveFrom,
        effectiveTo: c.effectiveTo,
        interim: true,
      },
    });
    row.auditReferences = [e.id];
    await r.save(row);
    return this.view(row, now);
  }
  private validateCommand(c: A2RoleAssignmentCommandV1) {
    if (c.roleKey === 'FINANCE_ADMIN') throw new ForbiddenException('Role not allowed');
    const d = this.config.roles.find((r) => r.roleKey === c.roleKey && r.enabled);
    if (!d) throw new ForbiddenException('Role disabled or undefined');
    const f = new Date(c.effectiveFrom),
      t = new Date(c.effectiveTo);
    if (!Number.isFinite(f.getTime()) || !Number.isFinite(t.getTime()) || t <= f)
      throw new ConflictException('Invalid assignment window');
  }
  private statement(p: Record<string, unknown>): A2BootstrapStatementV1 {
    return {
      schemaVersion: p.schemaVersion as 1,
      environment: text(p.environment, 'environment', 80),
      issuer: text(p.issuer, 'issuer', 2048),
      workforceSubject: text(p.workforceSubject, 'subject'),
      principalId: text(p.principalId, 'principalId', 160),
      initialRoleKey: p.initialRoleKey as 'FINANCE_ADMIN',
      scopes:
        Array.isArray(p.scopes) && p.scopes.every((x) => typeof x === 'string') ? p.scopes : [],
      effectiveFrom: text(p.effectiveFrom, 'effectiveFrom'),
      effectiveTo: text(p.effectiveTo, 'effectiveTo'),
      audience: text(p.audience, 'audience', 80),
      approvalChangeReference: text(p.approvalChangeReference, 'approvalChangeReference', 160),
      nonce: text(p.nonce, 'nonce'),
      issuedAt: text(p.issuedAt, 'issuedAt'),
      expiresAt: text(p.expiresAt, 'expiresAt'),
      signingKeyReference: text(p.signingKeyReference, 'signingKeyReference', 160),
    };
  }
  private reference(p: string, r: string) {
    return `a2-fin-role-${sha256(canonical({ principalId: p, roleKey: r, environment: this.config.environment })).slice(0, 32)}`;
  }
  private view(a: A2FinanceRoleAssignment, now: Date): A2FinanceRoleAssignmentViewV1 {
    return {
      assignmentReference: a.assignmentReference,
      assignmentVersion: a.assignmentVersion,
      principalId: a.principalId,
      roleKey: a.roleKey,
      scopes: a.scopes,
      status: a.status === 'ACTIVE' && a.effectiveTo <= now ? 'EXPIRED' : a.status,
      interim: true,
      effectiveFrom: a.effectiveFrom.toISOString(),
      effectiveTo: a.effectiveTo.toISOString(),
      assignedBy: a.assignedBy,
      assignedAt: a.assignedAt.toISOString(),
      revokedBy: a.revokedBy,
      revokedAt: a.revokedAt?.toISOString() ?? null,
      bootstrapReference: a.bootstrapReference,
      approvalIds: a.approvalIds,
      auditReferences: a.auditReferences,
    };
  }
}
