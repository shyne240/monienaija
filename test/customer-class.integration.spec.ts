import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { AuditService } from '../src/operations/audit.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { CustomerClassAssignmentService } from '../src/customer-class/customer-class-assignment.service';
import { CustomerClassResolverService } from '../src/customer-class/customer-class-resolver.service';
import { CustomerClassService } from '../src/customer-class/customer-class.service';
import { CustomerClassAssignmentSource } from '../src/customer-class/customer-class.enums';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('customer class governance (PostgreSQL)', () => {
  let db: DataSource;
  let assignments: CustomerClassAssignmentService;
  let resolver: CustomerClassResolverService;
  let classes: CustomerClassService;
  beforeAll(async () => {
    db = await createIntegrationDataSource('customer-class');
    const audit = new AuditService(db.getRepository(AuditEvent));
    assignments = new CustomerClassAssignmentService(db, audit);
    resolver = new CustomerClassResolverService(db);
    classes = new CustomerClassService(db, audit);
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
});
