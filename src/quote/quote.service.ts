import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  MAX_POSTGRES_BIGINT,
  minorUnitsToString,
  normalizeCurrency,
  parseMinorUnits,
  parsePositiveMinorUnits,
} from '../common/money';
import {
  assertPaymentUuid,
  isConstraintViolation,
  paymentRequestHash,
} from '../payment/payment-support';
import { PaymentReferenceService } from '../payment/payment-reference.service';
import { PaymentType } from '../payment/payment.enums';
import { PaymentQuote } from './payment-quote.entity';
import { PaymentQuoteStatus, QuotePaymentType } from './quote.enums';
import type { CreateQuoteCommand, PaymentQuoteView } from './quote.types';

interface NormalizedQuote
  extends Omit<
    CreateQuoteCommand,
    'amountMinor' | 'feeMinor' | 'vatMinor' | 'currency' | 'expiresAt'
  > {
  amountMinor: bigint;
  feeMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  currency: string;
  expiresAt: Date;
  requestHash: string;
}

@Injectable()
export class QuoteService {
  constructor(
    @InjectRepository(PaymentQuote)
    private readonly quoteRepository: Repository<PaymentQuote>,
    private readonly dataSource: DataSource,
    private readonly paymentReferenceService: PaymentReferenceService,
  ) {}

  async create(command: CreateQuoteCommand): Promise<PaymentQuoteView> {
    const normalized = this.normalizeCreate(command);
    try {
      const id = await this.dataSource.transaction(async (manager) =>
        this.createWithin(manager, normalized),
      );
      return this.get(id);
    } catch (error) {
      if (!isConstraintViolation(error, 'uq_payment_quotes_idempotency_key')) {
        throw error;
      }
      const existing = await this.quoteRepository.findOne({
        where: { idempotencyKey: normalized.idempotencyKey },
      });
      if (!existing) {
        throw error;
      }
      if (existing.requestHash !== normalized.requestHash) {
        throw new ConflictException('The idempotency key was already used for another quote');
      }
      return this.get(existing.id);
    }
  }

  async get(id: string): Promise<PaymentQuoteView> {
    assertPaymentUuid(id, 'quoteId');
    const quote = await this.quoteRepository.findOne({ where: { id } });
    if (!quote) {
      throw new NotFoundException(`Quote ${id} was not found`);
    }
    if (quote.status === PaymentQuoteStatus.ACTIVE && quote.expiresAt.getTime() <= Date.now()) {
      quote.status = PaymentQuoteStatus.EXPIRED;
      await this.quoteRepository.save(quote);
    }
    return this.toView(quote);
  }

  async list(): Promise<PaymentQuoteView[]> {
    const quotes = await this.quoteRepository.find({ order: { createdAt: 'DESC', id: 'DESC' } });
    const views: PaymentQuoteView[] = [];
    for (const quote of quotes) {
      views.push(await this.get(quote.id));
    }
    return views;
  }

  async use(id: string): Promise<PaymentQuoteView> {
    assertPaymentUuid(id, 'quoteId');
    const quoteId = await this.dataSource.transaction(async (manager) => {
      const quote = await this.lockQuote(manager, id);
      if (!quote) {
        throw new NotFoundException(`Quote ${id} was not found`);
      }
      if (quote.status === PaymentQuoteStatus.USED) {
        return quote.id;
      }
      if (quote.status === PaymentQuoteStatus.EXPIRED) {
        throw new ConflictException('Quote has expired');
      }
      if (quote.expiresAt.getTime() <= Date.now()) {
        quote.status = PaymentQuoteStatus.EXPIRED;
        await manager.getRepository(PaymentQuote).save(quote);
        throw new ConflictException('Quote has expired');
      }
      quote.status = PaymentQuoteStatus.USED;
      quote.usedAt = new Date();
      await manager.getRepository(PaymentQuote).save(quote);
      return quote.id;
    });
    return this.get(quoteId);
  }

  private async createWithin(manager: EntityManager, command: NormalizedQuote): Promise<string> {
    const repository = manager.getRepository(PaymentQuote);
    const existing = await repository.findOne({
      where: { idempotencyKey: command.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another quote');
      }
      return existing.id;
    }
    const id = randomUUID();
    const quoteReference = await this.paymentReferenceService.nextReference(
      manager,
      PaymentType.QUOTE,
      id,
    );
    await repository.save(
      repository.create({
        id,
        quoteReference,
        paymentType: command.paymentType,
        amountMinor: command.amountMinor.toString(),
        feeMinor: command.feeMinor.toString(),
        vatMinor: command.vatMinor.toString(),
        totalMinor: command.totalMinor.toString(),
        currency: command.currency,
        status: PaymentQuoteStatus.ACTIVE,
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
        expiresAt: command.expiresAt,
        usedAt: null,
      }),
    );
    return id;
  }

  private async lockQuote(manager: EntityManager, id: string): Promise<PaymentQuote | null> {
    return manager
      .getRepository(PaymentQuote)
      .createQueryBuilder('quote')
      .where('quote.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  private normalizeCreate(command: CreateQuoteCommand): NormalizedQuote {
    const idempotencyKey = command.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException('Idempotency key is required for quote creation');
    }
    const amountMinor = parsePositiveMinorUnits(command.amountMinor, 'amountMinor');
    const feeMinor = parseMinorUnits(command.feeMinor, 'feeMinor');
    const vatMinor = parseMinorUnits(command.vatMinor, 'vatMinor');
    const totalMinor = amountMinor + feeMinor + vatMinor;
    if (totalMinor > MAX_POSTGRES_BIGINT) {
      throw new BadRequestException('Quote total must fit in a PostgreSQL BIGINT');
    }
    const currency = normalizeCurrency(command.currency);
    if (!Object.values(QuotePaymentType).includes(command.paymentType)) {
      throw new BadRequestException('Unsupported quote payment type');
    }
    const expiresAt = new Date(command.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be a future ISO timestamp');
    }
    return {
      paymentType: command.paymentType,
      amountMinor,
      feeMinor,
      vatMinor,
      totalMinor,
      currency,
      expiresAt,
      idempotencyKey,
      requestHash: paymentRequestHash({
        paymentType: command.paymentType,
        amountMinor: amountMinor.toString(),
        feeMinor: feeMinor.toString(),
        vatMinor: vatMinor.toString(),
        currency,
        expiresAt: expiresAt.toISOString(),
      }),
    };
  }

  private toView(quote: PaymentQuote): PaymentQuoteView {
    return {
      id: quote.id,
      quoteReference: quote.quoteReference,
      paymentType: quote.paymentType,
      amountMinor: minorUnitsToString(quote.amountMinor),
      feeMinor: minorUnitsToString(quote.feeMinor),
      vatMinor: minorUnitsToString(quote.vatMinor),
      totalMinor: minorUnitsToString(quote.totalMinor),
      currency: quote.currency,
      status: quote.status,
      idempotencyKey: quote.idempotencyKey,
      expiresAt: quote.expiresAt,
      usedAt: quote.usedAt,
      createdAt: quote.createdAt,
    };
  }
}
