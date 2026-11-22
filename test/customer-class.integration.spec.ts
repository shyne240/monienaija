import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { AuditService } from '../src/operations/audit.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { CustomerClassAssignmentService } from '../src/customer-class/customer-class-assignment.service';
import { CustomerClassResolverService } from '../src/customer-class/customer-class-resolver.service';
import { CustomerClassService } from '../src/customer-class/customer-class.service';
import {
  CustomerClassAssignmentSource,
  CustomerClassConfigurationStatus,
  CustomerClassStatus,
} from '../src/customer-class/customer-class.enums';
import { FeeRuleDefinition } from '../src/fee-rules/fee-rule.entity';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { FeeRuleResolverService } from '../src/fee-rules/fee-rule-resolver.service';
import { Product } from '../src/product-catalog/product.entity';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('customer class governance (PostgreSQL)', () => {
  let db: DataSource;
  let assignments: CustomerClassAssignmentService;
  let resolver: CustomerClassResolverService;
  let classes: CustomerClassService;
  let feeRules: FeeRuleRegistryService;
  let feeResolver: FeeRuleResolverService;
  beforeAll(async () => {
    db = await createIntegrationDataSource('customer-class');
    await new ProductCatalogSeedService(db.getRepository(Product)).seedIfEmpty();
    const audit = new AuditService(db.getRepository(AuditEvent));
    assignments = new CustomerClassAssignmentService(db, audit);
    resolver = new CustomerClassResolverService(db);
    classes = new CustomerClassService(db, audit);
    feeRules = new FeeRuleRegistryService(db.getRepository(FeeRuleDefinition), db, audit);
    feeResolver = new FeeRuleResolverService(db);
  });
  afterAll(async () => {
    if (db) await destroyIntegrationDataSource(db);
  });

  async function customer(synthetic = false): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic)
      VALUES($1,$2,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED',$3)`,
      [id, `test-${id}`, synthetic],
    );
    return id;
  }

  it('assigns the default and switches with version checks and audit history, independent of KYC', async () => {
    const id = await customer();
    const initial = await db.transaction((m) =>
      assignments.assignDefaultOnRegistrationInManager(m, id, 'test'),
    );
    expect(initial?.classCode).toBe('STANDARD');
    expect(await resolver.resolveClassCodeOuter(id)).toBe('STANDARD');
    const first = await assignments.assignOuter({
      customerId: id,
      classCode: 'PREMIUM',
      reason: 'Service upgrade',
      actor: 'test',
      source: CustomerClassAssignmentSource.SWITCH,
      expectedAssignmentVersion: initial!.assignmentVersion,
    });
    expect(first.assignment.assignmentVersion).toBe(2);
    await expect(
      assignments.assignOuter({
        customerId: id,
        classCode: 'BUSINESS',
        reason: 'Change class',
        actor: 'test',
        source: CustomerClassAssignmentSource.SWITCH,
        expectedAssignmentVersion: 1,
      }),
    ).rejects.toThrow('stale');
    await db.query("UPDATE customers SET kyc_level='LEVEL_1' WHERE id=$1", [id]);
    await db.query("UPDATE customers SET kyc_level='NONE' WHERE id=$1", [id]);
    expect(await resolver.resolveClassCodeOuter(id)).toBe('PREMIUM');
    expect(await assignments.history(id)).toHaveLength(2);
    const audits = await db.query<Array<{ action: string }>>(
      "SELECT action FROM audit_events WHERE entity_type='CUSTOMER_CLASS_ASSIGNMENT' AND entity_id = ANY($1::uuid[]) ORDER BY occurred_at",
      [[initial!.assignmentId, first.assignment.assignmentId]],
    );
    expect(audits.map((a: { action: string }) => a.action)).toEqual([
      'CLASS_ASSIGNED',
      'CLASS_SWITCHED',
    ]);
  });

  it('fails closed for synthetic customers and unavailable or missing classes', async () => {
    const synthetic = await customer(true);
    await expect(
      assignments.assignOuter({
        customerId: synthetic,
        classCode: 'STANDARD',
        reason: 'Manual assignment',
        actor: 'test',
        source: CustomerClassAssignmentSource.MANUAL,
      }),
    ).rejects.toThrow('Synthetic');
    const id = await customer();
    await expect(
      assignments.assignOuter({
        customerId: id,
        classCode: 'MISSING',
        reason: 'Manual assignment',
        actor: 'test',
        source: CustomerClassAssignmentSource.MANUAL,
      }),
    ).rejects.toThrow('not found');
    const custom = await classes.create({ code: 'CUSTOM', name: 'Custom', actor: 'test' });
    await expect(
      assignments.assignOuter({
        customerId: id,
        classCode: custom.code,
        reason: 'Manual assignment',
        actor: 'test',
        source: CustomerClassAssignmentSource.MANUAL,
      }),
    ).rejects.toThrow('not available');
    expect(await resolver.resolveOuter(id)).toBeNull();
  });

  it('replays the default hook without overwriting an existing switch', async () => {
    const id = await customer();
    const first = await db.transaction((m) =>
      assignments.assignDefaultOnRegistrationInManager(m, id, 'test'),
    );
    await db.query(
      "UPDATE customer_class_assignments SET effective_from=clock_timestamp()-interval '1 second' WHERE id=$1",
      [first!.assignmentId],
    );
    const switched = await assignments.assignOuter({
      customerId: id,
      classCode: 'PREMIUM',
      reason: 'Customer request',
      actor: 'test',
      source: CustomerClassAssignmentSource.SWITCH,
      expectedAssignmentVersion: first!.assignmentVersion,
    });
    const replay = await db.transaction((m) =>
      assignments.assignDefaultOnRegistrationInManager(m, id, 'test'),
    );
    expect(replay?.assignmentId).toBe(switched.assignment.assignmentId);
    expect(await assignments.history(id)).toHaveLength(2);
  });

  it('rolls customer and class assignment back together on error', async () => {
    const id = randomUUID();
    await expect(
      db.transaction(async (m) => {
        await m.query(
          `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic)
        VALUES($1,$2,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED',false)`,
          [id, `test-${id}`],
        );
        expect(
          (await assignments.assignDefaultOnRegistrationInManager(m, id, 'test'))?.classCode,
        ).toBe('STANDARD');
        throw new Error('transaction failed');
      }),
    ).rejects.toThrow('transaction failed');
    const rows = await db.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM customers WHERE id=$1',
      [id],
    );
    expect(rows[0]!.count).toBe('0');
    expect(await assignments.history(id)).toEqual([]);
  });

  it('serializes competing switches and rejects the stale version', async () => {
    const id = await customer();
    const initial = await db.transaction((m) =>
      assignments.assignDefaultOnRegistrationInManager(m, id, 'test'),
    );
    await db.query(
      "UPDATE customer_class_assignments SET effective_from=clock_timestamp()-interval '1 second' WHERE id=$1",
      [initial!.assignmentId],
    );
    const result = await Promise.allSettled(
      ['PREMIUM', 'BUSINESS'].map((classCode) =>
        assignments.assignOuter({
          customerId: id,
          classCode,
          reason: 'Competing switch',
          actor: 'test',
          source: CustomerClassAssignmentSource.SWITCH,
          expectedAssignmentVersion: initial!.assignmentVersion,
        }),
      ),
    );
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = result.find((r) => r.status === 'rejected');
    expect(failure?.status === 'rejected' && (failure.reason as Error).message).toMatch(/stale/);
    expect(await assignments.history(id)).toHaveLength(2);
  });

  it('audits removal of the old default and rejects stale catalogue changes', async () => {
    const standard = await classes.getByCode('STANDARD');
    const premium = await classes.getByCode('PREMIUM');
    const changed = await classes.update(premium.id, {
      isDefault: true,
      actor: 'test',
      expectedVersion: premium.version,
    });
    const old = await classes.getByCode('STANDARD');
    expect(old.isDefault).toBe(false);
    expect(old.version).toBe(standard.version + 1);
    const rows = await db.query<Array<{ new_values: { isDefault: boolean } }>>(
      "SELECT new_values FROM audit_events WHERE entity_type='CUSTOMER_CLASS' AND entity_id=$1 AND action='UPDATED' ORDER BY occurred_at DESC LIMIT 1",
      [standard.id],
    );
    expect(rows[0]!.new_values.isDefault).toBe(false);
    await expect(
      classes.update(standard.id, {
        name: 'Stale',
        actor: 'test',
        expectedVersion: standard.version,
      }),
    ).rejects.toThrow('stale');
    await classes.update(old.id, { isDefault: true, actor: 'test', expectedVersion: old.version });
    expect((await classes.getByCode('PREMIUM')).version).toBe(changed.version + 1);
  });

  it('serializes concurrent default changes without deadlocking', async () => {
    const first = await classes.create({ code: 'RACE_ONE', name: 'Race One', actor: 'test' });
    const second = await classes.create({ code: 'RACE_TWO', name: 'Race Two', actor: 'test' });
    const results = await Promise.all([
      classes.update(first.id, { isDefault: true, actor: 'one', expectedVersion: first.version }),
      classes.update(second.id, { isDefault: true, actor: 'two', expectedVersion: second.version }),
    ]);
    expect(results).toHaveLength(2);
    const defaults = (await classes.list()).filter((c) => c.isDefault);
    expect(defaults).toHaveLength(1);
    expect(['RACE_ONE', 'RACE_TWO']).toContain(defaults[0]!.code);
    const standard = await classes.getByCode('STANDARD');
    await classes.update(standard.id, {
      isDefault: true,
      actor: 'test',
      expectedVersion: standard.version,
    });
  });

  it('rejects invalid customer UUIDs safely in the resolver', async () => {
    await expect(resolver.resolveOuter('not-a-uuid')).rejects.toThrow('customerId must be a UUID');
    await expect(resolver.resolveClassCodeOuter('12345')).rejects.toThrow(
      'customerId must be a UUID',
    );
  });

  it('enforces canonical class-code stability and commercial fee-rule referential integrity', async () => {
    const unavailable = await classes.create({
      code: 'COMMERCIAL_PENDING',
      name: 'Pending Commercial Class',
      actor: 'test',
    });

    // Reject non-canonical, nonexistent, and unavailable customer class codes on fee-rule creation.
    await expect(
      feeRules.createRule(
        {
          productCode: 'WALLET_TRANSFER',
          customerClassCode: 'AB',
          flatFeeMinor: '100',
        },
        'test',
      ),
    ).rejects.toThrow('customerClassCode must match ^[A-Z0-9_]{3,80}$');
    await expect(
      feeRules.createRule(
        {
          productCode: 'WALLET_TRANSFER',
          customerClassCode: 'NONEXISTENT_CLASS',
          flatFeeMinor: '100',
        },
        'test',
      ),
    ).rejects.toThrow('not found');
    await expect(
      feeRules.createRule(
        {
          productCode: 'WALLET_TRANSFER',
          customerClassCode: unavailable.code,
          flatFeeMinor: '100',
        },
        'test',
      ),
    ).rejects.toThrow('not available');

    // Configure and enable the class, then create a fee rule targeting it.
    const active = await classes.update(unavailable.id, {
      enabled: true,
      status: CustomerClassStatus.ACTIVE,
      configurationStatus: CustomerClassConfigurationStatus.CONFIGURED,
      expectedVersion: unavailable.version,
      actor: 'test',
    });
    expect(active.code).toBe('COMMERCIAL_PENDING');

    const effectiveFrom = new Date('2030-01-01T00:00:00.000Z');
    const rule = await feeRules.createRule(
      {
        productCode: 'WALLET_TRANSFER',
        currency: 'NGN',
        customerClassCode: active.code,
        flatFeeMinor: '250',
        effectiveFrom,
        priority: 10,
      },
      'test',
    );
    expect(rule.customerClassCode).toBe('COMMERCIAL_PENDING');

    // Read-only end-to-end resolution: CustomerClassResolverService -> FeeRuleResolverService.
    const customerId = await customer();
    await assignments.assignOuter({
      customerId,
      classCode: active.code,
      reason: 'Commercial interop check',
      source: CustomerClassAssignmentSource.MANUAL,
      actor: 'test',
    });
    const resolvedClassCode = await resolver.resolveClassCodeOuter(customerId);
    expect(resolvedClassCode).toBe('COMMERCIAL_PENDING');
    const feeResolution = await feeResolver.resolve({
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      customerClassCode: resolvedClassCode ?? undefined,
      at: new Date('2030-01-02T00:00:00.000Z'),
    });
    expect(feeResolution.status).toBe('RESOLVED');
    expect(feeResolution.rule?.ruleId).toBe(rule.id);
    expect(feeResolution.rule?.customerClassCode).toBe('COMMERCIAL_PENDING');

    // Referential integrity: active fee rule blocks disabling/deprecating the referenced class.
    await expect(
      classes.update(active.id, {
        enabled: false,
        expectedVersion: active.version,
        actor: 'test',
      }),
    ).rejects.toThrow('referenced by active fee rules');
    await expect(
      classes.update(active.id, {
        status: CustomerClassStatus.DEPRECATED,
        expectedVersion: active.version,
        actor: 'test',
      }),
    ).rejects.toThrow('referenced by active fee rules');

    // Non-disabling metadata updates remain permitted and never mutate the canonical class code.
    const renamed = await classes.update(active.id, {
      name: 'Commercial Active Renamed',
      expectedVersion: active.version,
      actor: 'test',
    });
    expect(renamed.code).toBe('COMMERCIAL_PENDING');

    // Once the fee rule is deactivated, the class may be disabled; reactivating the rule fails closed.
    const deactivated = await feeRules.updateRule(
      rule.id,
      { isActive: false, version: rule.version },
      'test',
    );
    const disabled = await classes.update(renamed.id, {
      enabled: false,
      expectedVersion: renamed.version,
      actor: 'test',
    });
    expect(disabled.enabled).toBe(false);
    await expect(
      feeRules.updateRule(rule.id, { isActive: true, version: deactivated.version }, 'test'),
    ).rejects.toThrow('not available');
  });
});
