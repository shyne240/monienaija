#!/usr/bin/env node
/**
 * ARENA 6 — browser verification for the dashboard → workspace drill-down funnel.
 *
 * Drives the built Admin Web bundle in a real Chromium against a synthetic API, and checks the five
 * things the ARENA 6 prompt asks to be verified *in a browser*, i.e. after React has reconciled, CSS
 * has laid out, and hit-testing has happened:
 *
 *   1. a dashboard card opens the right queue (exceptions tile → notification operations, FAILED
 *      already applied as a server filter, not client-side sleight of hand);
 *   2. a failed notification can be investigated end to end (delivery row → trace across outbox
 *      event, consumer receipt, delivery outcome, provider receipts, channel availability now);
 *   3. an unavailable health source is clearly shown (per-component table with its own check times,
 *      UNAVAILABLE stated as unknown, and the operations centre naming what it could not read);
 *   4. an audit record can be traced to a known action (the delivery's correlation identifier is
 *      handed to audit search, which runs it and shows it as applied);
 *   5. a restricted role sees only what it is authorized to see — no data request is even issued for
 *      a locked tile, and no control leads to a denial.
 *
 * The API is stubbed at the browser's network layer, for the same reason ARENA 3D's harness stubs it:
 * the backend refuses to boot while `financial_dependencies_not_ready` holds, and working around that
 * would certify a configuration that cannot exist. So every assertion here is about the client —
 * including what the client chose *not* to request, which is how the authorization checks are proved.
 *
 * All data is synthetic and hard-coded below: no customer, phone number, email address or provider
 * secret appears in this file or in the evidence it writes.
 *
 * Usage (checks):
 *   ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build --outDir /tmp/arena6-dist
 *   node scripts/arena6-drilldown-browser-check.cjs --dist /tmp/arena6-dist \
 *     --out docs/integration/evidence/arena6-drilldown \
 *     --executable /tmp/chromium --lib-path /tmp/al2023/lib
 *
 * Usage (interactive preview for a human, same synthetic fixtures, no login required):
 *   node scripts/arena6-drilldown-browser-check.cjs --dist /tmp/arena6-dist --serve-only --port 4322
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function parseArgs(argv) {
  const args = { port: 4322 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'serve-only') {
      args.serveOnly = true;
      continue;
    }
    args[name] = argv[i + 1];
    i += 1;
  }
  return args;
}

/* ------------------------------------------------------------------ fixtures */

const OPERATOR_SCOPES = [
  'workforce.dashboard.view',
  'transaction.view',
  'ledger.view',
  'reconciliation.view',
  'audit.view',
  'audit.search',
  'diagnostics.view',
  'metrics.view',
  'outbox.view',
  'notification.view_deliveries',
];

/**
 * The dashboard the operations role is given. `notification-delivery-exceptions` and `audit-trail`
 * are authorized and carry their registry drill-down; `kyc-queue-summary` is placed but restricted,
 * which is the case that must render a lock and issue no request.
 */
const DASHBOARD = {
  templateKey: 'TRANSACTION_OPERATIONS',
  displayName: 'Transaction Operations',
  description: 'Synthetic acceptance template',
  isFallback: false,
  widgets: [
    {
      widgetKey: 'notification-delivery-exceptions',
      order: 1,
      displayName: 'Notification Delivery Exceptions',
      description: 'Failed, dead and outcome-unknown deliveries in the selected period.',
      fetchMode: 'proxy',
      kind: 'status-breakdown',
      authorized: true,
      requiredFunctions: ['notification.view_deliveries'],
      drilldown: { view: 'notificationOperations', label: 'Open notification operations →' },
      dataEndpoint: '/internal/a2/workforce/dashboard/widgets/notification-delivery-exceptions',
    },
    {
      widgetKey: 'audit-trail',
      order: 2,
      displayName: 'Audit Trail',
      description: 'Recent administrative actions.',
      fetchMode: 'proxy',
      kind: 'table',
      authorized: true,
      requiredFunctions: ['audit.view'],
      drilldown: { view: 'auditEvents', label: 'Open audit events →' },
      dataEndpoint: '/internal/a2/workforce/dashboard/widgets/audit-trail',
    },
    {
      widgetKey: 'kyc-queue-summary',
      order: 3,
      displayName: 'KYC Queue',
      description: 'Assessments awaiting review.',
      fetchMode: 'proxy',
      kind: 'status-breakdown',
      authorized: false,
      requiredFunctions: ['kyc.view'],
    },
  ],
};

/** The same template for the restricted principal: the exceptions card is placed but not readable. */
const DASHBOARD_RESTRICTED = {
  ...DASHBOARD,
  widgets: [
    {
      ...DASHBOARD.widgets[0],
      authorized: false,
      drilldown: undefined,
      dataEndpoint: undefined,
    },
    { ...DASHBOARD.widgets[1], authorized: false },
  ],
};

const EXCEPTIONS_WIDGET = {
  period: '7d',
  from: '2026-10-29T00:00:00.000Z',
  to: '2026-11-05T00:00:00.000Z',
  availability: 'MEASURED',
  configuration: 'CONFIGURED',
  window: { from: '2026-10-29T00:00:00.000Z', to: '2026-11-05T00:00:00.000Z' },
  totals: {
    deliveries: 12,
    exceptions: 3,
    byStatus: [
      { status: 'SENT', count: 9 },
      { status: 'FAILED', count: 2 },
      { status: 'DEAD', count: 1 },
    ],
  },
  errorCodes: [
    { errorCode: 'PROVIDER_TIMEOUT', count: 2, lastSeenAt: '2026-11-04T18:00:00.000Z' },
    { errorCode: 'SMS_OPT_OUT', count: 1, lastSeenAt: null },
  ],
  retry: {
    pending: 1,
    failedAwaitingRetry: 2,
    dead: 1,
    unknown: 0,
    oldestPendingAt: '2026-11-03T09:00:00.000Z',
    nextScheduledRetryAt: '2026-11-05T02:00:00.000Z',
    manualRetrySupported: false,
    policyReference: 'docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md',
  },
  provider: {
    availability: 'CHECKED',
    projectionScope: 'MINIMAL',
    channels: [
      { channel: 'SMS', available: true },
      { channel: 'PUSH', available: false },
    ],
  },
  definition:
    'Exception count is FAILED + DEAD + UNKNOWN deliveries created in the window, aggregated over the same read-only delivery log the notification operations workspace shows.',
  checkedAt: '2026-11-05T10:00:00.000Z',
  source: 'notification_deliveries via DashboardWidgetDataService',
};

const AUDIT_WIDGET = [
  {
    id: 'audit-1',
    entityType: 'NOTIFICATION_DELIVERY',
    action: 'notification.delivery.failed',
    actor: 'workforce:synthetic-actor',
    occurredAt: '2026-11-05T09:40:00.000Z',
    newValues: { note: 'not-rendered-by-design' },
  },
];

const NOTIFICATION_SUMMARY = {
  generatedAt: '2026-11-05T10:05:00.000Z',
  window: {
    hours: 24,
    from: '2026-11-04T10:05:00.000Z',
    to: '2026-11-05T10:05:00.000Z',
  },
  filters: { channel: null },
  totals: {
    deliveries: 40,
    byStatus: [
      { status: 'PENDING', count: 0 },
      { status: 'SENT', count: 37 },
      { status: 'FAILED', count: 2 },
      { status: 'SKIPPED', count: 0 },
      { status: 'UNKNOWN', count: 0 },
      { status: 'DEAD', count: 1 },
    ],
    byChannelAndStatus: [
      { channel: 'SMS', status: 'FAILED', count: 2 },
      { channel: 'SMS', status: 'SENT', count: 37 },
      { channel: 'PUSH', status: 'DEAD', count: 1 },
    ],
  },
  retryBacklog: {
    pending: 0,
    failedAwaitingRetry: 2,
    dead: 1,
    unknown: 0,
    oldestPendingAt: null,
    nextScheduledRetryAt: '2026-11-05T10:20:00.000Z',
  },
  failureDiagnostics: [
    { errorCode: 'ATTEMPTS_EXHAUSTED', count: 2, lastSeenAt: '2026-11-05T09:40:00.000Z' },
  ],
  outboxReceipts: [{ status: 'MATERIALIZED', count: 40 }],
  provider: {
    projectionScope: 'MINIMAL',
    channels: [
      { channel: 'SMS', available: true },
      { channel: 'PUSH', available: false },
    ],
  },
  retryPolicy: {
    manualRetrySupported: false,
    manualRetryPolicyReference: 'docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md',
    automaticRetry: { maxAttempts: 3, baseDelaySeconds: 60, visibility: 'FULL' },
  },
};

const DELIVERY_PAGE = (query) => ({
  data: [
    {
      id: 'delivery-1',
      eventType: 'transfer.completed',
      eventKey: 'transfer.completed:synthetic-req-1',
      channel: 'SMS',
      recipientType: 'CUSTOMER',
      recipientId: 'cus***01',
      status: 'FAILED',
      attempts: 2,
      errorCode: 'ATTEMPTS_EXHAUSTED',
      correlationId: 'corr-synthetic-77',
      createdAt: '2026-11-05T09:35:00.000Z',
      updatedAt: '2026-11-05T09:40:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
  // The client re-derives pagination from total/limit, so the envelope has to be arithmetically
  // consistent or the read is refused as unverifiable — which is the correct behaviour, not a bug.
  hasNextPage: false,
  accessMode: 'READ_ONLY',
  appliedFilters: { status: query.get('status') ?? null, channel: query.get('channel') ?? null },
});

const DELIVERY_DETAIL = {
  delivery: {
    id: 'delivery-1',
    eventType: 'transfer.completed',
    eventKey: 'transfer.completed:synthetic-req-1',
    aggregateType: 'TRANSFER',
    aggregateId: 'txn-synthetic-1',
    recipientType: 'CUSTOMER',
    recipientId: 'cus***01',
    channel: 'SMS',
    status: 'FAILED',
    attempts: 2,
    errorCode: 'ATTEMPTS_EXHAUSTED',
    correlationId: 'corr-synthetic-77',
    causationId: 'cause-synthetic-12',
    nextAttemptAt: '2026-11-05T10:20:00.000Z',
    sentAt: null,
    failedAt: '2026-11-05T09:40:00.000Z',
    createdAt: '2026-11-05T09:35:00.000Z',
    updatedAt: '2026-11-05T09:40:00.000Z',
  },
  attempts: [
    {
      attemptNumber: 1,
      status: 'FAILED',
      reason: 'PROVIDER_REJECTED_RETRYABLE',
      claimedAt: '2026-11-05T09:36:00.000Z',
      startedAt: '2026-11-05T09:36:01.000Z',
      finishedAt: '2026-11-05T09:36:04.000Z',
    },
    {
      attemptNumber: 2,
      status: 'FAILED',
      reason: 'ATTEMPTS_EXHAUSTED',
      claimedAt: '2026-11-05T09:39:00.000Z',
      startedAt: '2026-11-05T09:39:02.000Z',
      finishedAt: '2026-11-05T09:40:00.000Z',
    },
  ],
  idempotency: {
    eventKey: 'transfer.completed:synthetic-req-1',
    uniqueOn: 'EVENT_KEY_RECIPIENT_CHANNEL',
    materialization: 'ONE_ROW_PER_OUTBOX_EVENT_RECIPIENT_CHANNEL',
  },
  retry: {
    manualRetrySupported: false,
    manualRetryPolicyReference: 'docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md',
    automaticRetryState: 'AWAITING_AUTOMATIC_RETRY',
    automaticRetry: { maxAttempts: 3, baseDelaySeconds: 60 },
  },
  auditInspection: { entityId: 'delivery-1', correlationId: 'corr-synthetic-77' },
  provider: {
    projectionScope: 'FULL',
    channel: 'SMS',
    available: true,
    provider: 'synthetic-provider',
  },
  relatedEvent: {
    availability: 'FOUND',
    checkedAt: '2026-11-05T10:05:01.000Z',
    source: 'outbox_events + notification_outbox_receipts (consumer notification-dispatch)',
    id: 'event-synthetic-9',
    eventType: 'transfer.completed',
    status: 'PUBLISHED',
    attempts: 1,
    occurredAt: '2026-11-05T09:34:00.000Z',
    publishedAt: null,
    availableAt: '2026-11-05T09:34:30.000Z',
    eventHasError: false,
    receipt: {
      status: 'MATERIALIZED',
      reason: null,
      attempts: 1,
      nextAttemptAt: null,
      updatedAt: '2026-11-05T09:35:00.000Z',
    },
  },
  providerReceipts: {
    availability: 'AVAILABLE',
    checkedAt: '2026-11-05T10:05:02.000Z',
    source: 'notification_delivery_receipts (append-only provider receipts)',
    limit: 20,
    returned: 1,
    items: [
      {
        id: 'receipt-synthetic-3',
        kind: 'DELIVERY_STATUS',
        verification: 'SIGNED',
        providerCode: 'PROVIDER_REJECTED',
        occurredAt: '2026-11-05T09:40:00.000Z',
        receivedAt: '2026-11-05T09:40:30.000Z',
      },
    ],
  },
};

/**
 * Diagnostics with one component that could not be read at all. `workers` is UNAVAILABLE on purpose:
 * the honest rendering of that row is the thing being checked.
 */
const DIAGNOSTICS = {
  status: 'degraded',
  timestamp: '2026-11-05T10:06:00.000Z',
  database: { status: 'ok' },
  migrations: { status: 'ok', appliedCount: 42 },
  reconciliation: { status: 'WARNING' },
  pendingOutbox: 4,
  components: [
    {
      key: 'database',
      label: 'Database',
      state: 'ok',
      availability: 'CHECKED',
      meaning: 'A trivial query returned, so connections are being served.',
      detail: { reachable: true },
      checkedAt: '2026-11-05T10:06:00.100Z',
      source: 'DiagnosticsService → SELECT 1',
    },
    {
      key: 'migrations',
      label: 'Migrations',
      state: 'ok',
      availability: 'CHECKED',
      meaning: '42 migrations are recorded as applied.',
      detail: { appliedCount: 42 },
      checkedAt: '2026-11-05T10:06:00.200Z',
      source: 'DiagnosticsService → typeorm_migrations',
    },
    {
      key: 'reconciliation',
      label: 'Reconciliation',
      state: 'degraded',
      availability: 'CHECKED',
      meaning: 'The reconciliation run reported a WARNING.',
      detail: { status: 'WARNING' },
      checkedAt: '2026-11-05T10:06:00.300Z',
      source: 'ReconciliationService.runReconciliation()',
    },
    {
      key: 'outbox',
      label: 'Outbox backlog',
      state: 'degraded',
      availability: 'CHECKED',
      meaning: 'Events are waiting to be published or retried.',
      detail: { pendingOrFailed: 4 },
      checkedAt: '2026-11-05T10:06:00.400Z',
      source: 'DiagnosticsService → outbox_events',
    },
    {
      key: 'workers',
      label: 'Worker supervision',
      state: 'unknown',
      availability: 'UNAVAILABLE',
      meaning:
        'No completed tick was observed in this process, so liveness is unknown rather than absent.',
      detail: {},
      checkedAt: '2026-11-05T10:06:00.500Z',
      source: 'WorkerSupervisorService.report()',
      reason: 'no completed tick observed in this process (single-process deployment)',
    },
  ],
};

const OPERATIONS_CENTRE = {
  generatedAt: '2026-11-05T10:06:01.000Z',
  clear: false,
  partial: true,
  counts: { immediate: 1, routine: 1, info: 0 },
  scope: 'process-local sources only; multi-instance aggregates are not consulted',
  items: [
    {
      id: 'notifications:delivery-failures',
      area: 'NOTIFICATIONS',
      urgency: 'IMMEDIATE',
      severity: 'WARNING',
      summary:
        'Notification deliveries are failing and awaiting automatic retry (2 FAILED, 1 DEAD).',
      context: { failed: 2, dead: 1 },
    },
    {
      id: 'queue:outbox-backlog',
      area: 'QUEUE',
      urgency: 'ROUTINE',
      severity: 'INFO',
      summary: 'The outbox backlog is non-zero.',
      context: { pendingOrFailed: 4 },
    },
  ],
  unavailable: [
    { area: 'INTEGRITY', reason: 'integrity history could not be read' },
    { area: 'SUPERVISION', reason: 'worker supervision is process-local' },
  ],
};

const OPERATIONAL_METRICS = {
  generatedAt: '2026-11-05T10:06:02.000Z',
  unavailable: [
    { signal: 'event_loop_lag', reason: 'collector not enabled in this process' },
    { signal: 'queue_age', reason: 'no sample collected since boot' },
  ],
  samples: [{ name: 'jobs_completed', value: 128 }],
  metrics: { jobs_completed: 128, jobs_failed: 2 },
};

const METRICS = {
  metrics: {
    jobs_completed: 128,
    jobs_failed: 2,
    outbox_pending: 4,
    sessions_active: 7,
  },
  generatedAt: '2026-11-05T10:06:00.000Z',
};

const AUDIT_SEARCH_PAGE = (query) => ({
  data: [
    {
      id: 'audit-7',
      occurredAt: '2026-11-05T09:40:00.000Z',
      actor: 'worker:notification-dispatch',
      action: 'notification.delivery.failed',
      entityType: 'NOTIFICATION_DELIVERY',
      entityId: 'delivery-1',
      outcome: 'RECORDED',
      correlationId: query.get('correlationId') ?? 'corr-synthetic-77',
    },
    {
      id: 'audit-8',
      occurredAt: '2026-11-05T09:41:00.000Z',
      actor: 'worker:notification-dispatch',
      action: 'notification.delivery.retry.scheduled',
      entityType: 'NOTIFICATION_DELIVERY',
      entityId: 'delivery-1',
      outcome: 'RECORDED',
      correlationId: query.get('correlationId') ?? 'corr-synthetic-77',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  hasNextPage: false,
});

function principal(overrides) {
  return {
    type: 'PRIVILEGED',
    principalId: 'workforce:arena6-operator',
    sessionId: 'session-arena6-1',
    audience: 'admin-console',
    roles: ['OPERATIONS'],
    scopes: OPERATOR_SCOPES,
    customerAccess: 'NONE',
    assuranceLevel: 'AAL2',
    readOnlyPrincipal: false,
    ...overrides,
  };
}

function session(overrides) {
  return {
    accessToken: 'synthetic-token-not-a-credential',
    tokenType: 'Bearer',
    sessionId: 'session-arena6-1',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    principal: principal(overrides),
  };
}

/** The one router: `restricted` is the second role, everything else is the operations role. */
function handleApi(pathname, search, mode) {
  const query = new URLSearchParams(search);
  const json = (body) => ({ status: 200, body: JSON.stringify(body) });

  if (pathname.endsWith('/internal/a2/workforce/local-admin-sessions'))
    return json(session(mode === 'restricted' ? { scopes: ['workforce.dashboard.view'] } : {}));

  if (pathname.endsWith('/dashboard/my-dashboard'))
    return json(mode === 'restricted' ? DASHBOARD_RESTRICTED : DASHBOARD);

  if (pathname.endsWith('/dashboard/widgets/notification-delivery-exceptions'))
    return json(EXCEPTIONS_WIDGET);
  if (pathname.endsWith('/dashboard/widgets/audit-trail')) return json(AUDIT_WIDGET);
  if (pathname.endsWith('/dashboard/widgets/kyc-queue-summary'))
    return json({ byStatus: [{ status: 'PENDING', count: 4 }] });

  if (pathname.endsWith('/internal/notifications/operations/summary'))
    return json(NOTIFICATION_SUMMARY);
  if (pathname.match(/\/internal\/notifications\/deliveries\/[^/]+$/)) return json(DELIVERY_DETAIL);
  if (pathname.endsWith('/internal/notifications/deliveries'))
    return json(DELIVERY_PAGE(query));

  if (pathname.endsWith('/internal/operations-centre')) return json(OPERATIONS_CENTRE);
  if (pathname.endsWith('/internal/operational-metrics')) return json(OPERATIONAL_METRICS);
  if (pathname.endsWith('/internal/diagnostics')) return json(DIAGNOSTICS);
  if (pathname.endsWith('/internal/metrics')) return json(METRICS);
  if (pathname.endsWith('/internal/outbox'))
    return json({ data: [], items: [], total: 0, page: 1, limit: 20 });
  if (/\/internal\/audit\/inspection/.test(pathname))
    return json({
      data: AUDIT_SEARCH_PAGE(query).data,
      total: 2,
      page: 1,
      limit: 25,
      totalPages: 1,
      accessMode: 'READ_ONLY',
      excludedCategories: ['CUSTOMER_PREFERENCE', 'COMPLIANCE_CASE', 'PROVIDER_SECRET'],
    });
  if (/\/internal\/audit(\?|$)/.test(pathname)) return json(AUDIT_SEARCH_PAGE(query));

  // Anything else: a well-formed empty envelope, so an unstubbed read degrades visibly rather
  // than hanging a screen mid-render.
  return json({ data: [], items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
}

function createServer(dist, mode) {
  const root = path.resolve(dist);
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/v1/')) {
      const body = handleApi(url.pathname, url.search, typeof mode === 'function' ? mode() : mode);
      res.writeHead(body.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body.body);
      return;
    }
    const decoded = decodeURIComponent(url.pathname);
    const candidate = path.join(root, decoded);
    const isFile =
      candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    const target = isFile ? candidate : path.join(root, 'index.html');
    if (!fs.existsSync(target)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'Content-Length': fs.statSync(target).size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(target).pipe(res);
  });
}

/* -------------------------------------------------------------------- checks */

const text = (locator) => locator.innerText().catch(() => '');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dist = path.resolve(args.dist ?? '');
  if (!dist || !fs.existsSync(path.join(dist, 'index.html'))) {
    console.error(`no built bundle at ${dist} (run: ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build)`);
    process.exit(2);
  }
  const port = Number(args.port ?? 4322);

  let mode = 'operator';
  const server = createServer(dist, () => mode);
  await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
  const base = `http://127.0.0.1:${port}`;
  console.log(`arena6 fixture server listening on ${base} (serving ${dist})`);

  if (args.serveOnly) {
    console.log(
      'serving synthetic fixtures only — open the preview and sign in with any email/password; no data is real and nothing is written back.',
    );
    return; // keep the process alive for the live preview
  }

  const out = path.resolve(args.out ?? 'docs/integration/evidence/arena6-drilldown');
  // `--lib-path` arrives as the key 'lib-path'; the NSS/freebl objects the serverless Chromium
  // needs live beside the binary, not on the default loader path.
  const libPath = args['lib-path'] ?? args.libPath ?? process.env.BROWSER_LIBRARY_PATH;
  if (libPath) process.env.LD_LIBRARY_PATH = libPath;
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    executablePath: args.executable || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const results = [];
  const requests = [];
  const pageErrors = [];
  const record = (id, ok, detail) => {
    results.push({ id, ok, detail: String(detail).slice(0, 600) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} :: ${String(detail).slice(0, 200)}`);
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/'))
      requests.push({ method: request.method(), path: url.pathname + url.search });
  });

  const signIn = async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#admin-login-email', { timeout: 30_000 });
    await page.fill('#admin-login-email', 'operations@monienaija.local');
    await page.fill('#admin-login-password', 'synthetic-passphrase');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 30_000 });
  };

  const goTo = async (viewKey) => {
    const item = page.locator(`[data-testid="nav-${viewKey}"]`);
    if (!(await item.isVisible().catch(() => false))) {
      for (const section of ['platform', 'servicing', 'customers', 'finance']) {
        const header = page.locator(`[data-testid="section-${section}"]`);
        if (await header.count()) {
          await header.click().catch(() => {});
          if (await item.isVisible().catch(() => false)) break;
        }
      }
    }
    await item.click({ timeout: 20_000 });
    await page.waitForTimeout(400);
  };

  // --- sign in and reach the dashboard ---------------------------------------
  await signIn();
  await goTo('dashboard');
  await page.waitForSelector('[data-widget-title="Notification Delivery Exceptions"]', {
    timeout: 30_000,
  });

  const card = page.locator('[data-widget-title="Notification Delivery Exceptions"]').first();
  const cardText = (await text(card)).replace(/\s+/g, ' ');
  // Compared case-insensitively: the tile captions are uppercased by CSS, so `innerText` returns
  // "EXCEPTIONS 3" rather than the source casing.
  record(
    'CARD-SHOWS-MEASURED-EXCEPTIONS',
    /exceptions/i.test(cardText) &&
      /deliveries in window/i.test(cardText) &&
      /failed \+ dead \+ unknown/i.test(cardText),
    cardText.slice(0, 900),
  );
  record(
    'CARD-STATES-NO-MANUAL-RETRY',
    /manual retry is not part of the approved delivery policy/i.test(cardText) &&
      /V1-ADMIN-WEB-PAGE-INVENTORY/i.test(cardText),
    'policy sentence and reference rendered on the card',
  );
  const retryControls = await card.getByRole('button', { name: /retry/i }).count();
  record('CARD-OFFERS-NO-RETRY-CONTROL', retryControls === 0, `retry buttons on card=${retryControls}`);
  const restrictedCard = page.locator('[data-testid="widget-restricted"]');
  const restrictedText = await text(restrictedCard.first());
  record(
    'RESTRICTED-TILE-NAMES-THE-MISSING-FUNCTION',
    /kyc\.view/.test(restrictedText),
    restrictedText.replace(/\s+/g, ' ').slice(0, 160),
  );
  const kycReads = requests.filter((entry) => entry.path.includes('kyc-queue-summary'));
  record(
    'RESTRICTED-TILE-ISSUES-NO-READ',
    kycReads.length === 0,
    `requests for the restricted widget=${kycReads.length}`,
  );
  await page.screenshot({ path: path.join(out, '01-dashboard-exceptions-card.png') });

  // --- journey 1+2: the card opens the queue with the filter already applied --
  const beforeDrill = requests.length;
  await card.getByTestId('notification-exceptions-drilldown').click({ timeout: 20_000 });
  await page.waitForSelector('#a4-notification-status', { timeout: 30_000 });
  await page.waitForTimeout(600);
  const workspaceText = await text(page.locator('[data-testid="main-content"]').first());
  const drillReads = requests.slice(beforeDrill);
  const deliveryRead = drillReads.find((entry) =>
    entry.path.includes('/internal/notifications/deliveries?'),
  );
  record(
    'DRILLDOWN-OPENS-DELIVERY-WORKSPACE',
    /Notification operations|Delivery records/i.test(workspaceText) && Boolean(deliveryRead),
    `navigated; first delivery read = ${deliveryRead ? deliveryRead.path.slice(-70) : 'none'}`,
  );
  record(
    'DRILLDOWN-ARRIVES-with-FAILED-PREFILTER',
    Boolean(deliveryRead) && /[?&]status=FAILED(&|$)/.test(deliveryRead.path),
    deliveryRead ? decodeURIComponent(deliveryRead.path) : 'no request observed',
  );
  const statusValue = await page.locator('#a4-notification-status').inputValue().catch(() => '');
  const prefilterNote = await text(page.getByTestId('a4-prefilter-note'));
  record(
    'PREFILTER-IS-VISIBLE-AND-STATED',
    statusValue === 'FAILED' && /already applied/i.test(prefilterNote),
    `select="${statusValue}" note="${prefilterNote.replace(/\s+/g, ' ').slice(0, 120)}"`,
  );
  const providerScope = await text(page.getByTestId('a4-notification-provider-scope'));
  const summaryLine = await text(page.getByTestId('a4-summary-generated-at'));
  record(
    'WORKSPACE-STATES-WINDOW-AND-PROVIDENCE',
    /Aggregates computed/i.test(summaryLine) && /MINIMAL/.test(providerScope),
    `${summaryLine.replace(/\s+/g, ' ').slice(0, 120)} | ${providerScope}`,
  );
  await page.screenshot({ path: path.join(out, '02-notification-operations-prefiltered.png') });

  // --- journey 2b: investigate the failed delivery ---------------------------
  await page.getByRole('button', { name: 'View details' }).first().click({ timeout: 20_000 });
  await page.waitForSelector('[data-testid="a4-delivery-trace"]', { timeout: 30_000 });
  const trace = await text(page.getByTestId('a4-delivery-trace'));
  const steps = await page.locator('[data-testid="a4-delivery-trace"] > li').count();
  record(
    'TRACE-COVERS-EVERY-STORE',
    steps === 5,
    `${steps} steps: event raised → consumer receipt → delivery outcome → provider receipts → channel availability now`,
  );
  record(
    'TRACE-SHOWS-UPSTREAM-EVENT-AND-RECEIPT',
    /Outbox event event-synthetic-9/.test(trace) && /Consumer receipt MATERIALIZED/.test(trace),
    trace.replace(/\s+/g, ' ').slice(0, 180),
  );
  record(
    'TRACE-STATES-UNRECORDED-TIMES',
    /published not recorded/i.test(trace),
    'a missing timestamp prints as "not recorded", never blank',
  );
  record(
    'TRACE-SHOWS-PROVIDER-VERIFICATION',
    /verification SIGNED/.test(trace) && /PROVIDER_REJECTED/.test(trace),
    'provider receipt with its verification level and classification code',
  );
  const eachChecked = await page
    .locator('[data-testid="a4-delivery-trace"] >> text=/^Checked /')
    .count();
  record(
    'TRACE-EACH-STEP-SAYS-WHEN-AND-WHERE',
    eachChecked >= 2,
    `${eachChecked} step(s) carry a "Checked … source …" line`,
  );
  await page.screenshot({ path: path.join(out, '03-delivery-trace.png'), fullPage: true });

  // --- journey 4: trace the same record into audit --------------------------
  const auditButton = page.getByTestId('open-audit-from-delivery');
  const canTrace = (await auditButton.count()) > 0;
  const beforeAudit = requests.length;
  if (canTrace) await auditButton.click({ timeout: 20_000 });
  await page.waitForTimeout(1_200);
  const auditReads = requests.slice(beforeAudit).filter((entry) => entry.path.includes('/internal/audit'));
  const auditCorrelation =
    auditReads.find((entry) => /correlationId=/.test(entry.path))?.path ?? '';
  const auditArea = await text(page.locator('[data-testid="main-content"]').first());
  const rowsRendered = /notification\.delivery\.retry\.scheduled|audit-8/i.test(auditArea);
  record(
    'AUDIT-TRACE-RUNS-THE-CORRELATION-SEARCH',
    canTrace && /correlationId=corr-synthetic-77/.test(auditCorrelation) && rowsRendered,
    `read=${auditCorrelation.slice(-64) || 'none'} rowsShown=${rowsRendered} :: ${auditArea
      .replace(/\s+/g, ' ')
      .slice(0, 900)}`,
  );
  const correlationField = await page
    .locator('#audit-correlation')
    .first()
    .inputValue()
    .catch(() => '');
  record(
    'AUDIT-SEARCH-SHOWS-WHAT-RAN',
    correlationField.includes('corr-synthetic-77') || /corr-synthetic-77/.test(auditCorrelation),
    `field="${correlationField}" request="${auditCorrelation.slice(-60)}"`,
  );
  await page.screenshot({ path: path.join(out, '04-audit-traced-from-delivery.png'), fullPage: true });

  // --- journey 3: System Health states what it could not read ---------------
  await goTo('systemHealth');
  await page.waitForSelector('[data-testid="health-components-table"]', { timeout: 30_000 });
  const healthArea = await text(page.locator('[data-testid="main-content"]').first());
  const componentRows = await page
    .locator(
      '[data-testid^="health-component-"]:not([data-testid*="-availability"]):not([data-testid*="-checked-at"]):not([data-testid="health-components-table"])',
    )
    .count();
  const workerRow = await text(page.locator('[data-testid="health-component-workers"]'));
  record(
    'HEALTH-LISTS-COMPONENT-CHECKS',
    componentRows >= 5,
    `${componentRows} rows (database, migrations, reconciliation, outbox, workers); page begins: ${healthArea.replace(/\s+/g, ' ').slice(0, 160)}`,
  );
  record(
    'HEALTH-UNREADABLE-SOURCE-IS-UNKNOWN-NOT-OK',
    /UNAVAILABLE/.test(workerRow) && /no completed tick observed/i.test(workerRow),
    workerRow.replace(/\s+/g, ' ').slice(0, 200),
  );
  const checkedTimes = await page.locator('[data-testid^="health-component-"][data-testid$="-checked-at"]').count();
  record(
    'HEALTH-CARRIES-PER-SOURCE-TIMES',
    checkedTimes >= 5,
    `${checkedTimes} component row(s) show their own check time, separate from the report assembly time`,
  );
  const verdict = await text(page.getByTestId('health-centre-verdict'));
  const unavailable = await text(page.getByTestId('health-unavailable-sources'));
  record(
    'HEALTH-VERDICT-IS-PARTIAL-NOT-CLEAR',
    /PARTIAL/.test(verdict) && /INTEGRITY/.test(unavailable) && /event_loop_lag/.test(unavailable),
    `${verdict.replace(/\s+/g, ' ').slice(0, 90)} || ${unavailable.replace(/\s+/g, ' ').slice(0, 140)}`,
  );
  const healthDrill = await text(page.getByTestId('health-open-notification-operations'));
  record(
    'HEALTH-OFFERS-ROUTES-FOR-ITS-FINDINGS',
    /notification deliveries/i.test(healthDrill),
    healthDrill.replace(/\s+/g, ' ').slice(0, 90) || 'no cross-link offered',
  );
  await page.screenshot({ path: path.join(out, '05-system-health-components.png'), fullPage: true });

  // --- journey 5: the restricted session sees less, and asks for nothing ----
  mode = 'restricted';
  await page.evaluate(() => localStorage.clear());
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#admin-login-email', { timeout: 30_000 });
  const requestsBefore = requests.length;
  await page.fill('#admin-login-email', 'restricted@monienaija.local');
  await page.fill('#admin-login-password', 'synthetic-passphrase');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 30_000 });
  await page.waitForTimeout(800);
  const restrictedNav = {
    notificationOperations: await page
      .locator('[data-testid="nav-notificationOperations"]')
      .count(),
    systemHealth: await page.locator('[data-testid="nav-systemHealth"]').count(),
    auditEvents: await page.locator('[data-testid="nav-auditEvents"]').count(),
  };
  const restrictedRequests = requests.slice(requestsBefore);
  const leakedReads = restrictedRequests.filter((entry) =>
    /deliveries|operations|audit|diagnostics|metrics|outbox|widgets\//.test(entry.path),
  );
  const lockText = await text(page.locator('[data-testid="widget-restricted"]').first());
  const deadControls = await page
    .locator('[data-testid="notification-exceptions-drilldown"], [data-testid^="widget-drilldown"]')
    .count();
  record(
    'RESTRICTED-ROLE-LOSES-THE-OPERATIONS-ROUTES',
    restrictedNav.notificationOperations === 0 &&
      restrictedNav.systemHealth === 0 &&
      restrictedNav.auditEvents === 0,
    `nav counts: notificationOperations=${restrictedNav.notificationOperations} systemHealth=${restrictedNav.systemHealth} auditEvents=${restrictedNav.auditEvents}`,
  );
  record(
    'RESTRICTED-ROLE-ISSUES-NO-DATA-READS',
    leakedReads.length === 0,
    `${leakedReads.length} protected read(s) attempted${
      leakedReads.length ? `: ${leakedReads.map((r) => r.path).join(', ').slice(0, 200)}` : ''
    }`,
  );
  record(
    'RESTRICTED-ROLE-SEES-A-LOCK-NOT-AN-EMPTY-CARD',
    /notification\.view_deliveries/.test(lockText),
    lockText.replace(/\s+/g, ' ').slice(0, 180),
  );
  record(
    'RESTRICTED-ROLE-IS-GIVEN-NO-DEAD-CONTROLS',
    deadControls === 0,
    `drill-down controls rendered against a restricted placement=${deadControls}`,
  );
  await page.screenshot({ path: path.join(out, '06-restricted-role-dashboard.png'), fullPage: true });

  record('NO-PAGE-ERRORS', pageErrors.length === 0, pageErrors.join(' | ') || 'no uncaught errors');

  const summary = {
    generatedAt: new Date().toISOString(),
    purpose:
      'ARENA 6 browser verification: dashboard drill-down, failed-delivery investigation, health source availability, audit trace, restricted-role containment.',
    bundle: dist,
    api: {
      origin: `${base}/api/v1`,
      note: 'Stubbed at the browser network layer by this script with the synthetic fixtures defined in it; the backend refuses to boot while financial_dependencies_not_ready holds, so no assertion here is about the server.',
    },
    browser: browser.version(),
    viewport: '1440x1000',
    checks: results,
    requests,
    pageErrors,
  };
  fs.writeFileSync(path.join(out, 'arena6-drilldown-browser-acceptance.json'), JSON.stringify(summary, null, 2));
  const failures = results.filter((entry) => !entry.ok);
  console.log(
    `\n${results.length - failures.length}/${results.length} checks passed; evidence at ${out}`,
  );
  await browser.close();
  server.close();
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
