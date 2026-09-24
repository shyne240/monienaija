import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { Agent } from '../src/agent/agent.entity';
import { AgentStatus } from '../src/agent/agent.enums';
import { AgentService } from '../src/agent/agent.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * V1A01 Stage 1 — canonical Agent identity against real PostgreSQL.
 *
 * Proves the `agents` aggregate actually exists and behaves as ADR-0093 §8
 * specifies, and — just as importantly — proves the Stage 1 boundary holds:
 * no agent wallet, financial binding, ledger account or MonieNaija number is
 * created, and no customer financial table is touched.
 */
describe('V1A01 Stage 1 canonical Agent identity (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: AgentService;

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result: unknown = await dataSource.query(sql, params);
    return result as T[];
  }

  async function countRows(table: string): Promise<number> {
    const result = await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`);
    return firstRow(result, `${table} count`).count;
  }

  beforeAll(async () => {
    // createIntegrationDataSource initializes the DataSource and runs the full
    // migration chain against a dedicated database.
    dataSource = await createIntegrationDataSource('agentidentity');
    service = new AgentService(
      dataSource.getRepository(Agent),
      dataSource,
      new AuditService(dataSource.getRepository(AuditEvent)),
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function seedCustomer(): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1, $2, 'INDIVIDUAL', 'ACTIVE', 'NONE', 'NOT_STARTED')`,
      [id, `cust-${id.slice(0, 8)}`],
    );
    return id;
  }

  describe('schema', () => {
    it('creates a dedicated agents table that is not a customer table', async () => {
      const found = await rows<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agents'`,
      );
      expect(found).toHaveLength(1);
    });

    it('enforces the V1 status vocabulary and defaults to PENDING', async () => {
      const defaults = await rows<{ column_default: string | null }>(
        `SELECT column_default FROM information_schema.columns
          WHERE table_name = 'agents' AND column_name = 'status'`,
      );
      expect(String(firstRow(defaults, 'status default').column_default)).toContain('PENDING');

      await expect(
        dataSource.query(
          `INSERT INTO agents (id, reference, status) VALUES ($1, 'bad-status', 'ENABLED')`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/chk_agents_status/);

      for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']) {
        await dataSource.query(`INSERT INTO agents (id, reference, status) VALUES ($1, $2, $3)`, [
          randomUUID(),
          `ref-${status.toLowerCase()}`,
          status,
        ]);
      }
      expect(await countRows('agents')).toBe(4);
    });

    it('enforces global reference uniqueness', async () => {
      await dataSource.query(`INSERT INTO agents (id, reference) VALUES ($1, 'dup-ref')`, [
        randomUUID(),
      ]);
      await expect(
        dataSource.query(`INSERT INTO agents (id, reference) VALUES ($1, 'dup-ref')`, [
          randomUUID(),
        ]),
      ).rejects.toThrow(/uq_agents_reference/);
    });

    it('binds the optional customer trace by real foreign key', async () => {
      const fks = await rows<{ conname: string; refs: string }>(
        `SELECT conname, confrelid::regclass::text AS refs
           FROM pg_constraint
          WHERE conrelid = 'agents'::regclass AND contype = 'f'`,
      );
      expect(fks).toHaveLength(1);
      expect(firstRow(fks, 'agent fk').conname).toBe('fk_agents_operator_customer');
      expect(firstRow(fks, 'agent fk').refs).toBe('customers');

      await expect(
        dataSource.query(
          `INSERT INTO agents (id, reference, operator_customer_id) VALUES ($1, 'orphan', $2)`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow(/fk_agents_operator_customer/);
    });

    it('allows one customer to operate multiple agents, and agents with no customer', async () => {
      const customerId = await seedCustomer();
      await service.create({ reference: 'multi-a', actor: 'ops', operatorCustomerId: customerId });
      await service.create({ reference: 'multi-b', actor: 'ops', operatorCustomerId: customerId });
      await service.create({ reference: 'standalone', actor: 'ops' });

      const traced = await rows<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM agents WHERE operator_customer_id = $1`,
        [customerId],
      );
      expect(firstRow(traced, 'traced agents').count).toBe(2);

      const untraced = await rows<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM agents WHERE operator_customer_id IS NULL`,
      );
      expect(firstRow(untraced, 'untraced agents').count).toBe(1);
    });

    it('refuses to delete a customer that a live agent trace points at', async () => {
      const customerId = await seedCustomer();
      await service.create({ reference: 'traced', actor: 'ops', operatorCustomerId: customerId });

      await expect(
        dataSource.query(`DELETE FROM customers WHERE id = $1`, [customerId]),
      ).rejects.toThrow(/fk_agents_operator_customer/);
    });
  });

  describe('identity', () => {
    it('persists a canonical Agent identity independent of any customer', async () => {
      const created = await service.create({ reference: 'agent-alpha', actor: 'ops' });
      const loaded = await service.get(created.id);

      expect(loaded.id).toBe(created.id);
      expect(loaded.reference).toBe('agent-alpha');
      expect(loaded.status).toBe(AgentStatus.PENDING);
      expect(loaded.operatorCustomerId).toBeNull();
      expect(loaded.version).toBe(1);

      const asCustomer = await rows<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM customers WHERE id = $1`,
        [created.id],
      );
      expect(firstRow(asCustomer, 'agent id as customer').count).toBe(0);
    });

    it('never reuses a customer id as an agent id', async () => {
      const customerId = await seedCustomer();
      const agent = await service.create({
        reference: 'agent-beta',
        actor: 'ops',
        operatorCustomerId: customerId,
      });
      expect(agent.id).not.toBe(customerId);
    });

    it('rejects a duplicate reference through the service', async () => {
      await service.create({ reference: 'agent-gamma', actor: 'ops' });
      await expect(service.create({ reference: 'AGENT-GAMMA', actor: 'ops' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects an operator customer id that does not exist', async () => {
      await expect(
        service.create({
          reference: 'agent-delta',
          actor: 'ops',
          operatorCustomerId: randomUUID(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(await countRows('agents')).toBe(0);
    });

    it('finds by reference and lists by status', async () => {
      await service.create({ reference: 'agent-list-1', actor: 'ops' });
      await service.create({ reference: 'agent-list-2', actor: 'ops' });

      expect((await service.findByReference('agent-list-1')).reference).toBe('agent-list-1');
      expect(await service.list({ status: AgentStatus.PENDING })).toHaveLength(2);
      expect(await service.list({ status: AgentStatus.ACTIVE })).toHaveLength(0);
    });
  });

  describe('auditability', () => {
    it('writes an AGENT CREATED event into the existing audit_events table', async () => {
      const agent = await service.create({
        reference: 'agent-audited',
        actor: 'ops@monienaija',
        correlationId: 'corr-integration',
      });

      const events = await rows<{
        entity_id: string;
        action: string;
        actor: string;
        correlation_id: string | null;
        new_values: { status?: string };
      }>(
        `SELECT entity_id, action, actor, correlation_id, new_values
           FROM audit_events WHERE entity_type = 'AGENT'`,
      );
      const row = firstRow(events, 'agent audit event');
      expect(row.entity_id).toBe(agent.id);
      expect(row.action).toBe('CREATED');
      expect(row.actor).toBe('ops@monienaija');
      expect(row.correlation_id).toBe('corr-integration');
      expect(row.new_values.status).toBe('PENDING');
    });

    it('rolls the audit event back with the agent when the transaction fails', async () => {
      await service.create({ reference: 'agent-atomic', actor: 'ops' });
      await expect(service.create({ reference: 'agent-atomic', actor: 'ops' })).rejects.toBeInstanceOf(
        ConflictException,
      );

      const events = await rows<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM audit_events WHERE entity_type = 'AGENT'`,
      );
      expect(firstRow(events, 'agent audit count').count).toBe(1);
    });
  });

  describe('Stage 1 boundary', () => {
    it('creates NO financial rows of any kind when an agent is created', async () => {
      const customerId = await seedCustomer();
      await service.create({
        reference: 'agent-boundary',
        actor: 'ops',
        operatorCustomerId: customerId,
      });

      for (const table of [
        'wallet_accounts',
        'ledger_accounts',
        'ledger_journals',
        'customer_wallets',
        'customer_financial_account_bindings',
        'customer_receiving_numbers',
        'customer_authentication_credentials',
      ]) {
        expect({ table, count: await countRows(table) }).toEqual({ table, count: 0 });
      }
    });

    it('creates no agent wallet, binding, number, credential or principal table', async () => {
      const tables = await rows<{ tablename: string }>(
        `SELECT tablename FROM pg_tables
          WHERE schemaname = 'public' AND tablename LIKE 'agent%'`,
      );
      expect(tables.map((r) => r.tablename).sort()).toEqual(['agents']);
    });

    it('leaves wallet_accounts without an owner_type discriminator (Stage 2 work)', async () => {
      const columns = await rows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'wallet_accounts'`,
      );
      expect(columns.map((c) => c.column_name)).not.toContain('owner_type');
    });

    it('adds no agent column to any customer financial table', async () => {
      const columns = await rows<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name LIKE '%agent%'
            AND table_name <> 'agents'`,
      );
      // Only the pre-existing B2 readiness attestation may mention an agent.
      expect(columns.filter((r) => !r.table_name.startsWith('b2_'))).toEqual([]);
    });

    it('keeps the agents table free of any financial or credential column', async () => {
      const columns = await rows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'agents'`,
      );
      expect(columns.map((c) => c.column_name).sort()).toEqual([
        'created_at',
        'deleted_at',
        'id',
        'operator_customer_id',
        'reference',
        'status',
        'updated_at',
        'version',
      ]);
    });
  });
});
