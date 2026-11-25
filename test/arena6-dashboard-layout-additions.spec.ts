import type { Repository } from 'typeorm';

import { DashboardSeedService } from '../src/dashboard/dashboard-seed.service';
import type { DashboardTemplate } from '../src/dashboard/dashboard-template.entity';
import type { RoleDashboardAssignment } from '../src/dashboard/role-dashboard-assignment.entity';
import {
  DASHBOARD_TEMPLATE_LAYOUT_ADDITIONS,
  DASHBOARD_TEMPLATE_SEED,
  ROLE_DASHBOARD_ASSIGNMENT_SEED,
} from '../src/dashboard/dashboard-templates.seed';
import {
  DASHBOARD_WIDGET_REGISTRY,
  findWidgetDefinition,
} from '../src/dashboard/dashboard-widget-registry';
import { AUTHORIZATION_ROLE_FUNCTION_SEED } from '../src/authorization-catalogue/authorization-catalogue.seed';

/**
 * ARENA 6 — the additive layout reconciliation a template already in a database receives.
 *
 * A drill-down card cannot be shipped by editing the seed alone: existing installations already have
 * template rows, and the base seed inserts only when a row is missing. `applyLayoutAdditions()` is the
 * migration-additive path, and it has to satisfy two demands that pull against each other — a card
 * must reach deployments that are already running, and an operator who removes it must keep it removed.
 * These tests pin both halves, because the first is a rollout bug and the second is a governance bug.
 *
 * The repository doubles are deliberately structural rather than `any`: every expectation below is a
 * statement about persisted shape (`layout.widgets`, `metadata.layoutAdditions`), and a fake typed as
 * `any` would let a renamed field pass while proving nothing.
 */

interface Placement {
  widgetKey: string;
  order: number;
  title?: string;
}

interface Row {
  templateKey: string;
  displayName: string;
  description: string;
  operationalArea: string;
  layout: { widgets: Placement[] };
  isActive: boolean;
  metadata: Record<string, unknown> | null;
}

interface FakeTemplateRepo {
  readonly store: Row[];
  readonly findOne: jest.Mock<Promise<Row | null>, [{ where?: { templateKey?: string } }]>;
  readonly create: jest.Mock<Row, [Partial<Row>]>;
  readonly save: jest.Mock<Promise<Row>, [Row]>;
}

const repo = (rows: Row[]): FakeTemplateRepo => {
  const store: Row[] = rows.map((row) => ({
    ...row,
    layout: { widgets: row.layout.widgets.map((widget) => ({ ...widget })) },
    metadata: row.metadata ? { ...row.metadata } : null,
  }));
  return {
    store,
    findOne: jest.fn(
      (options: { where?: { templateKey?: string } }): Promise<Row | null> =>
        Promise.resolve(
          store.find((row) => row.templateKey === options?.where?.templateKey) ?? null,
        ),
    ),
    create: jest.fn((value: Partial<Row>): Row => value as Row),
    save: jest.fn((value: Row): Promise<Row> => {
      const index = store.findIndex((row) => row.templateKey === value.templateKey);
      if (index === -1) store.push(value);
      else store[index] = value;
      return Promise.resolve(value);
    }),
  };
};

const emptyAssignmentRepo = (): Repository<RoleDashboardAssignment> =>
  ({
    findOne: jest.fn((): Promise<RoleDashboardAssignment | null> => Promise.resolve(null)),
    create: jest.fn(
      (value: Partial<RoleDashboardAssignment>): RoleDashboardAssignment =>
        value as RoleDashboardAssignment,
    ),
    save: jest.fn(
      (value: RoleDashboardAssignment): Promise<RoleDashboardAssignment> => Promise.resolve(value),
    ),
  }) as unknown as Repository<RoleDashboardAssignment>;

/** The one row a test cares about, asserted to exist so the expectations stay readable. */
const onlyRow = (store: Row[], templateKey: string): Row => {
  const row = store.find((candidate) => candidate.templateKey === templateKey);
  if (!row)
    throw new Error(`no '${templateKey}' row was persisted (store held ${store.length} rows)`);
  return row;
};

/** A deployment from *before* the card existed: the same template, without it placed. */
const preCardRow = (templateKey: string, widgetKeys: string[]): Row => ({
  templateKey,
  displayName: templateKey,
  description: 'seeded earlier',
  operationalArea: 'OPERATIONS',
  layout: {
    widgets: widgetKeys.map((widgetKey, index) => ({ widgetKey, order: index + 1 })),
  },
  isActive: true,
  metadata: null,
});

const service = (templateRepo: FakeTemplateRepo): DashboardSeedService =>
  new DashboardSeedService(
    templateRepo as unknown as Repository<DashboardTemplate>,
    emptyAssignmentRepo(),
  );

const keysOf = (row: Row | undefined): string[] =>
  (row?.layout.widgets ?? []).map((widget) => widget.widgetKey);

describe('ARENA 6 — dashboard layout additions', () => {
  it('declares an addition for every seeded template that places the card', () => {
    const added = new Set(
      DASHBOARD_TEMPLATE_LAYOUT_ADDITIONS.flatMap((entry) =>
        entry.widgets.map((widget) => `${entry.templateKey}:${widget.widgetKey}`),
      ),
    );
    for (const template of DASHBOARD_TEMPLATE_SEED) {
      for (const widget of template.widgets) {
        if (widget.widgetKey !== 'notification-delivery-exceptions') continue;
        // A template that places the card in the seed must also carry the matching addition, otherwise
        // an already-running deployment — where the base seed inserts nothing — never receives it.
        expect(added.has(`${template.templateKey}:${widget.widgetKey}`)).toBe(true);
      }
    }
  });

  it('appends a missing card to an existing template and records why', async () => {
    const row = preCardRow('EXECUTIVE_GOVERNANCE', [
      'identity-session',
      'entitlements-scopes',
      'transaction-summary',
    ]);
    const templateRepo = repo([row]);
    const result = await service(templateRepo).seedIfEmpty();

    expect(result.layoutAdditions).toBe(1);
    const rowNow = onlyRow(templateRepo.store, 'EXECUTIVE_GOVERNANCE');
    expect(keysOf(rowNow)).toEqual([
      'identity-session',
      'entitlements-scopes',
      'transaction-summary',
      'notification-delivery-exceptions',
    ]);
    // The declared order is respected, not renumbered away.
    expect(rowNow.layout.widgets.at(-1)?.order).toBe(11);
    expect(rowNow.metadata?.layoutAdditions).toEqual(['notification-delivery-exceptions']);
    expect(String(rowNow.metadata?.layoutAdditionsReason)).toMatch(/ARENA 6/);
    expect(typeof rowNow.metadata?.layoutAdditionsAt).toBe('string');
  });

  it('is idempotent: a second boot adds nothing', async () => {
    const templateRepo = repo([preCardRow('TRANSACTION_OPERATIONS', ['transaction-summary'])]);
    await service(templateRepo).seedIfEmpty();
    const afterFirst = JSON.stringify(templateRepo.store);
    expect(onlyRow(templateRepo.store, 'TRANSACTION_OPERATIONS').layout.widgets).toHaveLength(2);

    const second = await service(templateRepo).seedIfEmpty();
    expect(second.layoutAdditions).toBeUndefined();
    expect(JSON.stringify(templateRepo.store)).toBe(afterFirst);
  });

  it('leaves a deliberate removal removed, and never re-orders the surviving widgets', async () => {
    // An operator (or a later template edit) removed the card after the addition had run once.
    const removed: Row = {
      templateKey: 'FINANCIAL_AUDIT_ASSURANCE',
      displayName: 'Financial audit assurance',
      description: 'operator trimmed this layout',
      operationalArea: 'ASSURANCE',
      layout: {
        widgets: [
          { widgetKey: 'reconciliation-status', order: 1 },
          { widgetKey: 'audit-trail', order: 2 },
        ],
      },
      isActive: true,
      metadata: {
        layoutAdditions: ['notification-delivery-exceptions'],
        layoutAdditionsReason: 'ARENA 6: notification delivery exceptions',
        layoutAdditionsAt: '2026-11-05T00:00:00.000Z',
      },
    };
    const templateRepo = repo([removed]);
    const result = await service(templateRepo).seedIfEmpty();

    expect(result.layoutAdditions).toBeUndefined();
    const rowNow = onlyRow(templateRepo.store, 'FINANCIAL_AUDIT_ASSURANCE');
    expect(keysOf(rowNow)).toEqual(['reconciliation-status', 'audit-trail']);
    // The governance record survives an unrelated boot so the removal stays attributable.
    expect(rowNow.metadata?.layoutAdditions).toEqual(['notification-delivery-exceptions']);
    expect(rowNow.metadata?.layoutAdditionsAt).toBe('2026-11-05T00:00:00.000Z');
  });

  it('refuses an addition that names an unregistered widget, before touching any row', async () => {
    const row = preCardRow('A_TEMPLATE_WITH_NO_DECLARED_ADDITION', ['transaction-summary']);
    const templateRepo = repo([row]);
    const additions = DASHBOARD_TEMPLATE_LAYOUT_ADDITIONS as unknown as Array<{
      templateKey: string;
      reason: string;
      widgets: Array<{ widgetKey: string; order: number }>;
    }>;
    additions.push({
      templateKey: 'A_TEMPLATE_WITH_NO_DECLARED_ADDITION',
      reason: 'test: names a widget the registry does not know',
      widgets: [{ widgetKey: 'this-widget-does-not-exist', order: 99 }],
    });
    try {
      await expect(service(templateRepo).seedIfEmpty()).rejects.toThrow(/unknown widget/i);
    } finally {
      additions.pop();
    }
    // Fail loudly and change nothing for the row the addition targeted: an unresolvable key is a
    // programming error, so no half-applied layout may be persisted on the way out. (The base seed
    // legitimately created the other templates first — this asserts only the targeted row.)
    const targeted = templateRepo.store.find(
      (candidate: Row) => candidate.templateKey === 'A_TEMPLATE_WITH_NO_DECLARED_ADDITION',
    );
    expect(keysOf(targeted)).toEqual(['transaction-summary']);
    expect(targeted?.metadata).toBeNull();
  });

  it('patches only the templates a deployment actually has, creating nothing on the way', async () => {
    // Only one of the three templates exists in this deployment; the others are skipped, not created.
    const templateRepo = repo([preCardRow('TRANSACTION_OPERATIONS', ['recent-transactions'])]);
    const result = await service(templateRepo).seedIfEmpty();
    expect(result.layoutAdditions).toBe(1);
    const operations = templateRepo.store.find(
      (candidate: Row) => candidate.templateKey === 'TRANSACTION_OPERATIONS',
    );
    expect(keysOf(operations)).toEqual(['recent-transactions', 'notification-delivery-exceptions']);
  });

  it('keeps every seeded and added widget resolvable, so boot validation cannot regress', () => {
    const keys = new Set(DASHBOARD_WIDGET_REGISTRY.map((entry) => entry.widgetKey));
    for (const template of DASHBOARD_TEMPLATE_SEED) {
      const orders = template.widgets.map((widget) => widget.order);
      // Order numbers must stay unique per template, or the resolved layout renders two cards at once.
      expect(new Set(orders).size).toBe(orders.length);
      for (const widget of template.widgets) expect(keys.has(widget.widgetKey)).toBe(true);
    }
    for (const addition of DASHBOARD_TEMPLATE_LAYOUT_ADDITIONS) {
      const widget = addition.widgets.at(0);
      expect(widget).toBeDefined();
      if (!widget) continue;
      expect(findWidgetDefinition(widget.widgetKey)).toBeDefined();
      const template = DASHBOARD_TEMPLATE_SEED.find(
        (entry) => entry.templateKey === addition.templateKey,
      );
      expect(template).toBeDefined();
      const seeded = template?.widgets.find((entry) => entry.widgetKey === widget.widgetKey);
      // The seed placement and its additive reconciliation must agree, or the two paths disagree.
      expect(seeded?.order).toBe(widget.order);
    }
  });

  it('places the card exactly where the granted function already reaches', () => {
    const exceptions = findWidgetDefinition('notification-delivery-exceptions');
    expect(exceptions?.requiredFunctions).toEqual(['notification.view_deliveries']);

    const templatesWithCard = new Set(
      DASHBOARD_TEMPLATE_SEED.filter((template) =>
        template.widgets.some((widget) => widget.widgetKey === 'notification-delivery-exceptions'),
      ).map((template) => template.templateKey),
    );
    const holders = new Set(
      AUTHORIZATION_ROLE_FUNCTION_SEED.filter(
        (entry) => entry.functionCode === 'notification.view_deliveries',
      ).map((entry) => entry.roleKey),
    );
    for (const assignment of ROLE_DASHBOARD_ASSIGNMENT_SEED) {
      const carries = templatesWithCard.has(assignment.templateKey);
      // A card placed for a role that cannot load it renders as a permanent restriction notice; a
      // role that can read delivery exceptions but sees no card has no route into the workspace.
      expect(carries).toBe(holders.has(assignment.roleKey));
    }
    expect([...templatesWithCard].sort()).toEqual([
      'EXECUTIVE_GOVERNANCE',
      'FINANCIAL_AUDIT_ASSURANCE',
      'TRANSACTION_OPERATIONS',
    ]);
  });
});
