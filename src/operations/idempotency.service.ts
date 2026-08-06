import { randomUUID } from 'node:crypto';

import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';

import { redactRecord } from '../common/sensitive-data-redaction';
import { IdempotencyRecord } from './idempotency-record.entity';
import { IdempotencyRecordStatus } from './operations.enums';
import type {
  CompleteIdempotencyCommand,
  IdempotencyCommand,
  IdempotencyReservation,
} from './operations.types';

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly repository: Repository<IdempotencyRecord>,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async reserve(
    manager: EntityManager,
    command: IdempotencyCommand,
  ): Promise<IdempotencyReservation> {
    this.validateCommand(command);
    const now = new Date();
    const repository = manager.getRepository(IdempotencyRecord);
    const existing = await repository
      .createQueryBuilder('record')
      .where('record.scope = :scope AND record.idempotency_key = :key', {
        scope: command.scope,
        key: command.key,
      })
      .setLock('pessimistic_write')
      .getOne();

    if (existing && existing.expiresAt > now) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another request');
      }
      if (existing.status === IdempotencyRecordStatus.IN_PROGRESS) {
        throw new ConflictException('The idempotent request is already in progress');
      }
      existing.hitCount += 1;
      existing.lastSeenAt = now;
      await repository.save(existing);
      return { kind: 'REPLAY', record: existing };
    }

    if (existing) {
      await repository.remove(existing);
    }

    const retentionSeconds = command.retentionSeconds || this.retentionSeconds();
    const record = repository.create({
      id: randomUUID(),
      scope: command.scope,
      idempotencyKey: command.key,
      requestHash: command.requestHash,
      status: IdempotencyRecordStatus.IN_PROGRESS,
      responseStatusCode: null,
      responseBody: null,
      resourceType: null,
      resourceId: null,
      hitCount: 0,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + retentionSeconds * 1000),
    });
    await repository.save(record);
    return { kind: 'NEW', record };
  }

  async complete(
    manager: EntityManager,
    recordId: string,
    command: CompleteIdempotencyCommand,
  ): Promise<void> {
    const repository = manager.getRepository(IdempotencyRecord);
    const record = await repository.findOne({ where: { id: recordId } });
    if (!record) {
      throw new ConflictException('Idempotency record was not found');
    }
    record.status = IdempotencyRecordStatus.COMPLETED;
    record.responseStatusCode = command.statusCode;
    record.responseBody = redactRecord(command.responseBody);
    record.resourceType = command.resourceType ?? null;
    record.resourceId = command.resourceId ?? null;
    record.lastSeenAt = new Date();
    await repository.save(record);
  }

  async fail(
    manager: EntityManager,
    recordId: string,
    command: CompleteIdempotencyCommand,
  ): Promise<void> {
    const repository = manager.getRepository(IdempotencyRecord);
    const record = await repository.findOne({ where: { id: recordId } });
    if (!record) {
      throw new ConflictException('Idempotency record was not found');
    }
    record.status = IdempotencyRecordStatus.FAILED;
    record.responseStatusCode = command.statusCode;
    record.responseBody = redactRecord(command.responseBody);
    record.resourceType = command.resourceType ?? null;
    record.resourceId = command.resourceId ?? null;
    record.lastSeenAt = new Date();
    await repository.save(record);
  }

  async cleanupExpired(now = new Date(), limit = 1000): Promise<number> {
    const expired = await this.repository.find({
      where: { expiresAt: LessThan(now) },
      order: { expiresAt: 'ASC' },
      take: Math.min(Math.max(limit, 1), 10_000),
    });
    if (expired.length === 0) {
      return 0;
    }
    await this.repository.remove(expired);
    return expired.length;
  }

  private retentionSeconds(): number {
    return this.configService?.get<number>('IDEMPOTENCY_RETENTION_SECONDS') ?? 86_400;
  }

  private validateCommand(command: IdempotencyCommand): void {
    if (!command.scope || command.scope.length > 120) {
      throw new ConflictException('Idempotency scope is invalid');
    }
    if (!command.key || command.key.length > 255) {
      throw new ConflictException('Idempotency key is invalid');
    }
    if (!/^[a-f0-9]{64}$/i.test(command.requestHash)) {
      throw new ConflictException('Idempotency request hash is invalid');
    }
  }
}
