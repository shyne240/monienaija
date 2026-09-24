import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { Agent } from '../src/agent/agent.entity';
import { AgentStatus } from '../src/agent/agent.enums';
import { AgentService } from '../src/agent/agent.service';
import type { AuditEventCommand } from '../src/operations/operations.types';

/**
 * V1A01 Stage 1 unit coverage for canonical Agent identity validation.
 *
 * Persistence behaviour is proven separately against real PostgreSQL in
 * `agent-identity.integration.spec.ts`; this suite covers the validation and
 * error-translation logic that does not need a database.
 */
describe('AgentService (unit)', () => {
  function build(
    overrides: {
      save?: (draft: Agent) => Agent;
    } = {},
  ) {
    const auditCommands: AuditEventCommand[] = [];
    const saved: Agent[] = [];
    const repo = {
      create: () => new Agent(),
      save: (draft: Agent): Promise<Agent> => {
        if (overrides.save) return Promise.resolve(overrides.save(draft));
        saved.push(draft);
        return Promise.resolve(draft);
      },
      findOne: (): Promise<Agent | null> => Promise.resolve(null),
      find: (): Promise<Agent[]> => Promise.resolve([]),
    };
    const dataSource = {
      transaction: (work: (m: unknown) => Promise<unknown>) =>
        work({ getRepository: () => repo }),
    };
    const audit = {
      record: (_manager: unknown, command: AuditEventCommand): Promise<void> => {
        auditCommands.push(command);
        return Promise.resolve();
      },
    };
    const service = new AgentService(repo as never, dataSource as never, audit as never);
    return { service, auditCommands, saved };
  }

  function queryFailure(code: string): QueryFailedError {
    const error = new QueryFailedError('insert', [], new Error(code));
    (error as unknown as { driverError: { code: string } }).driverError = { code };
    return error;
  }

  const validCommand = { reference: 'agent-001', actor: 'operator@monienaija' };

  it('creates an Agent with a domain-generated UUID identity', async () => {
    const { service, saved } = build();
    const agent = await service.create(validCommand);

    expect(agent.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(saved).toHaveLength(1);
  });

  it('creates every Agent as PENDING and exposes no status-transition API', async () => {
    const { service } = build();
    const agent = await service.create(validCommand);

    expect(agent.status).toBe(AgentStatus.PENDING);
    // Stage 1 implements no lifecycle transition: approval/activation is the
    // B5-owned onboarding workflow and is deliberately absent.
    const surface = service as unknown as Record<string, unknown>;
    expect(surface.updateStatus).toBeUndefined();
    expect(surface.activate).toBeUndefined();
  });

  it('never derives Agent identity from the optional Customer trace', async () => {
    const { service } = build();
    const operatorCustomerId = '11111111-2222-4333-8444-555555555555';
    const agent = await service.create({ ...validCommand, operatorCustomerId });

    expect(agent.operatorCustomerId).toBe(operatorCustomerId);
    expect(agent.id).not.toBe(operatorCustomerId);
  });

  it('treats the Customer trace as optional', async () => {
    const { service } = build();
    await expect(service.create(validCommand)).resolves.toMatchObject({
      operatorCustomerId: null,
    });
    await expect(
      service.create({ ...validCommand, operatorCustomerId: null }),
    ).resolves.toMatchObject({ operatorCustomerId: null });
  });

  it('normalizes and validates the reference', async () => {
    const { service } = build();
    await expect(
      service.create({ ...validCommand, reference: '  AGENT-002 ' }),
    ).resolves.toMatchObject({ reference: 'agent-002' });

    for (const bad of ['', '   ', '-leading', 'has space', 'a'.repeat(161)]) {
      await expect(service.create({ ...validCommand, reference: bad })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('rejects a malformed operator customer id without touching the database', async () => {
    const { service, saved } = build();
    await expect(
      service.create({ ...validCommand, operatorCustomerId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(saved).toHaveLength(0);
  });

  it('requires an actor for the audit trail', async () => {
    const { service } = build();
    await expect(service.create({ ...validCommand, actor: '  ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('records an immutable AGENT CREATED audit event through existing infrastructure', async () => {
    const { service, auditCommands } = build();
    const agent = await service.create({
      ...validCommand,
      correlationId: 'corr-1',
      requestId: 'req-1',
    });

    expect(auditCommands).toHaveLength(1);
    expect(auditCommands[0]).toMatchObject({
      entityType: 'AGENT',
      entityId: agent.id,
      action: 'CREATED',
      actor: 'operator@monienaija',
      correlationId: 'corr-1',
      requestId: 'req-1',
    });
  });

  it('never writes a credential, PIN, wallet, account or number into the audit payload', async () => {
    const { service, auditCommands } = build();
    await service.create(validCommand);
    const payload = JSON.stringify(auditCommands[0]?.newValues).toLowerCase();

    for (const forbidden of [
      'pin',
      'password',
      'credential',
      'wallet',
      'ledger',
      'account',
      'balance',
      'number',
    ]) {
      expect(payload).not.toContain(forbidden);
    }
  });

  it('translates a unique violation into a conflict', async () => {
    const { service } = build({
      save: () => {
        throw queryFailure('23505');
      },
    });
    await expect(service.create(validCommand)).rejects.toBeInstanceOf(ConflictException);
  });

  it('translates a foreign-key violation on the Customer trace into a bad request', async () => {
    const { service } = build({
      save: () => {
        throw queryFailure('23503');
      },
    });
    await expect(
      service.create({
        ...validCommand,
        operatorCustomerId: '11111111-2222-4333-8444-555555555555',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-UUID lookup and reports a missing Agent as not found', async () => {
    const { service } = build();
    await expect(service.get('nope')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.get('11111111-2222-4333-8444-555555555555')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.findByReference('missing-agent')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('exposes no financial surface at all on the Stage 1 service', () => {
    const { service } = build();
    const surface = new Set([
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(service) as object),
      ...Object.keys(service),
    ]);

    for (const forbidden of [
      'provisionWallet',
      'createWallet',
      'getBalance',
      'bind',
      'createBinding',
      'issueNumber',
      'allocateNumber',
      'setPin',
      'authenticate',
      'authorize',
    ]) {
      expect(surface.has(forbidden)).toBe(false);
    }
  });
});
