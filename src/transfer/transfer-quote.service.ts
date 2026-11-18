import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentService, normalizeAgentService } from '../agent/agent-service.enum';
import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { PaymentReferenceService } from '../payment/payment-reference.service';
import { PaymentType } from '../payment/payment.enums';
import { paymentRequestHash, UUID_PATTERN } from '../payment/payment-support';
import { PaymentQuote } from '../quote/payment-quote.entity';
import { PaymentQuoteStatus, QuotePaymentType } from '../quote/quote.enums';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletFinancialBoundaryService } from '../wallet/wallet-financial-boundary.service';
import { WalletOwnerClass, WalletStatus } from '../wallet/wallet.enums';
import { assertWalletOwnership } from '../wallet/wallet-ownership';
import { resolveTransferParticipants, type TransferParticipant } from './transfer-participant';
import { TransferPricingService } from './transfer-pricing.service';
import { requireTransferProduct } from './transfer-product';

const QUOTE_LIFETIME_MS = 5 * 60 * 1000;

export interface TransferQuoteView {
  quoteId: string;
  sourceWalletId: string;
  destinationWalletId: string;
  recipientType: 'CUSTOMER' | 'AGENT';
  recipientId: string;
  amountMinor: string;
  currency: string;
  feeMinor: string;
  vatMinor: string;
  totalDebitMinor: string;
  expiresAt: Date;
  status: PaymentQuoteStatus;
}

export interface LockedTransferQuote extends TransferQuoteView {
  principalType: 'CUSTOMER' | 'AGENT';
  principalId: string;
  sessionId: string;
  sourceLedgerId: string;
  destinationLedgerId: string;
  institutionId: string | null;
  pricingHash: string;
  transferId: string | null;
}

/** Enforce the same explicit agent-class service vocabulary inside the locked transaction. */
export function requireAgentWalletTransferCapability(participant: TransferParticipant): void {
  if (participant.type !== 'AGENT') return;
  if (!Array.isArray(participant.agentServices) || participant.agentServices.length === 0) {
    throw new ForbiddenException('Agent wallet transfer capability is unavailable');
  }
  const services = participant.agentServices.map((entry: unknown) => normalizeAgentService(entry));
  if (
    services.some((service) => service === null) ||
    !services.includes(AgentService.WALLET_TRANSFER)
  ) {
    throw new ForbiddenException('Agent wallet transfer capability is unavailable');
  }
}

/**
 * Creates an authenticated, wallet-bound quote using the existing payment-quote records.
 * This is not an authorization to move money. The final PIN and quote consumption must be
 * checked again inside the shared transfer transaction.
 */
@Injectable()
export class TransferQuoteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly pricing: TransferPricingService,
    private readonly references: PaymentReferenceService,
    private readonly boundary: WalletFinancialBoundaryService,
  ) {}

  async create(
    principal: AuthorizationPrincipal,
    input: {
      sourceWalletId?: string;
      destinationWalletId: string;
      amountMinor: string;
      currency: string;
      idempotencyKey: string;
    },
  ): Promise<TransferQuoteView> {
    if (!principal || (principal.type !== 'CUSTOMER' && principal.type !== 'AGENT'))
      throw new UnauthorizedException('Self session required');
    const ownerId = principal.type === 'CUSTOMER' ? principal.customerId : principal.agentId;
    if (
      !ownerId ||
      !UUID_PATTERN.test(ownerId) ||
      !principal.sessionId ||
      !UUID_PATTERN.test(principal.sessionId)
    ) {
      throw new UnauthorizedException('Self session required');
    }
    const destinationId = input.destinationWalletId?.trim().toLowerCase();
    if (!destinationId || !UUID_PATTERN.test(destinationId))
      throw new BadRequestException('Destination wallet is invalid');
    const sourceId = input.sourceWalletId?.trim().toLowerCase();
    if (principal.type === 'CUSTOMER' && (!sourceId || !UUID_PATTERN.test(sourceId)))
      throw new BadRequestException('Source wallet is invalid');
    if (principal.type === 'AGENT' && sourceId)
      throw new BadRequestException('Agent source wallet is derived from the session');
    const currency = normalizeCurrency(input.currency);
    const amountMinor = parsePositiveMinorUnits(input.amountMinor, 'amountMinor').toString();
    const key = input.idempotencyKey?.trim();
    if (!key || key.length > 255) throw new BadRequestException('Idempotency key is required');
    const quoteKey = `wallet-transfer-quote:${createHash('sha256').update(`${principal.type}:${ownerId.toLowerCase()}:${key}`).digest('hex')}`;
    const requestHash = paymentRequestHash({
      principalType: principal.type,
      ownerId: ownerId.toLowerCase(),
      sessionId: principal.sessionId.toLowerCase(),
      sourceId: sourceId ?? null,
      destinationId,
      currency,
      amountMinor,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          const sessionExpiry = await this.lockSession(
            manager,
            principal.type as 'CUSTOMER' | 'AGENT',
            ownerId,
            principal.sessionId!,
          );
          const existing = await manager.query<
            Array<{
              id: string;
              request_hash: string;
              status: PaymentQuoteStatus;
              expires_at: Date;
              source_wallet_id: string;
              destination_wallet_id: string;
              recipient_type: 'CUSTOMER' | 'AGENT';
              recipient_id: string;
              amount_minor: string;
              currency: string;
              fee_minor: string;
              vat_minor: string;
              total_minor: string;
              session_id: string;
            }>
          >(
            `SELECT q.id,q.request_hash,q.status,q.expires_at,b.session_id,b.source_wallet_id,b.destination_wallet_id,b.recipient_type,b.recipient_id,
                     q.amount_minor::text,q.currency,q.fee_minor::text,q.vat_minor::text,q.total_minor::text
                FROM payment_quotes q JOIN wallet_transfer_quote_bindings b ON b.quote_id=q.id
               WHERE q.idempotency_key=$1 AND b.principal_type=$2 AND b.principal_id=$3`,
            [quoteKey, principal.type, ownerId],
          );
          if (existing.length) {
            const quote = existing[0]!;
            if (
              quote.session_id.toLowerCase() !== principal.sessionId!.toLowerCase() ||
              quote.request_hash !== requestHash
            )
              throw new ConflictException('Idempotency key already used for another quote');
            return {
              quoteId: quote.id,
              sourceWalletId: quote.source_wallet_id,
              destinationWalletId: quote.destination_wallet_id,
              recipientType: quote.recipient_type,
              recipientId: quote.recipient_id,
              amountMinor: quote.amount_minor,
              currency: quote.currency,
              feeMinor: quote.fee_minor,
              vatMinor: quote.vat_minor,
              totalDebitMinor: quote.total_minor,
              expiresAt: quote.expires_at,
              status:
                quote.status === PaymentQuoteStatus.ACTIVE &&
                quote.expires_at.getTime() <= Date.now()
                  ? PaymentQuoteStatus.EXPIRED
                  : quote.status,
            };
          }
          let actualSourceId = sourceId;
          if (principal.type === 'AGENT') {
            const candidates = await manager.getRepository(WalletAccount).find({
              where: { customerId: ownerId, currency, ownerClass: WalletOwnerClass.AGENT },
            });
            if (candidates.length !== 1)
              throw new NotFoundException('Agent operating wallet unavailable');
            actualSourceId = candidates[0]!.id;
          }
          if (actualSourceId === destinationId)
            throw new BadRequestException('Source and destination wallets must be different');
          const locked = await manager
            .getRepository(WalletAccount)
            .createQueryBuilder('wallet')
            .where('wallet.id IN (:...ids)', { ids: [actualSourceId, destinationId] })
            .orderBy('wallet.id', 'ASC')
            .setLock('pessimistic_write')
            .getMany();
          const byId = new Map(locked.map((wallet) => [wallet.id, wallet]));
          const source = byId.get(actualSourceId!);
          const destination = byId.get(destinationId);
          if (!source || !destination) throw new NotFoundException('Wallet not found');
          assertWalletOwnership(
            principal.type === 'AGENT'
              ? { kind: 'AGENT_SELF', agentId: ownerId }
              : { kind: 'CUSTOMER_SELF', customerId: ownerId },
            source.customerId,
            source.ownerClass,
          );
          const participants = await resolveTransferParticipants(manager, [source, destination]);
          if (!participants) throw new ConflictException('Wallet ownership is unavailable');
          requireAgentWalletTransferCapability(participants[0]);
          requireAgentWalletTransferCapability(participants[1]);
          if (
            source.status !== WalletStatus.ACTIVE ||
            destination.status !== WalletStatus.ACTIVE ||
            source.currency !== currency ||
            destination.currency !== currency
          )
            throw new ConflictException('Wallet is not eligible for this currency');
          if ((source.institutionId ?? null) !== (destination.institutionId ?? null))
            throw new ConflictException('Institutional wallet context is unavailable');
          await this.boundary.requireAccounts(manager, [
            source.ledgerAccountId,
            destination.ledgerAccountId,
          ]);
          await requireTransferProduct(manager, currency);
          const price = await this.pricing.priceWithManager(manager, { amountMinor, currency });
          const quoteId = randomUUID();
          const reference = await this.references.nextReference(
            manager,
            PaymentType.QUOTE,
            quoteId,
          );
          const expiresAt = new Date(
            Math.min(Date.now() + QUOTE_LIFETIME_MS, sessionExpiry.getTime()),
          );
          if (expiresAt.getTime() <= Date.now())
            throw new UnauthorizedException('Session has expired');
          await manager.getRepository(PaymentQuote).save(
            manager.getRepository(PaymentQuote).create({
              id: quoteId,
              quoteReference: reference,
              paymentType: QuotePaymentType.TRANSFER,
              amountMinor,
              currency,
              feeMinor: price.feeMinor,
              vatMinor: price.vatMinor,
              totalMinor: price.totalDebitMinor,
              status: PaymentQuoteStatus.ACTIVE,
              idempotencyKey: quoteKey,
              requestHash,
              expiresAt,
              usedAt: null,
            }),
          );
          await manager.query(
            `INSERT INTO wallet_transfer_quote_bindings
            (quote_id,principal_type,principal_id,session_id,source_wallet_id,source_ledger_id,destination_wallet_id,destination_ledger_id,recipient_type,recipient_id,institution_id,pricing_hash)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              quoteId,
              principal.type,
              ownerId,
              principal.sessionId,
              source.id,
              source.ledgerAccountId,
              destination.id,
              destination.ledgerAccountId,
              participants[1].type,
              participants[1].id,
              source.institutionId ?? null,
              price.pricingHash,
            ],
          );
          return {
            quoteId,
            sourceWalletId: source.id,
            destinationWalletId: destination.id,
            recipientType: participants[1].type,
            recipientId: participants[1].id,
            amountMinor,
            currency,
            feeMinor: price.feeMinor,
            vatMinor: price.vatMinor,
            totalDebitMinor: price.totalDebitMinor,
            expiresAt,
            status: PaymentQuoteStatus.ACTIVE,
          };
        });
      } catch (error) {
        const driver =
          error instanceof QueryFailedError
            ? (error.driverError as { code?: string; constraint?: string })
            : null;
        const retryable =
          driver?.code === '40001' ||
          driver?.code === '40P01' ||
          (driver?.code === '23505' && driver.constraint === 'uq_payment_quotes_idempotency_key');
        if (!retryable) throw error;
        if (attempt === 2) {
          throw new ConflictException({
            code: 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED',
            message: 'Quote creation is contended; retry with the same idempotency key',
          });
        }
      }
    }
    throw new ConflictException('Could not create quote due to contention');
  }

  /** Locks the bound quote and its live session. Replay may inspect USED quotes but cannot reuse them. */
  async lockForSession(
    manager: EntityManager,
    principal: AuthorizationPrincipal,
    quoteId: string,
  ): Promise<LockedTransferQuote> {
    const type = principal?.type;
    const ownerId =
      type === 'CUSTOMER' ? principal.customerId : type === 'AGENT' ? principal.agentId : undefined;
    if (
      !ownerId ||
      !principal.sessionId ||
      !UUID_PATTERN.test(ownerId) ||
      !UUID_PATTERN.test(principal.sessionId)
    )
      throw new UnauthorizedException('Self session required');
    if (!UUID_PATTERN.test(quoteId)) throw new BadRequestException('Quote id is invalid');
    await this.lockSession(manager, type as 'CUSTOMER' | 'AGENT', ownerId, principal.sessionId);
    const rows = await manager.query<
      Array<{
        id: string;
        status: PaymentQuoteStatus;
        expires_at: Date;
        amount_minor: string;
        currency: string;
        fee_minor: string;
        vat_minor: string;
        total_minor: string;
        principal_type: 'CUSTOMER' | 'AGENT';
        principal_id: string;
        session_id: string;
        source_wallet_id: string;
        source_ledger_id: string;
        destination_wallet_id: string;
        destination_ledger_id: string;
        recipient_type: 'CUSTOMER' | 'AGENT';
        recipient_id: string;
        institution_id: string | null;
        pricing_hash: string;
        transfer_id: string | null;
      }>
    >(
      `SELECT q.id,q.status,q.expires_at,q.amount_minor::text,q.currency,q.fee_minor::text,q.vat_minor::text,q.total_minor::text,
                b.principal_type,b.principal_id,b.session_id,b.source_wallet_id,b.source_ledger_id,b.destination_wallet_id,
                b.destination_ledger_id,b.recipient_type,b.recipient_id,b.institution_id,b.pricing_hash,b.transfer_id
           FROM payment_quotes q JOIN wallet_transfer_quote_bindings b ON b.quote_id=q.id
          WHERE q.id=$1 AND b.principal_type=$2 AND b.principal_id=$3 AND b.session_id=$4 FOR UPDATE OF q,b`,
      [quoteId, type, ownerId, principal.sessionId],
    );
    if (rows.length !== 1) throw new NotFoundException('Transfer quote not found');
    const r = rows[0]!;
    return {
      quoteId: r.id,
      status: r.status,
      expiresAt: r.expires_at,
      amountMinor: r.amount_minor,
      currency: r.currency,
      feeMinor: r.fee_minor,
      vatMinor: r.vat_minor,
      totalDebitMinor: r.total_minor,
      principalType: r.principal_type,
      principalId: r.principal_id,
      sessionId: r.session_id,
      sourceWalletId: r.source_wallet_id,
      sourceLedgerId: r.source_ledger_id,
      destinationWalletId: r.destination_wallet_id,
      destinationLedgerId: r.destination_ledger_id,
      recipientType: r.recipient_type,
      recipientId: r.recipient_id,
      institutionId: r.institution_id,
      pricingHash: r.pricing_hash,
      transferId: r.transfer_id,
    };
  }

  async readForSession(
    principal: AuthorizationPrincipal,
    quoteId: string,
  ): Promise<LockedTransferQuote> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.lockForSession(manager, principal, quoteId),
        );
      } catch (error) {
        const driver =
          error instanceof QueryFailedError ? (error.driverError as { code?: string }) : null;
        if (driver?.code !== '40001' && driver?.code !== '40P01') throw error;
        if (attempt === 2)
          throw new ConflictException({
            code: 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED',
            message: 'Quote is contended; retry with the same idempotency key',
          });
      }
    }
    throw new ConflictException('Quote is contended');
  }

  /** Link and use a quote only after its matching completed transfer is persisted in this transaction. */
  async consumeWithManager(
    manager: EntityManager,
    quoteId: string,
    transferId: string,
  ): Promise<void> {
    const bound = await manager.query<Array<{ quote_id: string }>>(
      `WITH updated AS (UPDATE wallet_transfer_quote_bindings SET transfer_id=$2 WHERE quote_id=$1 AND transfer_id IS NULL RETURNING quote_id) SELECT quote_id FROM updated`,
      [quoteId, transferId],
    );
    if (bound.length !== 1) throw new ConflictException('Transfer quote is already consumed');
    const used = await manager.query<Array<{ id: string }>>(
      `WITH updated AS (UPDATE payment_quotes SET status='USED',used_at=clock_timestamp() WHERE id=$1 AND status='ACTIVE' RETURNING id) SELECT id FROM updated`,
      [quoteId],
    );
    if (used.length !== 1) throw new ConflictException('Transfer quote is not active');
  }

  private async lockSession(
    manager: EntityManager,
    type: 'CUSTOMER' | 'AGENT',
    ownerId: string,
    sessionId: string,
  ): Promise<Date> {
    const rows =
      type === 'AGENT'
        ? await manager.query<Array<{ expires_at: Date }>>(
            `SELECT expires_at FROM agent_authentication_sessions WHERE id=$1 AND agent_id=$2 AND audience='agent-api' AND status='ACTIVE' AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
            [sessionId, ownerId],
          )
        : await manager.query<Array<{ expires_at: Date }>>(
            `SELECT expires_at FROM authentication_sessions WHERE id=$1 AND customer_id=$2 AND audience='customer-api' AND status='ACTIVE' AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
            [sessionId, ownerId],
          );
    if (rows.length !== 1) throw new UnauthorizedException('Session is no longer active');
    // Lock and revalidate the credential, not just the session row. A session can remain
    // ACTIVE after an out-of-band credential lock, expiry, rotation or soft deletion.
    const credential =
      type === 'CUSTOMER'
        ? await manager.query<Array<{ id: string }>>(
            `SELECT c.id FROM customer_authentication_credentials c JOIN authentication_sessions s
             ON s.credential_id=c.id AND s.customer_id=c.customer_id
            WHERE s.id=$1 AND c.deleted_at IS NULL AND c.status='ACTIVE' AND NOT c.account_locked
              AND NOT c.rotation_required AND c.password_version=s.onboarding_password_version
              AND (c.password_expires_at IS NULL OR c.password_expires_at>clock_timestamp()) FOR SHARE OF c`,
            [sessionId],
          )
        : await manager.query<Array<{ id: string }>>(
            `SELECT c.id FROM agent_authentication_credentials c JOIN agent_authentication_sessions s
             ON s.credential_id=c.id AND s.agent_id=c.agent_id
            WHERE s.id=$1 AND c.deleted_at IS NULL AND c.status='ACTIVE' AND NOT c.account_locked
              AND NOT c.rotation_required AND date_trunc('milliseconds',s.issued_at)>=date_trunc('milliseconds',c.password_changed_at)
              AND (c.password_expires_at IS NULL OR c.password_expires_at>clock_timestamp()) FOR SHARE OF c`,
            [sessionId],
          );
    if (credential.length !== 1)
      throw new UnauthorizedException('Session credential is no longer active');
    return rows[0]!.expires_at;
  }
}
