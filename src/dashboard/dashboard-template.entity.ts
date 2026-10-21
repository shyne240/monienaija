import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01
 *
 * Layer B of the three-layer architecture (see
 * docs/V1/V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01-REPORT.md §1): a reusable dashboard
 * "shape" — a stable key, display metadata, and a widget-placement layout. Templates never
 * reference roles directly (that is Layer C, `RoleDashboardAssignment`), and never define or
 * redefine authorization functions/roles (that remains Layer A, the untouched
 * `authorization_catalogue` tables). Each `layout.widgets[].widgetKey` must exist in the static
 * `DASHBOARD_WIDGET_REGISTRY` (validated server-side by `DashboardTemplateSeedService` and by
 * `DashboardService` on every read) — never an arbitrary string trusted at render time.
 */
@Entity({ name: 'dashboard_templates' })
@Index('uq_dashboard_templates_template_key', ['templateKey'], { unique: true })
export class DashboardTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'template_key', type: 'varchar', length: 80 })
  templateKey!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  displayName!: string;

  @Column({ type: 'varchar', length: 1000 })
  description!: string;

  @Column({ name: 'operational_area', type: 'varchar', length: 80 })
  operationalArea!: string;

  /**
   * Widget placement/layout. Shape: `{ widgets: Array<{ widgetKey: string; order: number;
   * title?: string; filters?: string[] }> }`. Intentionally a simple ordered list (V1 minimum —
   * no drag-and-drop designer, no pixel-level grid coordinates).
   */
  @Column({ type: 'jsonb' })
  layout!: { widgets: Array<{ widgetKey: string; order: number; title?: string; filters?: string[] }> };

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
