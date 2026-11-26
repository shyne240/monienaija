#!/usr/bin/env node
'use strict';

/**
 * Disposable-local-database operational fixture for Compliance, Fraud, KYC Review,
 * and Support workspaces.
 *
 * Requires LOCAL_DEV_SEED_CONFIRM=disposable-local-database and loopback DB_HOST.
 * Idempotent: safe to re-run without duplicating rows.
 */
require('dotenv/config');
const { Client } = require('pg');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function assertDisposableLocalDb() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed operational fixtures when NODE_ENV=production.');
  }
  if (process.env.LOCAL_DEV_SEED_CONFIRM !== 'disposable-local-database') {
    throw new Error(
      'Set LOCAL_DEV_SEED_CONFIRM=disposable-local-database to confirm disposable local seeding.',
    );
  }
  const host = (process.env.DB_HOST || '127.0.0.1').trim();
  if (!LOOPBACK_HOSTS.has(host) && !host.startsWith('/')) {
    throw new Error(`Refusing to seed non-loopback DB_HOST="${host}".`);
  }
}

async function main() {
  assertDisposableLocalDb();

  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'monienaija',
  });

  await client.connect();
  try {
    await client.query('BEGIN');

    // 1. Seed operational customers across KYC states & manual holds
    const customers = [
      {
        id: '22222222-2222-4222-8222-222222222201',
        reference: 'cust-ops-kyc-001',
        displayName: 'Amina Abdullahi',
        legalName: 'Amina Musa Abdullahi',
        firstName: 'Amina',
        lastName: 'Abdullahi',
        kycLevel: 'NONE',
        kycStatus: 'PENDING',
        holdReason: 'MANUAL_REVIEW',
        assessmentReason: 'MANUAL_REVIEW',
      },
      {
        id: '22222222-2222-4222-8222-222222222202',
        reference: 'cust-ops-kyc-002',
        displayName: 'Chinedu Okafor',
        legalName: 'Chinedu Emeka Okafor',
        firstName: 'Chinedu',
        lastName: 'Okafor',
        kycLevel: 'NONE',
        kycStatus: 'REJECTED',
        holdReason: 'IDENTITY_CONFLICT',
        assessmentReason: 'IDENTITY_CONFLICT',
      },
      {
        id: '22222222-2222-4222-8222-222222222203',
        reference: 'cust-ops-kyc-003',
        displayName: 'Zainab Ibrahim',
        legalName: 'Zainab Bello Ibrahim',
        firstName: 'Zainab',
        lastName: 'Ibrahim',
        kycLevel: 'LEVEL_2',
        kycStatus: 'APPROVED',
        holdReason: null,
        assessmentReason: 'BVN_AND_NIN_VERIFIED',
      },
      {
        id: '22222222-2222-4222-8222-222222222204',
        reference: 'cust-ops-kyc-004',
        displayName: 'Tunde Adeyemi',
        legalName: 'Babatunde Olumide Adeyemi',
        firstName: 'Tunde',
        lastName: 'Adeyemi',
        kycLevel: 'LEVEL_1',
        kycStatus: 'APPROVED',
        holdReason: null,
        assessmentReason: 'TIER_1_VERIFIED',
      },
      {
        id: '22222222-2222-4222-8222-222222222205',
        reference: 'cust-ops-kyc-005',
        displayName: 'Hauwa Suleiman',
        legalName: 'Hauwa Sani Suleiman',
        firstName: 'Hauwa',
        lastName: 'Suleiman',
        kycLevel: 'NONE',
        kycStatus: 'NOT_STARTED',
        holdReason: null,
        assessmentReason: null,
      },
    ];

    for (let idx = 0; idx < customers.length; idx++) {
      const cust = customers[idx];
      await client.query(
        `INSERT INTO customers (
           id, reference, customer_type, status, kyc_level, kyc_status, version, is_synthetic
         )
         VALUES ($1::uuid, $2, 'INDIVIDUAL', 'ACTIVE', $3, $4, 1, FALSE)
         ON CONFLICT (id) DO UPDATE
           SET kyc_level = EXCLUDED.kyc_level,
               kyc_status = EXCLUDED.kyc_status,
               updated_at = NOW()`,
        [cust.id, cust.reference, cust.kycLevel, cust.kycStatus],
      );

      const profileId = `23232323-2323-4323-8323-23232323230${idx + 1}`;
      await client.query(
        `INSERT INTO customer_profiles (
           id, customer_id, display_name, legal_name, first_name, last_name, nationality, is_active
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'NG', TRUE)
         ON CONFLICT (id) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               legal_name = EXCLUDED.legal_name,
               updated_at = NOW()`,
        [profileId, cust.id, cust.displayName, cust.legalName, cust.firstName, cust.lastName],
      );

      const phoneId = `27272727-2727-4727-8727-27272727270${idx + 1}`;
      const phoneVal = `+234803000100${idx + 1}`;
      await client.query(
        `INSERT INTO customer_contact_methods (
           id, customer_id, type, value, normalized_value, is_primary, verified_at
         )
         VALUES ($1::uuid, $2::uuid, 'PHONE', $3, $3, TRUE, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [phoneId, cust.id, phoneVal],
      );

      const addrId = `28282828-2828-4828-8828-28282828280${idx + 1}`;
      await client.query(
        `INSERT INTO customer_addresses (
           id, customer_id, type, line_one, city, state, country, is_primary
         )
         VALUES ($1::uuid, $2::uuid, 'RESIDENTIAL', $3, 'Kano', 'Kano State', 'NG', TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [addrId, cust.id, `${10 + idx} Zoo Road`],
      );

      const docId = `29292929-2929-4929-8929-29292929290${idx + 1}`;
      await client.query(
        `INSERT INTO customer_identity_documents (
           id, customer_id, type, document_number, issuing_country
         )
         VALUES ($1::uuid, $2::uuid, 'NIN', $3, 'NG')
         ON CONFLICT (id) DO NOTHING`,
        [docId, cust.id, `9900001000${idx + 1}`],
      );

      if (idx === 0) {
        const poaId = '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a01';
        const poaGroupId = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b01';
        await client.query(
          `INSERT INTO customer_proof_of_address_submissions (
             id, submission_group_id, revision_number, customer_id, residential_address_id,
             category, document_type, review_status, document_status,
             created_by_principal_id, created_by_role_key
           )
           VALUES (
             $1::uuid, $2::uuid, 1, $3::uuid, $4::uuid,
             'UTILITY', 'ELECTRICITY_BILL', 'PENDING', 'QUARANTINED',
             'operations@monienaija.local', 'OPERATIONS'
           )
           ON CONFLICT (id) DO NOTHING`,
          [poaId, poaGroupId, cust.id, addrId],
        );
      }

      if (cust.kycStatus !== 'NOT_STARTED') {
        const assessmentId = `26262626-2626-4626-8626-26262626260${idx + 1}`;
        await client.query(
          `UPDATE customer_kyc_assessments SET is_current = FALSE WHERE customer_id = $1::uuid AND id <> $2::uuid`,
          [cust.id, assessmentId],
        );
        await client.query(
          `INSERT INTO customer_kyc_assessments (
             id, customer_id, kyc_level, kyc_status, reason, assessed_by, is_current
           )
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'compliance@monienaija.local', TRUE)
           ON CONFLICT (id) DO UPDATE
             SET kyc_level = EXCLUDED.kyc_level,
                 kyc_status = EXCLUDED.kyc_status,
                 reason = EXCLUDED.reason,
                 is_current = TRUE,
                 updated_at = NOW()`,
          [assessmentId, cust.id, cust.kycLevel, cust.kycStatus, cust.assessmentReason],
        );
      }

      if (cust.holdReason) {
        await client.query(
          `INSERT INTO kyc_tier_manual_holds (customer_id, actor, reason)
           VALUES ($1::uuid, 'compliance@monienaija.local', $2)
           ON CONFLICT (customer_id) DO UPDATE
             SET reason = EXCLUDED.reason,
                 actor = EXCLUDED.actor`,
          [cust.id, cust.holdReason],
        );
      }
    }

    // 2. Seed SLA definitions & Compliance + Fraud cases
    const slas = [
      ['AML', 48],
      ['SANCTIONS', 24],
      ['PEP', 72],
      ['KYC', 24],
      ['FRAUD', 12],
      ['OTHER', 96],
    ];
    for (const [category, hours] of slas) {
      await client.query(
        `INSERT INTO compliance_case_sla (category, resolution_hours, configured_by, configured_at, notes)
         VALUES ($1, $2, 'compliance@monienaija.local', NOW(), 'Operational default SLA')
         ON CONFLICT (category) DO NOTHING`,
        [category, hours],
      );
    }

    const cases = [
      {
        id: '33333333-3333-4333-8333-333333333301',
        customerId: customers[0].id,
        caseNumber: 'cc-ops-aml-0001',
        category: 'AML',
        severity: 'HIGH',
        status: 'UNDER_REVIEW',
        openedBy: 'compliance@monienaija.local',
        assignedTo: 'compliance@monienaija.local',
        comment: 'Structuring alert triggered across three rapid inbound transfers.',
        evidenceName: 'aml-structuring-report-001.pdf',
        evidenceType: 'TRANSACTION_MONITORING_ALERT',
        evidenceRef: 'DOC-AML-2026-0001',
      },
      {
        id: '33333333-3333-4333-8333-333333333302',
        customerId: customers[1].id,
        caseNumber: 'cc-ops-kyc-0002',
        category: 'KYC',
        severity: 'CRITICAL',
        status: 'ESCALATED',
        openedBy: 'compliance@monienaija.local',
        assignedTo: null,
        comment:
          'BVN identity claim matched a conflicting date-of-birth record; escalated for review.',
        evidenceName: 'nin-bvn-mismatch-dossier.pdf',
        evidenceType: 'IDENTITY_VERIFICATION_REPORT',
        evidenceRef: 'DOC-KYC-2026-0002',
      },
      {
        id: '33333333-3333-4333-8333-333333333303',
        customerId: customers[2].id,
        caseNumber: 'cc-ops-sanc-0003',
        category: 'SANCTIONS',
        severity: 'MEDIUM',
        status: 'OPEN',
        openedBy: 'compliance@monienaija.local',
        assignedTo: null,
        comment: 'Fuzzy name match queued for secondary sanctions screening clearance.',
        evidenceName: 'sanctions-hit-summary.json',
        evidenceType: 'WATCHLIST_MATCH',
        evidenceRef: 'DOC-SANC-2026-0003',
      },
      {
        id: '33333333-3333-4333-8333-333333333304',
        customerId: customers[0].id,
        caseNumber: 'cc-ops-frd-0004',
        category: 'FRAUD',
        severity: 'CRITICAL',
        status: 'ESCALATED',
        openedBy: 'risk-fraud@monienaija.local',
        assignedTo: 'risk-fraud@monienaija.local',
        comment: 'New device fingerprint attempted SIM-swap recovery followed by wallet drain.',
        evidenceName: 'device-telemetry-simswap.json',
        evidenceType: 'DEVICE_RISK_SIGNAL',
        evidenceRef: 'DOC-FRD-2026-0004',
      },
      {
        id: '33333333-3333-4333-8333-333333333305',
        customerId: customers[3].id,
        caseNumber: 'cc-ops-frd-0005',
        category: 'FRAUD',
        severity: 'HIGH',
        status: 'OPEN',
        openedBy: 'risk-fraud@monienaija.local',
        assignedTo: null,
        comment: 'Mule-ring beneficiary velocity spike detected across five counterparties.',
        evidenceName: 'beneficiary-graph-005.pdf',
        evidenceType: 'VELOCITY_GRAPH',
        evidenceRef: 'DOC-FRD-2026-0005',
      },
    ];

    for (let idx = 0; idx < cases.length; idx++) {
      const c = cases[idx];
      await client.query(
        `INSERT INTO customer_compliance_cases (
           id, customer_id, case_number, category, severity, status,
           opened_by, assigned_to, opened_at, version
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, NOW() - ($9::int || ' hours')::interval, 1)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id,
          c.customerId,
          c.caseNumber,
          c.category,
          c.severity,
          c.status,
          c.openedBy,
          c.assignedTo,
          (idx + 2) * 5,
        ],
      );

      const commentId = `34343434-3434-4434-8434-34343434340${idx + 1}`;
      await client.query(
        `INSERT INTO compliance_case_comments (id, case_id, customer_id, comment, actor)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [commentId, c.id, c.customerId, c.comment, c.openedBy],
      );

      const evidenceId = `35353535-3535-4535-8535-35353535350${idx + 1}`;
      await client.query(
        `INSERT INTO compliance_case_evidence (
           id, case_id, customer_id, document_name, document_type, reference, uploaded_by, uploaded_at
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, NOW() - INTERVAL '2 hours')
         ON CONFLICT (id) DO NOTHING`,
        [
          evidenceId,
          c.id,
          c.customerId,
          c.evidenceName,
          c.evidenceType,
          c.evidenceRef,
          c.openedBy,
        ],
      );

      const historyId = `36363636-3636-4636-8636-36363636360${idx + 1}`;
      await client.query(
        `INSERT INTO compliance_case_histories (
           id, case_id, action, previous_status, new_status, new_assignee, actor, metadata
         )
         VALUES ($1::uuid, $2::uuid, 'CASE_CREATED', NULL, $3, $4, $5, $6::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          historyId,
          c.id,
          c.status,
          c.assignedTo,
          c.openedBy,
          JSON.stringify({ category: c.category, severity: c.severity, seeded: true }),
        ],
      );
    }

    // 3. Seed Support Tickets & Thread Messages
    const tickets = [
      {
        id: '44444444-4444-4444-8444-444444444401',
        reference: 'sup-ops-0001',
        customerId: customers[0].id,
        subject: 'KYC review hold inquiry on Tier 2 upgrade',
        category: 'PROFILE',
        description:
          'Customer called support requesting an update on her pending Tier 2 verification hold.',
        status: 'OPEN',
        priority: 'HIGH',
        assignedTo: null,
        message:
          'Escalating customer verification inquiry to Compliance queue with reference cust-ops-kyc-001.',
      },
      {
        id: '44444444-4444-4444-8444-444444444402',
        reference: 'sup-ops-0002',
        customerId: customers[2].id,
        subject: 'Delayed NIP bank transfer settlement receipt',
        category: 'TRANSFER',
        description:
          'Outbound transfer debited wallet; customer requested stamped settlement confirmation.',
        status: 'IN_PROGRESS',
        priority: 'CRITICAL',
        assignedTo: 'customer-service@monienaija.local',
        message:
          'Verified NIP session ID with operations; awaiting final beneficiary bank acknowledgement.',
      },
      {
        id: '44444444-4444-4444-8444-444444444403',
        reference: 'sup-ops-0003',
        customerId: customers[3].id,
        subject: 'Account authentication challenge reset',
        category: 'AUTHENTICATION',
        description: 'Customer requested assistance completing device authentication recovery.',
        status: 'RESOLVED',
        priority: 'LOW',
        assignedTo: 'customer-service@monienaija.local',
        message: 'Customer verified identity and completed recovery challenge.',
      },
    ];

    for (let idx = 0; idx < tickets.length; idx++) {
      const t = tickets[idx];
      await client.query(
        `INSERT INTO support_tickets (
           id, reference, customer_id, created_by_type, created_by_id,
           subject, category, description, status, priority, assigned_to,
           resolved_at, version
         )
         VALUES (
           $1::uuid, $2, $3::uuid, 'SUPPORT', 'customer-service@monienaija.local',
           $4, $5, $6, $7::varchar, $8, $9,
           CASE WHEN $7::varchar = 'RESOLVED' THEN NOW() - INTERVAL '1 hour' ELSE NULL END,
           1
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          t.id,
          t.reference,
          t.customerId,
          t.subject,
          t.category,
          t.description,
          t.status,
          t.priority,
          t.assignedTo,
        ],
      );

      const msgId = `45454545-4545-4545-8545-45454545450${idx + 1}`;
      await client.query(
        `INSERT INTO support_ticket_messages (
           id, ticket_id, author_type, author_id, body, is_internal
         )
         VALUES ($1::uuid, $2::uuid, 'SUPPORT', 'customer-service@monienaija.local', $3, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [msgId, t.id, t.message],
      );
    }

    await client.query('COMMIT');
    console.log(
      JSON.stringify(
        {
          seeded: true,
          customers: customers.length,
          complianceAndFraudCases: cases.length,
          supportTickets: tickets.length,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
