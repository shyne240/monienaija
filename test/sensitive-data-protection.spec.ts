import type { EntityManager, Repository } from 'typeorm';

import {
  redactRecord,
  redactSensitiveText,
  REDACTED_VALUE,
} from '../src/common/sensitive-data-redaction';
import { AuditService } from '../src/operations/audit.service';
import type { AuditEvent } from '../src/operations/audit-event.entity';
import type { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { OutboxService } from '../src/operations/outbox.service';
import type { OutboxEvent } from '../src/operations/outbox-event.entity';
import { IdempotencyRecordStatus } from '../src/operations/operations.enums';

function managerFor<T extends Record<string, unknown>>(entity: T) {
  const repository = {
    create: jest.fn((value: T) => value),
    save: jest.fn((value: T) => value),
    findOne: jest.fn(() => entity),
  };
  const manager = {
    getRepository: jest.fn(() => repository),
  };
  return { manager: manager as unknown as EntityManager, repository };
}

describe('sensitive data protection', () => {
  it('redacts sensitive keys recursively and preserves safe values', () => {
    const value = redactRecord({
      safe: 'visible',
      passwordHash: 'password-secret',
      nested: {
        accessToken: 'token-secret',
        deviceFingerprintHash: 'device-secret',
      },
      values: [{ codeHash: 'code-secret', label: 'safe-label' }],
    });
    expect(value).toEqual({
      safe: 'visible',
      passwordHash: REDACTED_VALUE,
      nested: {
        accessToken: REDACTED_VALUE,
        deviceFingerprintHash: REDACTED_VALUE,
      },
      values: [{ codeHash: REDACTED_VALUE, label: 'safe-label' }],
    });
    expect(redactSensitiveText('passwordHash=secret tokenHash=token-value safe=value')).toBe(
      'passwordHash=[REDACTED] tokenHash=[REDACTED] safe=value',
    );
  });

  it('redacts audit values before persistence', async () => {
    const { manager, repository } = managerFor({} as Record<string, unknown>);
    const service = new AuditService({} as Repository<AuditEvent>);
    await service.record(manager, {
      entityType: 'AUTHENTICATION_SESSION',
      entityId: '00000000-0000-4000-8000-000000000001',
      action: 'TEST',
      actor: 'test',
      newValues: { tokenHash: 'raw-token-hash', status: 'ACTIVE' },
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        newValues: { tokenHash: REDACTED_VALUE, status: 'ACTIVE' },
      }),
    );
  });

  it('redacts outbox payloads before persistence', async () => {
    const { manager, repository } = managerFor({} as Record<string, unknown>);
    const service = new OutboxService({} as Repository<OutboxEvent>);
    await service.enqueue(manager, {
      eventType: 'AUTHENTICATION',
      aggregateType: 'SESSION',
      aggregateId: '00000000-0000-4000-8000-000000000001',
      payload: { accessToken: 'raw-token', outcome: 'OK' },
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { accessToken: REDACTED_VALUE, outcome: 'OK' },
      }),
    );
  });

  it('redacts idempotency response bodies before persistence', async () => {
    const record = {
      status: IdempotencyRecordStatus.IN_PROGRESS,
      responseBody: null,
      resourceType: null,
      resourceId: null,
      lastSeenAt: new Date(),
    } as unknown as IdempotencyRecord;
    const repository = {
      findOne: jest.fn(() => record),
      save: jest.fn((value: IdempotencyRecord) => value),
    };
    const service = new IdempotencyService(repository as unknown as Repository<IdempotencyRecord>);
    const manager = {
      getRepository: jest.fn(() => repository),
    } as unknown as EntityManager;
    await service.complete(manager, '00000000-0000-4000-8000-000000000001', {
      statusCode: 200,
      responseBody: { refreshToken: 'raw-token', status: 'OK' },
    });
    expect(record.responseBody).toEqual({ refreshToken: REDACTED_VALUE, status: 'OK' });
    expect(record.status).toBe(IdempotencyRecordStatus.COMPLETED);
  });
});
