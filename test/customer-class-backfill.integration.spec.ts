import { randomUUID } from 'node:crypto';
import {
  createEmptyIntegrationDataSource,
  destroyIntegrationDataSource,
} from './support/pg-harness';

describe('customer class migration backfill (PostgreSQL)', () => {
  it('backfills eligible existing customers once and leaves synthetic and closed unresolved', async () => {
    const db = await createEmptyIntegrationDataSource('class-backfill');
    try {
      await db.initialize();
      const tailNames = new Set([
        'CreateCustomerClasses1785753600805',
        'CustomerTierDefaultClassMappings1785753600810',
        'LimitRuleUnlimited1785753600811',
        'CustomerRestrictionConfigurationReview1785753600812',
      ]);
      const all = [...db.migrations];
      db.migrations.splice(
        0,
        db.migrations.length,
        ...all.filter((m) => !tailNames.has(m.name ?? '')),
      );
      await db.runMigrations({ transaction: 'all' });
      const customers = [
        { id: randomUUID(), status: 'DRAFT', synthetic: false },
        { id: randomUUID(), status: 'ACTIVE', synthetic: false },
        { id: randomUUID(), status: 'SUSPENDED', synthetic: false },
        { id: randomUUID(), status: 'CLOSED', synthetic: false },
        { id: randomUUID(), status: 'DRAFT', synthetic: true },
      ];
      for (const c of customers) {
        await db.query(
          `INSERT INTO customers(id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic)
          VALUES($1,$2,'INDIVIDUAL',$3,'NONE','NOT_STARTED',$4)`,
          [c.id, `backfill-${c.id}`, c.status, c.synthetic],
        );
      }
      db.migrations.splice(0, db.migrations.length, ...all);
      expect((await db.runMigrations({ transaction: 'all' })).map((m) => m.name)).toEqual([
        'CreateCustomerClasses1785753600805',
        'CustomerTierDefaultClassMappings1785753600810',
        'LimitRuleUnlimited1785753600811',
        'CustomerRestrictionConfigurationReview1785753600812',
      ]);
      const read = () =>
        db.query<Array<{ customer_id: string; code: string; source: string }>>(
          `SELECT a.customer_id,c.code,a.source FROM customer_class_assignments a JOIN customer_classes c ON c.id=a.class_id ORDER BY a.customer_id`,
        );
      const before = await read();
      expect(before).toHaveLength(3);
      expect(before.map((x) => x.customer_id).sort()).toEqual(
        customers
          .slice(0, 3)
          .map((c) => c.id)
          .sort(),
      );
      expect(before.every((x) => x.code === 'STANDARD' && x.source === 'BACKFILL')).toBe(true);
      expect(await db.runMigrations({ transaction: 'all' })).toEqual([]);
      expect(await read()).toEqual(before);
    } finally {
      await destroyIntegrationDataSource(db);
    }
  }, 180000);
});
