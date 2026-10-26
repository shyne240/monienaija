import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { findWidgetDefinition } from './dashboard-widget-registry';
import { DASHBOARD_TEMPLATE_SEED, ROLE_DASHBOARD_ASSIGNMENT_SEED } from './dashboard-templates.seed';
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

  async seedIfEmpty(): Promise<{ templates: number; assignments: number }> {
    const templates = await this.seedTemplates();
    const assignments = await this.seedAssignments();
    if (templates + assignments > 0) {
      this.logger.log(`Dashboard platform: inserted ${templates} template(s), ${assignments} assignment(s)`);
    }
    return { templates, assignments };
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
      const exists = await this.templateRepo.findOne({ where: { templateKey: item.templateKey } as never });
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
      const exists = await this.assignmentRepo.findOne({ where: { roleKey: item.roleKey } as never });
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
