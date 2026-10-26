import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { AuditService } from '../operations/audit.service';
import { AuthorizationRole } from '../authorization-catalogue/authorization-role.entity';
import { DASHBOARD_WIDGET_REGISTRY, findWidgetDefinition } from './dashboard-widget-registry';
import { DashboardTemplate } from './dashboard-template.entity';
import { RoleDashboardAssignment } from './role-dashboard-assignment.entity';

export const DEFAULT_FALLBACK_TEMPLATE_KEY = 'DEFAULT_FALLBACK';

export interface ResolvedDashboard {
  templateKey: string;
  displayName: string;
  description: string;
  isFallback: boolean;
  fallbackReason?: string;
  widgets: Array<{
    widgetKey: string;
    order: number;
    title?: string;
    displayName: string;
    description: string;
    fetchMode: 'proxy' | 'direct';
    endpoint?: string;
    supportsPeriodFilter?: boolean;
    kind: string;
    authorized: boolean;
  }>;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(DashboardTemplate)
    private readonly templateRepo: Repository<DashboardTemplate>,
    @InjectRepository(RoleDashboardAssignment)
    private readonly assignmentRepo: Repository<RoleDashboardAssignment>,
    @InjectRepository(AuthorizationRole)
    private readonly roleRepo: Repository<AuthorizationRole>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async listTemplates(): Promise<DashboardTemplate[]> {
    return this.templateRepo.find({ order: { templateKey: 'ASC' } });
  }

  async getTemplate(templateKey: string): Promise<DashboardTemplate> {
    const template = await this.templateRepo.findOne({ where: { templateKey } as never });
    if (!template) {
      throw new NotFoundException(`Dashboard template '${templateKey}' not found.`);
    }
    return template;
  }

  async listAssignments(): Promise<RoleDashboardAssignment[]> {
    return this.assignmentRepo.find({ order: { roleKey: 'ASC' } });
  }

  async listEligibleRoles(): Promise<AuthorizationRole[]> {
    return this.roleRepo.find({ where: { isActive: true } as never, order: { roleKey: 'ASC' } });
  }

  /**
   * Changes (or creates) a role's dashboard template assignment. Single-actor action — see
   * docs/V1/V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01-REPORT.md §5 for the documented reasoning
   * for why this does not require independent (maker/checker) approval. Fully audited.
   */
  async assignTemplate(params: {
    roleKey: string;
    templateKey: string;
    reason?: string;
    actorPrincipalId: string;
    correlationId?: string;
  }): Promise<RoleDashboardAssignment> {
    const role = await this.roleRepo.findOne({ where: { roleKey: params.roleKey } as never });
    if (!role || !role.isActive) {
      throw new BadRequestException(`Role '${params.roleKey}' is not a known, active authorization role.`);
    }
    const template = await this.templateRepo.findOne({ where: { templateKey: params.templateKey } as never });
    if (!template || !template.isActive) {
      throw new BadRequestException(`Dashboard template '${params.templateKey}' is not a known, active template.`);
    }

    return this.dataSource.transaction(async (manager) => {
      const assignmentRepo = manager.getRepository(RoleDashboardAssignment);
      const existing = await assignmentRepo.findOne({ where: { roleKey: params.roleKey } as never });
      const previousTemplateKey = existing?.templateKey ?? null;
      const saved = await assignmentRepo.save(
        assignmentRepo.create({
          id: existing?.id,
          roleKey: params.roleKey,
          templateKey: params.templateKey,
          assignedBy: params.actorPrincipalId,
          assignedAt: new Date(),
          reason: params.reason ?? null,
        }),
      );
      await this.auditService.record(manager, {
        action: existing ? 'DASHBOARD_ASSIGNMENT_CHANGED' : 'DASHBOARD_ASSIGNMENT_CREATED',
        entityType: 'role_dashboard_assignment',
        entityId: saved.id,
        actor: params.actorPrincipalId,
        correlationId: params.correlationId,
        previousValues: previousTemplateKey ? { templateKey: previousTemplateKey } : undefined,
        newValues: { roleKey: params.roleKey, templateKey: params.templateKey, reason: params.reason ?? null },
      });
      return saved;
    });
  }

  get widgetRegistry() {
    return DASHBOARD_WIDGET_REGISTRY;
  }

  /**
   * Resolves the effective dashboard for a principal's own role set. Deterministic multi-role
   * rule: iterate `roleKeys` in the order supplied (the order the session carries them) and use
   * the FIRST role with an active assignment pointing at an active template. Falls back to
   * `DEFAULT_FALLBACK_TEMPLATE_KEY` if no role matches, the assignment is missing, or it points
   * at an inactive/unknown template — a role can never end up with zero dashboard.
   *
   * `grantedFunctionCodes` is the caller's own real catalogue function set (from
   * `principal.scopes`, resolved server-side at session time) — each widget in the returned
   * layout is annotated `authorized: true/false` so the frontend never renders (and never calls
   * the data endpoint for) a widget the caller does not actually hold the function(s) for, even
   * if the assigned template lists it.
   */
  async resolveMyDashboard(roleKeys: readonly string[], grantedFunctionCodes: readonly string[]): Promise<ResolvedDashboard> {
    let resolvedTemplate: DashboardTemplate | null = null;
    let fallbackReason: string | undefined;

    for (const roleKey of roleKeys) {
      const assignment = await this.assignmentRepo.findOne({ where: { roleKey } as never });
      if (!assignment) continue;
      const template = await this.templateRepo.findOne({ where: { templateKey: assignment.templateKey } as never });
      if (template && template.isActive) {
        resolvedTemplate = template;
        break;
      }
    }

    if (!resolvedTemplate) {
      fallbackReason =
        roleKeys.length === 0
          ? 'No recognized role held by this session.'
          : 'No active dashboard template assignment found for any held role.';
      resolvedTemplate = await this.templateRepo.findOne({ where: { templateKey: DEFAULT_FALLBACK_TEMPLATE_KEY } as never });
      if (!resolvedTemplate) {
        // Should never happen (seeded at bootstrap) — construct an in-memory, code-level minimum
        // so the dashboard can never render zero content or throw for an authenticated caller.
        return {
          templateKey: DEFAULT_FALLBACK_TEMPLATE_KEY,
          displayName: 'Default Dashboard',
          description: 'Safe minimum dashboard.',
          isFallback: true,
          fallbackReason: `${fallbackReason} (seeded fallback template itself was not found — using an in-code minimum.)`,
          widgets: [
            { widgetKey: 'identity-session', order: 0, displayName: 'Session Identity', description: '', fetchMode: 'direct', kind: 'identity', authorized: true },
            { widgetKey: 'entitlements-scopes', order: 1, displayName: 'Entitlements', description: '', fetchMode: 'direct', kind: 'entitlements', authorized: true },
          ],
        };
      }
    }

    const grantedSet = new Set(grantedFunctionCodes);
    const widgets = resolvedTemplate.layout.widgets
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((placement) => {
        const def = findWidgetDefinition(placement.widgetKey);
        if (!def) {
          return {
            widgetKey: placement.widgetKey,
            order: placement.order,
            title: placement.title,
            displayName: placement.widgetKey,
            description: 'Unknown widget (registry mismatch) — safely hidden.',
            fetchMode: 'direct' as const,
            kind: 'link',
            authorized: false,
          };
        }
        const authorized = def.requiredFunctions.every((fn) => grantedSet.has(fn));
        return {
          widgetKey: def.widgetKey,
          order: placement.order,
          title: placement.title,
          displayName: def.displayName,
          description: def.description,
          fetchMode: def.fetchMode,
          endpoint: def.endpoint,
          supportsPeriodFilter: def.supportsPeriodFilter,
          kind: def.kind,
          authorized,
        };
      });

    return {
      templateKey: resolvedTemplate.templateKey,
      displayName: resolvedTemplate.displayName,
      description: resolvedTemplate.description,
      isFallback: resolvedTemplate.templateKey === DEFAULT_FALLBACK_TEMPLATE_KEY,
      fallbackReason,
      widgets,
    };
  }
}
