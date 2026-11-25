import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { findWidgetDefinition } from './dashboard-widget-registry';
import {
  DASHBOARD_TEMPLATE_LAYOUT_ADDITIONS,
  DASHBOARD_TEMPLATE_SEED,
  ROLE_DASHBOARD_ASSIGNMENT_SEED,
} from './dashboard-templates.seed';
import { DashboardTemplate } from './dashboard-template.entity';
import { RoleDashboardAssignment } from './role-dashboard-assignment.entity';

/**
 * Idempotent bootstrap seed for the dashboard template/assignment layer, mirroring the existing
 * `AuthorizationCatalogueSeedService` pattern (count-based, insert-missing-only, never
 * duplicates, safe to run on every boot). Validates every seeded `widgetKey` against the static
 * `DASHBOARD_WIDGET_REGISTRY` before inserting — a template referencing an unknown widget is a
 * programming error and fails startup loudly rather than silently persisting a broken layout.
 */
@Injectable()
export class DashboardSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DashboardSeedService.name);

  constructor(
    @InjectRepository(DashboardTemplate)
    private readonly templateRepo: Repository<DashboardTemplate>,
    @InjectRepository(RoleDashboardAssignment)
    private readonly assignmentRepo: Repository<RoleDashboardAssignment>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedIfEmpty();
  }

  async seedIfEmpty(): Promise<{
    templates: number;
    assignments: number;
    layoutAdditions?: number;
  }> {
    const templates = await this.seedTemplates();
    const assignments = await this.seedAssignments();
    const layoutAdditions = await this.applyLayoutAdditions();
    if (templates + assignments + layoutAdditions > 0) {
      this.logger.log(
        `Dashboard platform: inserted ${templates} template(s), ${assignments} assignment(s), reconciled ${layoutAdditions} template layout(s)`,
      );
    }
    return {
      templates,
      assignments,
      ...(layoutAdditions > 0 ? { layoutAdditions } : {}),
    };
  }

  /**
   * Applies the declared additive layout reconciliations (see
   * `DASHBOARD_TEMPLATE_LAYOUT_ADDITIONS` for why they exist and why they are append-only).
   *
   * Three guards, all so that a bootstrap never overrides a human decision: the widget must exist in
   * the registry (fail loudly, same rule as the base seed); it must not already be placed; and once a
   * key has been recorded in the template's own metadata it is never re-added, so removing a later
   * addition stays a removal.
   */
  private async applyLayoutAdditions(): Promise<number> {
    let applied = 0;
    for (const addition of DASHBOARD_TEMPLATE_LAYOUT_ADDITIONS) {
      for (const widget of addition.widgets) {
        if (!findWidgetDefinition(widget.widgetKey)) {
          throw new Error(
            `DashboardSeedService: layout addition for '${addition.templateKey}' references unknown widget '${widget.widgetKey}'.`,
          );
        }
      }
      const template = await this.templateRepo.findOne({
        where: { templateKey: addition.templateKey } as never,
      });
      // No row yet: the base seed above already contains these widgets, so there is nothing to patch.
      if (!template) continue;

      const metadata = template.metadata ?? {};
      const recorded = Array.isArray(metadata.layoutAdditions)
        ? metadata.layoutAdditions.filter((key): key is string => typeof key === 'string')
        : [];
      const placed = new Set(template.layout?.widgets?.map((widget) => widget.widgetKey) ?? []);
      const missing = addition.widgets.filter(
        (widget) => !placed.has(widget.widgetKey) && !recorded.includes(widget.widgetKey),
      );
      if (missing.length === 0) continue;

      template.layout = {
        ...template.layout,
        widgets: [...(template.layout?.widgets ?? []), ...missing],
      };
      template.metadata = {
        ...metadata,
        layoutAdditions: [...recorded, ...missing.map((widget) => widget.widgetKey)],
        layoutAdditionsReason: addition.reason,
        layoutAdditionsAt: new Date().toISOString(),
      };
      await this.templateRepo.save(template);
      applied += 1;
    }
    return applied;
  }

  private async seedTemplates(): Promise<number> {
    let inserted = 0;
    for (const item of DASHBOARD_TEMPLATE_SEED) {
      for (const widget of item.widgets) {
        if (!findWidgetDefinition(widget.widgetKey)) {
          throw new Error(
            `DashboardSeedService: template '${item.templateKey}' references unknown widget '${widget.widgetKey}' — not present in DASHBOARD_WIDGET_REGISTRY.`,
          );
        }
      }
      const exists = await this.templateRepo.findOne({
        where: { templateKey: item.templateKey } as never,
      });
      if (!exists) {
        await this.templateRepo.save(
          this.templateRepo.create({
            templateKey: item.templateKey,
            displayName: item.displayName,
            description: item.description,
            operationalArea: item.operationalArea,
            layout: { widgets: item.widgets },
            isActive: true,
            metadata: null,
          }),
        );
        inserted += 1;
      }
    }
    return inserted;
  }

  private async seedAssignments(): Promise<number> {
    let inserted = 0;
    for (const item of ROLE_DASHBOARD_ASSIGNMENT_SEED) {
      const exists = await this.assignmentRepo.findOne({
        where: { roleKey: item.roleKey } as never,
      });
      if (!exists) {
        await this.assignmentRepo.save(
          this.assignmentRepo.create({
            roleKey: item.roleKey,
            templateKey: item.templateKey,
            assignedBy: 'system-seed',
            assignedAt: new Date(),
            reason: item.reason,
          }),
        );
        inserted += 1;
      }
    }
    return inserted;
  }
}
