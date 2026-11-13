/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { redactRecord } from '../common/sensitive-data-redaction';
import { Customer } from './customer.entity';
import { CustomerTransactionPin } from './customer-transaction-pin.entity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FAILED_PINS = 5;

@Injectable()
export class CustomerTransactionPinService {
  constructor(
    @InjectRepository(CustomerTransactionPin)
    private readonly pinRepository: Repository<CustomerTransactionPin>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async setTransactionPin(
    customerId: string,
    command: {
      pinHash: string;
      hashAlgorithm: string;
      pinVersion: number;
      actor: string;
      createOnly?: boolean;
    },
  ): Promise<CustomerTransactionPin> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const pinHash = this.normalizeHash(command.pinHash, 'pinHash');
    if (!command.hashAlgorithm || typeof command.hashAlgorithm !== 'string') {
      throw new BadRequestException('hashAlgorithm is invalid');
    }
    if (!Number.isSafeInteger(command.pinVersion) || command.pinVersion < 1) {
      throw new BadRequestException('pinVersion must be a positive integer');
    }
    return this.dataSource.transaction(async (manager) => {
      const customer = await manager
        .getRepository(Customer)
        .findOne({ where: { id: customerId }, lock: { mode: 'pessimistic_write' } });
      if (!customer || customer.deletedAt !== null) {
        throw new NotFoundException(`Customer ${customerId} was not found`);
      }
      const pinRepo = manager.getRepository(CustomerTransactionPin);
      let pin = await pinRepo.findOne({
        where: { customerId },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();
      if (pin && pin.deletedAt === null) {
        if (command.createOnly) throw new ConflictException('Transaction PIN already exists');
        const previous = this.pinValues(pin);
        pin.pinHash = pinHash;
        pin.hashAlgorithm = command.hashAlgorithm;
        pin.pinVersion = command.pinVersion;
        pin.lastChangedAt = now;
        pin.failedCount = 0;
        pin.accountLocked = false;
        pin.lockedAt = null;
        pin.lockReason = null;
        const saved = await pinRepo.save(pin);
        await this.audit(
          manager,
          'CUSTOMER_TRANSACTION_PIN',
          saved.id,
          'PIN_ROTATED',
          actor,
          previous,
          this.pinValues(saved),
        );
        return saved;
      }
      pin = await pinRepo.save(
        pinRepo.create({
          id: randomUUID(),
          customerId,
          pinHash,
          hashAlgorithm: command.hashAlgorithm,
          pinVersion: command.pinVersion,
          failedCount: 0,
          accountLocked: false,
          lockedAt: null,
          lockReason: null,
          lastChangedAt: now,
          version: 1,
        }),
      );
      await this.audit(
        manager,
        'CUSTOMER_TRANSACTION_PIN',
        pin.id,
        'PIN_CREATED',
        actor,
        undefined,
        this.pinValues(pin),
      );
      return pin;
    });
  }

  async verifyTransactionPin(
    customerId: string,
    command: {
      pin: string;
      actor: string;
      financialBinding?: { requestHash: string; sessionId: string };
    },
    verificationService: {
      verify: (pin: string, alg: string, hash: string) => { verified: boolean };
    },
  ): Promise<{ verified: boolean; locked?: boolean; failureReason?: string; auditId?: string }> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const binding = command.financialBinding;
    if (
      binding &&
      (!/^[a-f0-9]{64}$/.test(binding.requestHash) ||
        !UUID_PATTERN.test(binding.sessionId) ||
        actor !== customerId)
    ) {
      throw new BadRequestException('Financial PIN binding is invalid');
    }
    const pin = command.pin;
    if (typeof pin !== 'string' || pin.length === 0 || pin.length > 1024) {
      return { verified: false, failureReason: 'INVALID_PIN' };
    }
    return this.dataSource.transaction(async (manager) => {
      const pinRepo = manager.getRepository(CustomerTransactionPin);
      const stored = await pinRepo.findOne({
        where: { customerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!stored || stored.deletedAt !== null)
        return { verified: false, failureReason: 'PIN_NOT_FOUND' };
      if (stored.accountLocked)
        return { verified: false, locked: true, failureReason: 'PIN_LOCKED' };
      const verified = verificationService.verify(
        pin,
        stored.hashAlgorithm,
        stored.pinHash,
      ).verified;
      if (verified) {
        if (stored.failedCount > 0) {
          stored.failedCount = 0;
          await pinRepo.save(stored);
        }
        const auditId = await this.audit(
          manager,
          'CUSTOMER_TRANSACTION_PIN',
          stored.id,
          'PIN_VERIFIED',
          actor,
          undefined,
          {
            customerId,
            pinVersion: stored.pinVersion,
            outcome: 'VERIFIED',
            ...(binding
              ? { financialRequestHash: binding.requestHash, sessionId: binding.sessionId }
              : {}),
          },
        );
        return binding ? { verified: true, auditId } : { verified: true };
      }
      const previous = this.pinValues(stored);
      stored.failedCount += 1;
      if (stored.failedCount >= MAX_FAILED_PINS) {
        stored.accountLocked = true;
        stored.lockedAt ??= new Date();
        stored.lockReason = 'Maximum failed PIN attempts reached';
      }
      const saved = await pinRepo.save(stored);
      await this.audit(
        manager,
        'CUSTOMER_TRANSACTION_PIN',
        saved.id,
        'PIN_FAILED',
        actor,
        previous,
        this.pinValues(saved),
      );
      return saved.accountLocked
        ? { verified: false, locked: true, failureReason: 'PIN_LOCKED' }
        : { verified: false, failureReason: 'MISMATCH' };
    });
  }

  async getTransactionPin(customerId: string): Promise<CustomerTransactionPin | null> {
    this.assertUuid(customerId, 'customerId');
    const pin = await this.pinRepository.findOne({ where: { customerId } });
    if (!pin || pin.deletedAt !== null) return null;
    return pin;
  }

  private pinValues(pin: CustomerTransactionPin): Record<string, unknown> {
    return {
      customerId: pin.customerId,
      hashAlgorithm: pin.hashAlgorithm,
      pinVersion: pin.pinVersion,
      failedCount: pin.failedCount,
      accountLocked: pin.accountLocked,
      version: pin.version,
      lastChangedAt: pin.lastChangedAt,
    };
  }

  private async audit(
    manager: any,
    entityType: string,
    entityId: string,
    action: string,
    actor: string,
    previousValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
  ): Promise<string> {
    const event = await this.auditService.record(manager, {
      entityType,
      entityId,
      action,
      actor,
      previousValues: previousValues ? redactRecord(previousValues) : undefined,
      newValues: newValues ? redactRecord(newValues) : undefined,
    });
    return event?.id ?? '';
  }

  private assertUuid(value: string, field: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }

  private normalizeActor(value: string): string {
    const actor = value.trim();
    if (!actor || actor.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return actor;
  }

  private normalizeHash(value: string, field: string): string {
    const hash = value.trim();
    if (!hash || hash.length > 512 || /\s/.test(hash)) {
      throw new BadRequestException(`${field} must contain 1 to 512 characters without whitespace`);
    }
    return hash;
  }
}
