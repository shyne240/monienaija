import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';

const REQUIRED_LIMIT_DIMENSIONS = [
  'MAX_AMOUNT_PER_TX',
  'DAILY_AMOUNT',
  'WEEKLY_AMOUNT',
  'MONTHLY_AMOUNT',
  'WALLET_BALANCE_MAX',
] as const;

const TIERS = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const;

type Db = DataSource | EntityManager;

async function q<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const queryable = db as unknown as { query: (q: string, p?: unknown[]) => Promise<unknown> };
  return (await queryable.query(sql, params)) as T[];
}

/**
 * Seeds the minimum synthetic commercial configuration required by the activation
 * configuration gate (ACTIVATION_CONFIGURATION_INCOMPLETE). Idempotent and safe to
 * call in integration tests that need successful DRAFT->ACTIVE activation but are not
 * testing missing-config behavior.
 *
 * It does NOT weaken the gate: tests that intentionally remove config still observe
 * the gate. Call this only in suites that expect activation to succeed.
 */
export async function seedActivationCommercialConfig(
  db: Db,
  opts: { actor?: string; classCode?: string; profileCode?: string } = {},
): Promise<{ classCode: string; profileCode: string }> {
  const actor = opts.actor ?? 'test-activation-config-fixture';
  const classCode = opts.classCode ?? 'TEST_ACTIVATION_DEFAULT';
  const profileCode = opts.profileCode ?? 'TEST_ACTIVATION_LIMITS';

  // 1) Usable customer class.
  const existingClass = await q<{ id: string; code: string }>(
    db,
    `SELECT id, code FROM customer_classes
      WHERE code = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [classCode],
  );
  let classId: string;
  if (existingClass[0]) {
    classId = String(existingClass[0].id);
    await q(
      db,
      `UPDATE customer_classes
          SET status='ACTIVE', enabled=true, configuration_status='CONFIGURED',
              kind='CUSTOMER', deleted_at=NULL, updated_at=clock_timestamp()
        WHERE id=$1`,
      [classId],
    );
  } else {
    classId = randomUUID();
    await q(
      db,
      `INSERT INTO customer_classes
        (id, reference, code, name, description, kind, status, enabled, configuration_status, is_default, created_by, version, created_at, updated_at)
       VALUES ($1,$2,$3,'Test Activation Default','Synthetic fixture class for activation-gate tests','CUSTOMER','ACTIVE',true,'CONFIGURED',false,$4,1,clock_timestamp(),clock_timestamp())`,
      [classId, `cc-${classId.slice(0, 8)}`, classCode, actor],
    );
  }

  // 2) Approved tier default mappings for all KYC tiers.
  for (const tier of TIERS) {
    await q(
      db,
      `INSERT INTO customer_tier_default_classes
        (tier, class_id, status, approved_at, approved_by, reason, created_by, updated_by, version, created_at, updated_at)
       VALUES ($1,$2,'APPROVED',clock_timestamp(),$3,'Synthetic activation fixture',$3,$3,1,clock_timestamp(),clock_timestamp())
       ON CONFLICT (tier) DO UPDATE
         SET class_id=EXCLUDED.class_id,
             status='APPROVED',
             approved_at=COALESCE(customer_tier_default_classes.approved_at, clock_timestamp()),
             approved_by=COALESCE(customer_tier_default_classes.approved_by, EXCLUDED.approved_by),
             reason=COALESCE(customer_tier_default_classes.reason, EXCLUDED.reason),
             updated_by=EXCLUDED.updated_by,
             updated_at=clock_timestamp()`,
      [tier, classId, actor],
    );
  }

  // 3) Fee and limit coverage for every enabled/configured V1 customer product.
  const products = await q<{ code: string }>(
    db,
    `SELECT code FROM products
      WHERE domain='CUSTOMER' AND status='ACTIVE' AND enabled=TRUE
        AND configuration_status='CONFIGURED' AND product_scope='V1' AND deleted_at IS NULL
      ORDER BY code ASC`,
  );

  if (products.length === 0) {
    // Create a minimal synthetic product so activation has something to configure.
    const syntheticCode = 'TEST_ACTIVATION_PRODUCT';
    await q(
      db,
      `INSERT INTO products(code,name,domain,currency,product_scope,status,enabled,configuration_status,created_by,version,created_at,updated_at)
       VALUES($1,'Test Activation Product','CUSTOMER','NGN','V1','ACTIVE',true,'CONFIGURED',$2,1,clock_timestamp(),clock_timestamp())
       ON CONFLICT (code) DO UPDATE
         SET status='ACTIVE', enabled=true, configuration_status='CONFIGURED', product_scope='V1', domain='CUSTOMER', deleted_at=NULL, updated_at=clock_timestamp()`,
      [syntheticCode, actor],
    );
    products.push({ code: syntheticCode });
  }

  // 4) Limit profile + assignment for the class.
  await q(
    db,
    `INSERT INTO limit_profiles(code,name,description,kind,status,enabled,configuration_status,created_by,version,created_at,updated_at)
     VALUES($1,'Test Activation Limits','Synthetic activation fixture','CUSTOMER','ACTIVE',true,'CONFIGURED',$2,1,clock_timestamp(),clock_timestamp())
     ON CONFLICT (code) DO UPDATE
       SET status='ACTIVE', enabled=true, configuration_status='CONFIGURED', deleted_at=NULL, updated_at=clock_timestamp()`,
    [profileCode, actor],
  );

  const assignmentExists = await q<{ id: string }>(
    db,
    `SELECT id FROM limit_assignments
      WHERE limit_profile_code=$1 AND subject_type='SEGMENT' AND segment_code=$2
        AND deleted_at IS NULL AND is_active=TRUE
      LIMIT 1`,
    [profileCode, classCode],
  );
  if (!assignmentExists[0]) {
    await q(
      db,
      `INSERT INTO limit_assignments
        (id,limit_profile_code,subject_type,subject_id,segment_code,precedence,effective_from,effective_to,is_active,created_by,version,created_at,updated_at)
       VALUES($1,$2,'SEGMENT',NULL,$3,100,clock_timestamp()-interval '1 day',NULL,true,$4,1,clock_timestamp(),clock_timestamp())`,
      [randomUUID(), profileCode, classCode, actor],
    );
  }

  for (const p of products) {
    const productCode = String(p.code).toUpperCase();

    // Fee rule for the effective class (idempotent per product+class+currency).
    const feeExists = await q<{ id: string }>(
      db,
      `SELECT id FROM fee_rules
        WHERE product_code=$1 AND currency='NGN' AND customer_class_code=$2
          AND deleted_at IS NULL AND is_active=TRUE
        LIMIT 1`,
      [productCode, classCode],
    );
    if (!feeExists[0]) {
      await q(
        db,
        `INSERT INTO fee_rules
          (id,product_code,currency,flat_fee_minor,percentage_bps,minimum_fee_minor,maximum_fee_minor,vat_bps,
           effective_from,effective_to,priority,is_active,created_by,version,created_at,updated_at,
           customer_class_code,agent_class_id,institution_id)
         VALUES($1,$2,'NGN',0,0,0,0,0,clock_timestamp()-interval '1 day',NULL,100,true,$3,1,clock_timestamp(),clock_timestamp(),$4,NULL,NULL)`,
        [randomUUID(), productCode, actor, classCode],
      );
    }

    // Required limit dimensions.
    for (const dim of REQUIRED_LIMIT_DIMENSIONS) {
      const ruleExists = await q<{ id: string }>(
        db,
        `SELECT id FROM limit_rules
          WHERE limit_profile_code=$1 AND product=$2 AND dimension=$3
            AND currency='NGN' AND is_active=TRUE AND deleted_at IS NULL
          LIMIT 1`,
        [profileCode, productCode, dim],
      );
      if (!ruleExists[0]) {
        await q(
          db,
          `INSERT INTO limit_rules
            (id,limit_profile_code,product,direction,channel,currency,dimension,limit_value_minor,limit_value_count,
             is_unlimited,version,effective_from,effective_to,is_active,priority,created_by,created_at,updated_at)
           VALUES($1,$2,$3,NULL,NULL,'NGN',$4,100000000,NULL,false,1,clock_timestamp()-interval '1 day',NULL,true,100,$5,clock_timestamp(),clock_timestamp())`,
          [randomUUID(), profileCode, productCode, dim, actor],
        );
      }
    }
  }

  return { classCode, profileCode };
}
