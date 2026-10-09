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
import { AuthorizationCatalogueRuntimeService } from '../authorization-catalogue/authorization-catalogue-runtime.service';
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
// V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01: ADMINISTRATOR's OWN assignment is
// governed exactly like the three Finance roles (SUPER_ADMIN-only, first-assignment-then-maker/
// checker) — see GOVERNANCE-DECISIONS-01 Decision 2 item 5. It is deliberately NOT added to
// ADMINISTRATOR_OPERATIONAL_ROLE_KEYS below (that set is for the roles ADMINISTRATOR may in turn
// delegate, which never includes itself — no lateral self-proliferation).
const INITIAL_BOOTSTRAP_ASSIGNABLE_ROLES = new Set([
  'FINANCE_PREPARER',
  'FINANCE_CONTROLLER',
  'FINANCE_AUDITOR',
  'ADMINISTRATOR',
]);
/**
 * V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01 (GOVERNANCE-DECISIONS-01 Decision 2):
 * the exact six catalogue-only organizational roles ADMINISTRATOR (and SUPER_ADMIN, which retains
 * every capability ADMINISTRATOR has) may assign/revoke by direct EXECUTE, no second approver.
 * This list is also the DB CHECK constraint's allow-list (migration 1785753600085) — kept in sync
 * manually, since the two live in different systems (TypeScript vs. SQL) by design: the database
 * constraint is the backstop that holds even if this TypeScript list is ever wrong, not a
 * duplicate implementation of the same control. Exported so the controller can route on it
 * without hand-duplicating the set (single source of truth within the application layer).
 */
export const ADMINISTRATOR_OPERATIONAL_ROLE_KEYS: ReadonlySet<string> = new Set([
  'OPERATIONS',
  'AGENT_NETWORK_MANAGER',
  'COMPLIANCE',
  'RISK_FRAUD',
  'CUSTOMER_SERVICE',
  'TREASURY',
]);
@Injectable()
export class A2FinanceRoleAdministrationService {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly approvals: PrivilegedActionApprovalService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly config: A2WorkforceConfigurationV1,
    private readonly catalogue: AuthorizationCatalogueRuntimeService,
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
      s.initialRoleKey !== 'SUPER_ADMIN' ||
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
      if (await ar.findOne({ where: { roleKey: 'SUPER_ADMIN', status: 'ACTIVE' } }))
        throw new ConflictException('Finance bootstrap already completed');
      const ref = this.reference(s.principalId, 'SUPER_ADMIN'),
        assignment = await ar.save(
          ar.create({
            id: randomUUID(),
            assignmentReference: ref,
            assignmentVersion: 1,
            principalId: s.principalId,
            roleKey: 'SUPER_ADMIN',
            scopes: s.scopes,
            status: 'ACTIVE',
            interim: true,
            initiatedScope: 'SUPER_ADMIN_SCOPE',
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
          role: 'SUPER_ADMIN',
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
          roleKey: 'SUPER_ADMIN',
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
  /**
   * V1-ADMIN-UAT-IDENTITY-01 — LOCAL DEVELOPMENT / TEST ONLY.
   * V1-ADMIN-AUTHORIZATION-RUNTIME-01: renamed from `grantLocalAdministratorFinanceAdmin` —
   * grants SUPER_ADMIN (the functional successor of the legacy FINANCE_ADMIN role; see
   * workforce-configuration.ts) instead of FINANCE_ADMIN. Behaviour and every invariant below
   * are otherwise unchanged.
   *
   * Grants the single SUPER_ADMIN role assignment backing the local administrator seeded by
   * `scripts/local-dev-seed-admin.js`, through this service's OWN `A2FinanceRoleAssignment`
   * persistence, assignment-reference derivation, and audit trail — i.e. the SAME table and
   * SAME infrastructure every other role grant in this codebase uses. This is deliberately NOT
   * the production SUPER_ADMIN bootstrap ceremony (`consumeBootstrap()` above, which requires
   * an externally-signed, one-time JWS and remains the ONLY way a real deployment may ever
   * grant SUPER_ADMIN) — that method, and its "exactly one ACTIVE SUPER_ADMIN across the
   * whole deployment" invariant, are completely untouched by this method. Local development has
   * no external signing authority to produce that JWS, so this narrowly-scoped method exists
   * purely to let the local-admin seed script hand its one fixed administrator identity a REAL,
   * persisted, per-principal role-assignment row instead of relying on the blanket
   * config-driven `mock-sandbox-subject` grant that used to back it.
   *
   * Idempotency is keyed to the target `principalId` alone (a second call for the SAME
   * principal is a no-op returning the existing row) rather than `consumeBootstrap()`'s global
   * single-SUPER_ADMIN check — conflating the two would make the local-dev seed script fail
   * non-idempotently the moment any other principal's bootstrap-consumption test happened to
   * touch the same database, which would defeat the point of a local developer convenience.
   *
   * Hard-gated to NODE_ENV=development|test independently of (and in addition to) the identical
   * gate already enforced by every caller in `LocalAdminAuthenticationService` — this method
   * must never be reachable in a way that grants SUPER_ADMIN in production.
   */
  async grantLocalAdministratorSuperAdmin(
    principalId: string,
    assignedBy: string,
    now = new Date(),
  ): Promise<A2FinanceRoleAssignmentViewV1> {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new ForbiddenException(
        'grantLocalAdministratorSuperAdmin refuses to run outside NODE_ENV=development or NODE_ENV=test',
      );
    }
    const def = this.config.roles.find((r) => r.roleKey === 'SUPER_ADMIN' && r.enabled);
    if (!def) throw new ForbiddenException('SUPER_ADMIN role is disabled or undefined in configuration');

    const ref = this.reference(principalId, 'SUPER_ADMIN'),
      r = this.ds.getRepository(A2FinanceRoleAssignment),
      existing = await r.findOne({ where: { assignmentReference: ref, status: 'ACTIVE' } });
    if (existing) return this.view(existing, now);

    // A long-lived local-dev convenience window, not a real expiry policy — mirrors the
    // "disposable local fixture" nature of the credential this backs (see
    // docs/V1/V1-ADMIN-LOCAL-LOGIN-01.md).
    const effectiveTo = new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
    const row = await r.save(
      r.create({
        id: randomUUID(),
        assignmentReference: ref,
        assignmentVersion: 1,
        principalId,
        roleKey: 'SUPER_ADMIN',
        scopes: def.scopes,
        status: 'ACTIVE',
        interim: true,
        initiatedScope: 'SUPER_ADMIN_SCOPE',
        effectiveFrom: now,
        effectiveTo,
        assignedBy,
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        bootstrapReference: null,
        approvalIds: [],
        auditReferences: [],
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const event = await this.audit.record(this.ds.manager, {
      entityType: 'A2_FINANCE_ROLE_ASSIGNMENT',
      entityId: row.id,
      action: 'LOCAL_ADMIN_SUPER_ADMIN_GRANTED',
      actor: assignedBy,
      newValues: {
        assignmentReference: ref,
        principalId,
        roleKey: 'SUPER_ADMIN',
        scopes: def.scopes,
        effectiveFrom: now,
        effectiveTo,
      },
    });
    row.auditReferences = [event.id];
    await r.save(row);
    return this.view(row, now);
  }
  async assign(c: A2RoleAssignmentCommandV1): Promise<A2FinanceRoleAssignmentViewV1> {
    await this.validateCommand(c);
    if (c.principal.principalId === c.targetPrincipalId)
      throw new ForbiddenException('Self assignment prohibited');
    if (c.principal.assuranceLevel !== 'MFA')
      throw new ForbiddenException('Finance administration requires MFA');
    if (c.roleKey === 'SUPER_ADMIN')
      throw new ForbiddenException('SUPER_ADMIN assignment prohibited');
    // V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01: the six operational roles are
    // NEVER routed through the legacy Finance-style maker/checker path below (which stays
    // byte-for-byte unchanged for the three Finance roles and ADMINISTRATOR's own assignment) —
    // they go through the new, dedicated, database-CHECK-constrained direct-EXECUTE path.
    if (ADMINISTRATOR_OPERATIONAL_ROLE_KEYS.has(c.roleKey)) {
      return this.assignOperational(c);
    }
    const first =
      (await this.ds
        .getRepository(A2FinanceRoleAssignment)
        .count({ where: { roleKey: c.roleKey, status: 'ACTIVE' } })) === 0;
    if (first) {
      if (
        !c.principal.roles.includes('SUPER_ADMIN') ||
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
    return this.persist(c, 'FINANCE_ROLE_ASSIGN', c.approvalIds ?? [], 'SUPER_ADMIN_SCOPE');
  }
  async revoke(c: A2RoleAssignmentCommandV1) {
    await this.validateCommand(c);
    if (c.principal.principalId === c.targetPrincipalId)
      throw new ForbiddenException('Self revocation prohibited');
    if (ADMINISTRATOR_OPERATIONAL_ROLE_KEYS.has(c.roleKey)) {
      return this.revokeOperational(c);
    }
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
  /**
   * V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01 (GOVERNANCE-DECISIONS-01 Decision 2):
   * direct EXECUTE, no second human approver — the `initiated_scope = 'ADMINISTRATOR_SCOPE'` tag
   * plus the database CHECK constraint (migration 1785753600085) is the control, not a
   * maker/checker pair. `ADMINISTRATOR_OPERATIONAL_ROLE_KEYS.has(c.roleKey)` and the initiator
   * role check below are defense-in-depth at the application layer; the CHECK constraint is what
   * makes this safe even if both were ever wrong or bypassed.
   */
  private async assignOperational(
    c: A2RoleAssignmentCommandV1,
  ): Promise<A2FinanceRoleAssignmentViewV1> {
    if (!ADMINISTRATOR_OPERATIONAL_ROLE_KEYS.has(c.roleKey))
      throw new ForbiddenException('Role is not administrator-assignable');
    if (!c.principal.roles.includes('ADMINISTRATOR') && !c.principal.roles.includes('SUPER_ADMIN'))
      throw new ForbiddenException('Operational role assignment initiator denied');
    return this.persist(
      c,
      'WORKFORCE_ROLE_ASSIGN_OPERATIONAL',
      [],
      'ADMINISTRATOR_SCOPE',
    );
  }
  private async revokeOperational(c: A2RoleAssignmentCommandV1) {
    if (!ADMINISTRATOR_OPERATIONAL_ROLE_KEYS.has(c.roleKey))
      throw new ForbiddenException('Role is not administrator-assignable');
    if (!c.principal.roles.includes('ADMINISTRATOR') && !c.principal.roles.includes('SUPER_ADMIN'))
      throw new ForbiddenException('Operational role revocation initiator denied');
    const ref = this.reference(c.targetPrincipalId, c.roleKey),
      r = this.ds.getRepository(A2FinanceRoleAssignment),
      row = await r.findOne({ where: { assignmentReference: ref, status: 'ACTIVE' } });
    if (!row) throw new ConflictException('Active assignment not found');
    const now = c.now ?? new Date();
    row.status = 'REVOKED';
    row.revokedBy = c.principal.principalId;
    row.revokedAt = now;
    await r.save(row);
    await this.audit.record(this.ds.manager, {
      entityType: 'A2_FINANCE_ROLE_ASSIGNMENT',
      entityId: row.id,
      action: 'WORKFORCE_ROLE_REVOKED_OPERATIONAL',
      actor: c.principal.principalId,
      correlationId: c.correlationId,
      newValues: {
        assignmentReference: ref,
        targetPrincipalId: c.targetPrincipalId,
        roleKey: c.roleKey,
        initiatedScope: 'ADMINISTRATOR_SCOPE',
      },
    });
    return this.view(row, now);
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
  /**
   * V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01: generalized to accept an
   * `auditAction` (was hardcoded to the Finance-specific `'FINANCE_ROLE_ASSIGNED'`) and an
   * `initiatedScope` tag (new `a2_finance_role_assignments.initiated_scope` column — see
   * migration 1785753600085), so the single, unchanged insert/audit mechanics below serve both
   * the existing Finance-style path and the new ADMINISTRATOR-initiated operational path — one
   * persistence implementation, never a second one duplicated for the new path. `scopes` falls
   * back to the catalogue's function codes for the target role when it is not present in the
   * legacy `A2_FINANCE_ROLES_JSON` vocabulary (true for all six operational roles) — this is
   * informational/view-only data (see A2WorkforceSessionService.resolve(), which recomputes
   * authoritative scopes fresh at session-resolution time and never reads this column).
   */
  private async persist(
    c: A2RoleAssignmentCommandV1,
    auditAction: string,
    approvalIds: readonly string[],
    initiatedScope: 'SUPER_ADMIN_SCOPE' | 'ADMINISTRATOR_SCOPE',
  ) {
    const legacyDef = this.config.roles.find((r) => r.roleKey === c.roleKey),
      now = c.now ?? new Date(),
      ref = this.reference(c.targetPrincipalId, c.roleKey),
      r = this.ds.getRepository(A2FinanceRoleAssignment);
    if (await r.findOne({ where: { assignmentReference: ref, status: 'ACTIVE' } }))
      throw new ConflictException('Active assignment exists');
    const scopes =
      legacyDef?.scopes ?? (await this.catalogue.resolveForRoleKeys([c.roleKey])).functionCodes;
    const row = await r.save(
      r.create({
        id: randomUUID(),
        assignmentReference: ref,
        assignmentVersion: 1,
        principalId: c.targetPrincipalId,
        roleKey: c.roleKey,
        scopes,
        status: 'ACTIVE',
        interim: true,
        initiatedScope,
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
      action: auditAction,
      actor: c.principal.principalId,
      correlationId: c.correlationId,
      newValues: {
        assignmentReference: ref,
        targetPrincipalId: c.targetPrincipalId,
        roleKey: c.roleKey,
        scopes,
        initiatedScope,
        effectiveFrom: c.effectiveFrom,
        effectiveTo: c.effectiveTo,
        interim: true,
      },
    });
    row.auditReferences = [e.id];
    await r.save(row);
    return this.view(row, now);
  }
  /**
   * V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01: now async — a roleKey not present in
   * the legacy `A2_FINANCE_ROLES_JSON` vocabulary (true for all six operational roles, which
   * deliberately have no entry there — see workforce-configuration.ts) is additionally checked
   * against the authoritative catalogue (`authorization_roles`, active rows only). SUPER_ADMIN
   * remains unconditionally rejected here regardless of either source — this exact guard is what
   * `GOVERNANCE-01`/`GOVERNANCE-DECISIONS-01` both call "the single most important invariant not
   * to regress while implementing" ADMINISTRATOR's new initiator path.
   */
  private async validateCommand(c: A2RoleAssignmentCommandV1) {
    if (c.roleKey === 'SUPER_ADMIN') throw new ForbiddenException('Role not allowed');
    const legacyDef = this.config.roles.find((r) => r.roleKey === c.roleKey && r.enabled);
    if (!legacyDef) {
      const resolved = await this.catalogue.resolveForRoleKeys([c.roleKey]);
      if (!resolved.recognizedRoleKeys.includes(c.roleKey))
        throw new ForbiddenException('Role disabled or undefined');
    }
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
      initialRoleKey: p.initialRoleKey as 'SUPER_ADMIN',
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
