#!/usr/bin/env node
'use strict';

/**
 * Disposable-local "Agent network & institutions" demo fixture.
 *
 * WHY THIS EXISTS
 *   A freshly migrated development database is business-empty: no Agent classes, no Agents, no
 *   limit profiles/assignments, no fee or commission rules and no institutions. Every screen in the
 *   Agents and Institutions consoles is therefore reduced to an empty state, and an operator cannot
 *   tell "nothing is configured yet" apart from "the console is broken". This script inserts a
 *   small, self-consistent slice of configuration so those screens can be exercised end to end —
 *   including the two states that matter most for the class lifecycle: an Agent whose class grants
 *   `AGENT_FUNDING` and one whose class does not.
 *
 * WHAT IT WRITES (all idempotent — re-running it changes nothing that already exists)
 *   1. Two ACTIVE Agent classes with DIFFERENT `applicable_services`
 *        ORDINARY_L1  — cash-in/out, cash-to-cash, wallet transfer, agent funding/defunding
 *        FUNDING_ONLY — the same without AGENT_FUNDING/AGENT_DEFUNDING
 *   2. Two ACTIVE Agents, one per class, created through the real application → activation path so
 *      `origin_application_id` and the `CREATED_PENDING` audit evidence are genuine.
 *   3. AGENT-class and AGENT-scoped limit profiles + assignments + rules, so the limits view has
 *      something real to resolve.
 *   4. One fee rule and one commission rule for the funded products.
 *   5. Three financial institutions: APPROVED (registered → evidence → approval consumed),
 *      EVIDENCE_SUBMITTED and REGISTERED (no authority), so the console's registration · evidence ·
 *      approval guidance can be walked through rather than imagined.
 *
 * DELIBERATELY NOT WRITTEN
 *   Nothing touches `agents.agent_class_id` for an existing Agent, no approval is approved without
 *   the checker evidence it would need in production, and no ledger/journal/wallet row is created.
 *   Institutions reach APPROVED the way production does — through a CONSUMED checker approval whose
 *   maker is a different principal — not by setting `status='APPROVED'` behind the service.
 */

const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

function loadApplicationModule(relativePath) {
  const compiled = path.join(__dirname, '..', 'dist', `${relativePath}.js`);
  if (fs.existsSync(compiled)) return require(compiled);
  if (!require.extensions['.ts']) {
    require('ts-node').register({
      transpileOnly: true,
      compilerOptions: { module: 'commonjs', target: 'ES2023' },
    });
  }
  return require(path.join(__dirname, '..', 'src', relativePath));
}

const CLASS_ORDINARY = {
  reference: 'DEMO-AGENT-CLASS-ORDINARY',
  code: 'DEMO_ORDINARY_L1',
  name: 'Demo Ordinary Agent (Level 1)',
  description:
    'Demo fixture: cash-in, cash-out, cash-to-cash, wallet transfer and both funding directions.',
  applicableServices: [
    'CASH_IN',
    'CASH_OUT',
    'CASH_TO_CASH',
    'WALLET_TRANSFER',
    'AGENT_FUNDING',
    'AGENT_DEFUNDING',
  ],
  requiredInformation: ['bvn', 'principalContactName'],
  requiredDocumentCategories: ['UTILITY_BILL'],
};

const CLASS_NO_FUNDING = {
  reference: 'DEMO-AGENT-CLASS-NO-FUNDING',
  code: 'DEMO_NO_FUNDING_L1',
  name: 'Demo Cash-Out Agent (no Agent Funding)',
  description:
    'Demo fixture: identical cash services but WITHOUT agent funding/defunding, so a class switch between the two has a real, visible impact.',
  applicableServices: ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'WALLET_TRANSFER'],
  requiredInformation: ['bvn'],
  requiredDocumentCategories: ['UTILITY_BILL'],
};

const LIMIT_PROFILES = [
  {
    code: 'DEMO_AGENT_CLASS_ORDINARY',
    name: 'Demo Ordinary Agent class limits',
    kind: 'AGENT',
    // Products are the LIMIT-ENFORCEMENT vocabulary (see AGENT_PRODUCTS in
    // src/agent/agent-limit-view.service.ts), i.e. the `products` catalogue codes — not the
    // AgentService names used for class capabilities.
    rules: [
      { product: 'CASH_TO_WALLET', direction: 'OUTGOING', dimension: 'DAILY_AMOUNT', minor: 5000000 },
      { product: 'WALLET_TO_CASH', direction: 'INCOMING', dimension: 'DAILY_AMOUNT', minor: 5000000 },
      { product: 'CASH_TO_CASH', direction: 'OUTGOING', dimension: 'DAILY_AMOUNT', minor: 2000000 },
      { product: 'CASH_TO_WALLET', direction: 'OUTGOING', dimension: 'DAILY_COUNT', count: 200 },
      { product: 'WALLET_TRANSFER', direction: 'OUTGOING', dimension: 'DAILY_AMOUNT', minor: 3000000 },
    ],
  },
  {
    code: 'DEMO_AGENT_CLASS_NO_FUNDING',
    name: 'Demo cash-out-only Agent class limits',
    kind: 'AGENT',
    rules: [
      { product: 'CASH_TO_WALLET', direction: 'OUTGOING', dimension: 'DAILY_AMOUNT', minor: 1000000 },
      { product: 'WALLET_TO_CASH', direction: 'INCOMING', dimension: 'DAILY_AMOUNT', minor: 1000000 },
    ],
  },
];

function assertSafe(databaseUrl) {
  if (!['development', 'test'].includes(process.env.NODE_ENV))
    throw new Error('Refusing outside NODE_ENV=development or test');
  if (process.env.LOCAL_DEV_SEED_CONFIRM !== 'disposable-local-database')
    throw new Error(
      'Set LOCAL_DEV_SEED_CONFIRM=disposable-local-database only after confirming this is a disposable local database',
    );
  const host = (process.env.DB_HOST || '').trim().toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw new Error('Refusing a non-loopback database host');
  if (
    process.env.NOTIFICATION_WORKER_ENABLED !== 'false' ||
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED !== 'false'
  )
    throw new Error('Both notification and cash-to-cash expiry workers must be explicitly disabled');
  return databaseUrl;
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = loadApplicationModule('app.module');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const report = [];
  try {
    // Real services, real transactions, real audit rows — the same classes the HTTP surface uses.
    // Only the request-authorization step is skipped, because a trusted in-process script has no
    // workforce session (identical rationale to scripts/local-dev-create-agent.js).
    const classService = app.get(loadApplicationModule('agent/agent-class.service').AgentClassService);
    const applicationService = app.get(
      loadApplicationModule('agent/agent-application.service').AgentApplicationService,
    );
    const lifecycleService = app.get(
      loadApplicationModule('agent/agent-lifecycle.service').AgentLifecycleService,
    );
    const institutions = app.get(
      loadApplicationModule('institution/financial-institution.service').FinancialInstitutionService,
    );
    const { DataSource } = require('typeorm');
    const dataSource = app.get(DataSource);
    assertSafe(dataSource.options);

    const classes = {};
    for (const definition of [CLASS_ORDINARY, CLASS_NO_FUNDING]) {
      classes[definition.code] = await ensureClass(classService, definition, report);
    }
    report.push(
      `Agent classes: ${Object.values(classes)
        .map((cls) => `${cls.code} (${cls.applicableServices.length} services)`)
        .join(', ')}`,
    );

    await seedLimitCatalogue(dataSource, classes, report);
    await seedCommercialRules(dataSource, report);
    await seedAgents({ applicationService, lifecycleService }, dataSource, classes, report);
    await seedInstitutions(app, institutions, dataSource, report);
  } finally {
    await app.close().catch(() => undefined);
  }
  process.stdout.write(`\n${report.map((line) => `  • ${line}`).join('\n')}\n\n`);
}

async function ensureClass(classService, definition, report) {
  const existing = await classService.list();
  const found = existing.find((cls) => cls.code === definition.code && cls.deletedAt === null);
  if (found) {
    report.push(`Agent class ${definition.code} already present (unchanged)`);
    return found;
  }
  const created = await classService.create({
    reference: definition.reference,
    code: definition.code,
    name: definition.name,
    description: definition.description,
    isActive: true,
    applicableServices: definition.applicableServices,
    applicableLimits: {
      note: 'Demo fixture: limits are enforced from limit_assignments, not from this JSON blob.',
    },
    requiredInformation: definition.requiredInformation,
    requiredDocumentCategories: definition.requiredDocumentCategories,
    actor: 'demo-seed',
  });
  report.push(`Agent class ${created.code} created`);
  return created;
}

async function seedLimitCatalogue(dataSource, classes, report) {
  const productCodes = (
    await dataSource.query(`SELECT code FROM products WHERE deleted_at IS NULL`)
  ).map((row) => row.code);
  for (const profile of LIMIT_PROFILES) {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by)
       VALUES ($1,$2,$3,'ACTIVE',TRUE,'CONFIGURED','demo-seed')
       ON CONFLICT (code) DO NOTHING`,
      [profile.code, profile.name, profile.kind],
    );
    for (const rule of profile.rules) {
      if (productCodes.length > 0 && !productCodes.includes(rule.product)) {
        report.push(`Limit rule skipped: product ${rule.product} is not in the catalogue`);
        continue;
      }
      const isCount = rule.dimension.endsWith('_COUNT');
      await dataSource.query(
        `INSERT INTO limit_rules
           (limit_profile_code, product, direction, currency, dimension,
            limit_value_minor, limit_value_count, is_active, priority, created_by)
         SELECT $1::varchar,$2::varchar,$3::varchar,'NGN',$4::varchar,$5::bigint,$6::integer,TRUE,0,'demo-seed'
          WHERE NOT EXISTS (
            SELECT 1 FROM limit_rules
             WHERE limit_profile_code=$1::varchar AND product=$2::varchar
               AND direction IS NOT DISTINCT FROM $3::varchar
               AND dimension=$4::varchar AND deleted_at IS NULL
          )`,
        [
          profile.code,
          rule.product,
          rule.direction,
          rule.dimension,
          isCount ? null : String(rule.minor ?? 0),
          isCount ? (rule.count ?? 0) : null,
        ],
      );
    }
  }

  const assignments = [
    { profile: LIMIT_PROFILES[0].code, subjectType: 'AGENT_CLASS', subjectId: classes[CLASS_ORDINARY.code].id },
    {
      profile: LIMIT_PROFILES[1].code,
      subjectType: 'AGENT_CLASS',
      subjectId: classes[CLASS_NO_FUNDING.code].id,
    },
  ];
  for (const assignment of assignments) {
    const existing = await dataSource.query(
      `SELECT id FROM limit_assignments
        WHERE limit_profile_code=$1 AND subject_type=$2 AND subject_id=$3 AND deleted_at IS NULL`,
      [assignment.profile, assignment.subjectType, assignment.subjectId],
    );
    if (existing.length > 0) continue;
    await dataSource.query(
      `INSERT INTO limit_assignments
         (limit_profile_code, subject_type, subject_id, precedence, is_active, created_by)
       VALUES ($1,$2,$3,10,TRUE,'demo-seed')`,
      [assignment.profile, assignment.subjectType, assignment.subjectId],
    );
  }
  report.push(`Limit profiles ${LIMIT_PROFILES.map((p) => p.code).join(', ')} + 2 class assignments`);
}

async function seedCommercialRules(dataSource, report) {
  const productCodes = (
    await dataSource.query(`SELECT code FROM products WHERE deleted_at IS NULL`)
  ).map((row) => row.code);
  const feeProduct = productCodes.includes('CASH_TO_WALLET') ? 'CASH_TO_WALLET' : productCodes[0];
  if (feeProduct) {
    await dataSource.query(
      `INSERT INTO fee_rules (product_code, currency, flat_fee_minor, percentage_bps, effective_from,
                              priority, is_active, created_by)
       SELECT $1::varchar,'NGN',0,50,NOW(),0,TRUE,'demo-seed'
        WHERE NOT EXISTS (
          SELECT 1 FROM fee_rules
           WHERE product_code=$1::varchar AND currency='NGN' AND deleted_at IS NULL
        )`,
      [feeProduct],
    );
    report.push(`Fee rule seeded for ${feeProduct}`);
  }
  const commissionProduct = productCodes.includes('WALLET_TO_CASH')
    ? 'WALLET_TO_CASH'
    : productCodes[0];
  if (commissionProduct) {
    await dataSource.query(
      `INSERT INTO commission_rules
         (product_code, currency, recipient_type, calculation_model, calculation_basis,
          percentage_bps, effective_from, priority, is_active, created_by)
       SELECT $1::varchar,'NGN','AGENT','PERCENTAGE','PRINCIPAL',25,NOW(),0,TRUE,'demo-seed'
        WHERE NOT EXISTS (
          SELECT 1 FROM commission_rules
           WHERE product_code=$1::varchar AND currency='NGN' AND recipient_type='AGENT'
             AND deleted_at IS NULL
        )`,
      [commissionProduct],
    );
    report.push(`Agent commission rule seeded for ${commissionProduct}`);
  }
}

async function seedAgents({ applicationService, lifecycleService }, dataSource, classes, report) {
  const fixtures = [
    { code: CLASS_ORDINARY.code, reference: 'DEMO-AGENT-ORDINARY-001', business: 'Demo Kofar Wambai Kiosk' },
    { code: CLASS_NO_FUNDING.code, reference: 'DEMO-AGENT-CASHOUT-001', business: 'Demo Sabon Gari Cash Point' },
  ];
  for (const fixture of fixtures) {
    const existing = await dataSource.query(`SELECT id, status FROM agents WHERE reference=$1`, [
      fixture.reference,
    ]);
    if (existing.length > 0) {
      report.push(
        `Agent ${fixture.reference} already present (${existing[0].status}, unchanged) — its class is never rewritten by this script`,
      );
      continue;
    }
    const application = await applicationService.create({
      agentClassId: classes[fixture.code].id,
      applicantReference: fixture.reference,
      businessName: fixture.business,
      contactEmail: `${fixture.reference.toLowerCase()}@demo.local`,
      actor: 'demo-seed',
    });
    await applicationService.submit(application.id, 'demo-seed');
    // Approve through the service, then activate: both write their own audit evidence.
    await applicationService.approve(application.id, 'demo-seed');
    const agent = await lifecycleService.activateFromApplication(application.id, 'demo-seed');
    report.push(
      `Agent ${agent.reference} activated (${agent.status}) on class ${fixture.code} as ${agent.id}`,
    );
  }
}

async function seedInstitutions(app, institutions, dataSource, report) {
  const approvals = app.get(
    loadApplicationModule('authorization/privileged-action-approval.service')
      .PrivilegedActionApprovalService,
  );
  const maker = {
    type: 'OPERATOR',
    principalId: 'demo-seed-maker',
    roles: ['OPERATIONS'],
    scopes: ['institution.manage', 'institution.lifecycle.prepare'],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
    assuranceLevel: 'MFA',
  };
  const checker = {
    ...maker,
    principalId: 'demo-seed-checker',
    roles: ['FINANCE_CONTROLLER'],
    scopes: ['institution.view', 'privileged:approve', 'institution.lifecycle.approve'],
    // Protected-authority checker decisions are bound to the checker's session; the production
    // surface supplies this from the MFA workforce session, a trusted script supplies its own.
    sessionId: '00000000-0000-4000-8000-00000000c4ec',
  };

  const fixtures = [
    {
      reference: 'DEMO-MMO-001',
      code: 'DEMO_MMO_001',
      legalName: 'Demo Mobile Money Operator Limited',
      displayName: 'Demo MMO',
      institutionType: 'MMO',
      regulatorName: 'Central Bank of Nigeria',
      licenceReference: 'CBN/DEMO/MMO/001',
      target: 'APPROVED',
    },
    {
      reference: 'DEMO-PSP-001',
      code: 'DEMO_PSP_001',
      legalName: 'Demo Payment Service Provider Limited',
      displayName: 'Demo PSP',
      institutionType: 'PSP',
      regulatorName: 'Central Bank of Nigeria',
      licenceReference: 'CBN/DEMO/PSP/001',
      target: 'EVIDENCE_SUBMITTED',
    },
    {
      reference: 'DEMO-MFB-001',
      code: 'DEMO_MFB_001',
      legalName: 'Demo Microfinance Bank Plc',
      displayName: 'Demo MFB',
      institutionType: 'MICROFINANCE_BANK',
      target: 'REGISTERED',
    },
  ];

  for (const fixture of fixtures) {
    const existing = await dataSource.query(
      `SELECT id, status FROM financial_institutions WHERE reference=$1 AND deleted_at IS NULL`,
      [fixture.reference],
    );
    if (existing.length > 0) {
      // Deliberately never "repair" an existing row: a REGISTERED institution is a legitimate demo
      // state (no authority) and silently pushing it to APPROVED would hide the console's
      // registration → evidence → approval guidance. Report the state instead.
      report.push(
        `Institution ${fixture.reference} already present (${existing[0].status}, unchanged)`,
      );
      continue;
    }
    const registered = await institutions.register({
      reference: fixture.reference,
      code: fixture.code,
      legalName: fixture.legalName,
      displayName: fixture.displayName,
      institutionType: fixture.institutionType,
      regulatorName: fixture.regulatorName,
      licenceReference: fixture.licenceReference,
      principal: maker,
    });
    if (fixture.target === 'REGISTERED') {
      report.push(`Institution ${fixture.reference} REGISTERED (no authority) as ${registered.id}`);
      continue;
    }
    await institutions.recordRegulatoryEvidence({
      institutionId: registered.id,
      evidenceReference: `${fixture.reference}-REGULATORY-EVIDENCE`,
      regulatorName: fixture.regulatorName,
      licenceReference: fixture.licenceReference,
      principal: maker,
    });
    if (fixture.target === 'EVIDENCE_SUBMITTED') {
      report.push(
        `Institution ${fixture.reference} EVIDENCE_SUBMITTED — awaiting an independent checker (no authority)`,
      );
      continue;
    }
    // APPROVED is only reachable through a maker/checker approval: request as the maker, DECIDE as a
    // different principal (self-approval is refused), then consume inside the lifecycle transaction.
    // Skipping the decision leaves the approval REQUESTED, which is exactly what consumption rejects.
    const lifecycleReason =
      'Demo fixture: independent checker approves the institution lifecycle';
    const approval = await institutions.requestLifecycleChange({
      institutionId: registered.id,
      targetStatus: 'APPROVED',
      reason: lifecycleReason,
      principal: maker,
    });
    const decision = await approvals.approve({
      approvalId: approval.approvalId,
      principal: checker,
      comment: 'Demo fixture checker decision',
    });
    if (!decision.approved || decision.approval?.status !== 'APPROVED') {
      throw new Error(
        `Checker could not approve institution ${fixture.reference}: ${decision.reason ?? 'unknown'}`,
      );
    }
    const approved = await institutions.executeLifecycleChange({
      institutionId: registered.id,
      targetStatus: 'APPROVED',
      approvalId: approval.approvalId,
      reason: lifecycleReason,
      principal: checker,
    });
    report.push(
      `Institution ${fixture.reference} ${approved.status} (operationalAuthority=${approved.operationalAuthority}) as ${approved.id}`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(`\nAgent/institution demo seed failed: ${error?.message ?? error}\n${error?.stack ?? ""}\n`);
  process.exitCode = 1;
});
