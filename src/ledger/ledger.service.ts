import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Repository } from 'typeorm';

import {
  MAX_POSTGRES_BIGINT,
  minorUnitsToString,
  normalizeAccountingUnit,
  normalizeCurrency,
  parsePositiveMinorUnits,
} from '../common/money';
import { LedgerAccount } from './ledger-account.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerJournalStatus,
  LedgerNormalBalance,
} from './ledger.enums';
import { LedgerJournal } from './ledger-journal.entity';
import { LedgerLine } from './ledger-line.entity';
import type {
  CreateLedgerAccountCommand,
  JournalAndLines,
  LedgerAccountBalance,
  LedgerAccountView,
  LedgerJournalView,
  LedgerLineView,
  PostJournalCommand,
  PostJournalLineCommand,
} from './ledger.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS';

type NormalizedJournalLine = Omit<PostJournalLineCommand, 'amountMinor'> & {
  amountMinor: bigint;
};

type NormalizedJournal = Omit<PostJournalCommand, 'lines' | 'accountingUnit' | 'currency'> & {
  currency: string;
  accountingUnit: string;
  lines: NormalizedJournalLine[];
  totalMinor: bigint;
  requestHash: string;
};

type AccountBalanceRow = {
  ledger_account_id: string;
  direction: LedgerEntryDirection;
  amount_minor: string;
};

@Injectable()
export class LedgerService {
  constructor(
    @InjectRepository(LedgerAccount)
    private readonly accountRepository: Repository<LedgerAccount>,
    @InjectRepository(LedgerJournal)
    private readonly journalRepository: Repository<LedgerJournal>,
    @InjectRepository(LedgerLine)
    private readonly lineRepository: Repository<LedgerLine>,
    private readonly dataSource: DataSource,
  ) {}

  async createAccount(command: CreateLedgerAccountCommand): Promise<LedgerAccountView> {
    const accountType = command.accountType;
    const normalBalance = command.normalBalance ?? this.normalBalanceFor(accountType);
    const expectedNormalBalance = this.normalBalanceFor(accountType);

    if (normalBalance !== expectedNormalBalance) {
      throw new BadRequestException(
        `${accountType} accounts must use a ${expectedNormalBalance.toLowerCase()} normal balance`,
      );
    }

    const code = command.code.trim();
    const name = command.name.trim();
    const currency = normalizeCurrency(command.currency);
    const accountingUnit = normalizeAccountingUnit(command.accountingUnit);

    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,99}$/.test(code)) {
      throw new BadRequestException(
        'code must contain 2 to 100 letters, numbers, dots, underscores, colons, or hyphens',
      );
    }

    if (name.length < 2 || name.length > 160) {
      throw new BadRequestException('name must contain between 2 and 160 characters');
    }

    try {
      const account = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(LedgerAccount);
        return repository.save(
          repository.create({
            id: randomUUID(),
            code,
            name,
            accountType,
            normalBalance,
            currency,
            accountingUnit,
            allowNegativeBalance: command.allowNegativeBalance ?? false,
            isActive: true,
          }),
        );
      });

      return this.toAccountView(account);
    } catch (error) {
      if (this.isConstraintViolation(error, 'uq_ledger_accounts_code')) {
        throw new ConflictException('A ledger account with this code already exists');
      }

      throw error;
    }
  }

  async getAccount(accountId: string): Promise<LedgerAccountView> {
    const account = await this.findAccount(accountId);
    return this.toAccountView(account);
  }

  async listAccounts(currency?: string): Promise<LedgerAccountView[]> {
    const accounts = await this.accountRepository.find({
      where: currency ? { currency: normalizeCurrency(currency) } : undefined,
      order: { code: 'ASC' },
    });

    return accounts.map((account) => this.toAccountView(account));
  }

  async getAccountBalance(accountId: string): Promise<LedgerAccountBalance> {
    const account = await this.findAccount(accountId);
    const balances = await this.calculateBalances([account]);
    return balances.get(account.id)!;
  }

  async getAccountBalances(accountIds: string[]): Promise<Map<string, LedgerAccountBalance>> {
    if (accountIds.length === 0) {
      return new Map();
    }

    const uniqueAccountIds = [...new Set(accountIds)];
    if (uniqueAccountIds.some((accountId) => !UUID_PATTERN.test(accountId))) {
      throw new BadRequestException('accountIds must be UUIDs');
    }

    const accounts = await this.accountRepository.findBy({ id: In(uniqueAccountIds) });
    if (accounts.length !== uniqueAccountIds.length) {
      const found = new Set(accounts.map((account) => account.id));
      const missing = uniqueAccountIds.find((id) => !found.has(id));
      throw new NotFoundException(`Ledger account ${missing ?? 'requested'} was not found`);
    }

    return this.calculateBalances(accounts);
  }

  async postJournal(command: PostJournalCommand): Promise<LedgerJournalView> {
    const normalized = this.normalizeJournal(command);
    let journalId: string | undefined;

    for (let attempt = 0; attempt < 3 && journalId === undefined; attempt += 1) {
      try {
        journalId = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          return this.postWithinTransaction(manager, normalized);
        });
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) {
          continue;
        }

        // A concurrent request with the same idempotency key can win the unique
        // insert race. The committed winner is the deterministic result for the
        // retry, so return it after comparing the request fingerprint.
        if (this.isConstraintViolation(error, 'uq_ledger_journals_idempotency_key')) {
          const existing = await this.journalRepository.findOne({
            where: { idempotencyKey: normalized.idempotencyKey },
          });
          if (existing && existing.requestHash === normalized.requestHash) {
            journalId = existing.id;
          } else {
            throw new ConflictException('The idempotency key was already used for another journal');
          }
        } else if (this.isConstraintViolation(error, 'uq_ledger_journals_reversal_of')) {
          throw new ConflictException('This journal has already been reversed');
        } else {
          throw error;
        }
      }
    }

    if (!journalId) {
      throw new ConflictException('The journal could not be posted after concurrent retries');
    }

    return this.getJournal(journalId);
  }

  async reverseJournal(
    journalId: string,
    idempotencyKey: string,
    reason?: string,
  ): Promise<LedgerJournalView> {
    const original = await this.findJournalAndLines(journalId);
    const normalizedIdempotencyKey = idempotencyKey.trim();
    const existingByKey = await this.journalRepository.findOne({
      where: { idempotencyKey: normalizedIdempotencyKey },
    });
    if (existingByKey) {
      if (existingByKey.reversalOfJournalId === journalId) {
        return this.getJournal(existingByKey.id);
      }
      throw new ConflictException('The idempotency key was already used for another journal');
    }

    if (original.journal.reversalOfJournalId) {
      throw new ConflictException('A reversal cannot itself be reversed');
    }

    const existingReversal = await this.journalRepository.findOne({
      where: { reversalOfJournalId: journalId },
    });
    if (existingReversal) {
      throw new ConflictException('This journal has already been reversed');
    }

    return this.postJournal({
      idempotencyKey: normalizedIdempotencyKey,
      currency: original.journal.currency,
      accountingUnit: original.journal.accountingUnit,
      reference: original.journal.reference ?? undefined,
      description: reason?.trim() || `Reversal of journal ${journalId}`,
      correlationId: original.journal.correlationId ?? undefined,
      metadata: {
        ...original.journal.metadata,
        reversalOfJournalId: journalId,
        reversalReason: reason?.trim() || undefined,
      },
      reversalOfJournalId: journalId,
      lines: original.lines.map((line) => ({
        accountId: line.ledgerAccountId,
        direction:
          line.direction === LedgerEntryDirection.DEBIT
            ? LedgerEntryDirection.CREDIT
            : LedgerEntryDirection.DEBIT,
        amountMinor: line.amountMinor,
      })),
    });
  }

  async getJournal(journalId: string): Promise<LedgerJournalView> {
    const journalAndLines = await this.findJournalAndLines(journalId);
    return this.toJournalView(journalAndLines);
  }

  private async postWithinTransaction(
    manager: EntityManager,
    command: NormalizedJournal,
  ): Promise<string> {
    const journalRepository = manager.getRepository(LedgerJournal);
    const existing = await journalRepository.findOne({
      where: { idempotencyKey: command.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another journal');
      }

      return existing.id;
    }

    const accountIds = [...new Set(command.lines.map((line) => line.accountId))].sort();
    const accounts = await this.lockAccounts(manager, accountIds);
    const accountsById = new Map(accounts.map((account) => [account.id, account]));

    for (const accountId of accountIds) {
      const account = accountsById.get(accountId);
      if (!account) {
        throw new NotFoundException(`Ledger account ${accountId} was not found`);
      }
      if (!account.isActive) {
        throw new ConflictException(`Ledger account ${accountId} is inactive`);
      }
      if (
        account.currency !== command.currency ||
        account.accountingUnit !== command.accountingUnit
      ) {
        throw new ConflictException(
          `Ledger account ${accountId} does not belong to the journal currency and accounting unit`,
        );
      }
    }

    const currentBalances = await this.calculateBalancesWithManager(manager, accounts);
    const projectedBalances = new Map<string, bigint>();
    for (const account of accounts) {
      projectedBalances.set(
        account.id,
        BigInt(currentBalances.get(account.id)?.balanceMinor ?? '0'),
      );
    }

    for (const line of command.lines) {
      const account = accountsById.get(line.accountId)!;
      const signedAmount = this.isNormalDirection(line.direction, account.normalBalance)
        ? line.amountMinor
        : -line.amountMinor;
      const projected = (projectedBalances.get(account.id) ?? 0n) + signedAmount;
      projectedBalances.set(account.id, projected);
    }

    for (const account of accounts) {
      const projected = projectedBalances.get(account.id) ?? 0n;
      if (!account.allowNegativeBalance && projected < 0n) {
        throw new UnprocessableEntityException(
          `Ledger account ${account.id} does not have sufficient balance for this journal`,
        );
      }
    }

    if (command.reversalOfJournalId) {
      const original = await journalRepository.findOne({
        where: { id: command.reversalOfJournalId },
      });
      if (!original) {
        throw new NotFoundException(`Journal ${command.reversalOfJournalId} was not found`);
      }
      if (original.reversalOfJournalId) {
        throw new ConflictException('A reversal cannot itself be reversed');
      }
    }

    const journal = journalRepository.create({
      id: randomUUID(),
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      currency: command.currency,
      accountingUnit: command.accountingUnit,
      status: LedgerJournalStatus.POSTED,
      reference: command.reference ?? null,
      description: command.description ?? null,
      correlationId: command.correlationId ?? null,
      reversalOfJournalId: command.reversalOfJournalId ?? null,
      metadata: command.metadata ?? {},
      totalMinor: command.totalMinor.toString(),
      postedAt: new Date(),
    });
    await journalRepository.save(journal);

    const lineRepository = manager.getRepository(LedgerLine);
    const lines = command.lines.map((line, index) =>
      lineRepository.create({
        id: randomUUID(),
        journalId: journal.id,
        ledgerAccountId: line.accountId,
        lineNumber: index + 1,
        direction: line.direction,
        amountMinor: line.amountMinor.toString(),
        currency: command.currency,
        accountingUnit: command.accountingUnit,
      }),
    );
    await lineRepository.save(lines);

    return journal.id;
  }

  private async lockAccounts(
    manager: EntityManager,
    accountIds: string[],
  ): Promise<LedgerAccount[]> {
    return manager
      .getRepository(LedgerAccount)
      .createQueryBuilder('account')
      .where('account.id IN (:...accountIds)', { accountIds })
      .orderBy('account.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  private async findAccount(accountId: string): Promise<LedgerAccount> {
    if (!UUID_PATTERN.test(accountId)) {
      throw new BadRequestException('accountId must be a UUID');
    }

    const account = await this.accountRepository.findOne({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException(`Ledger account ${accountId} was not found`);
    }

    return account;
  }

  private async findJournalAndLines(journalId: string): Promise<JournalAndLines> {
    if (!UUID_PATTERN.test(journalId)) {
      throw new BadRequestException('journalId must be a UUID');
    }

    const journal = await this.journalRepository.findOne({ where: { id: journalId } });
    if (!journal) {
      throw new NotFoundException(`Journal ${journalId} was not found`);
    }

    const lines = await this.lineRepository.find({
      where: { journalId },
      order: { lineNumber: 'ASC' },
    });

    return { journal, lines };
  }

  private async calculateBalances(
    accounts: LedgerAccount[],
  ): Promise<Map<string, LedgerAccountBalance>> {
    return this.calculateBalancesWithQuery(async (accountIds) => {
      return this.dataSource.query(
        `SELECT ledger_account_id, direction, amount_minor::text AS amount_minor
           FROM ledger_lines
          WHERE ledger_account_id = ANY($1::uuid[])
          ORDER BY ledger_account_id, line_number`,
        [accountIds],
      );
    }, accounts);
  }

  private async calculateBalancesWithManager(
    manager: EntityManager,
    accounts: LedgerAccount[],
  ): Promise<Map<string, LedgerAccountBalance>> {
    return this.calculateBalancesWithQuery(async (accountIds) => {
      return manager.query(
        `SELECT ledger_account_id, direction, amount_minor::text AS amount_minor
          FROM ledger_lines
         WHERE ledger_account_id = ANY($1::uuid[])
         ORDER BY ledger_account_id, line_number`,
        [accountIds],
      );
    }, accounts);
  }

  private async calculateBalancesWithQuery(
    query: (accountIds: string[]) => Promise<AccountBalanceRow[]>,
    accounts: LedgerAccount[],
  ): Promise<Map<string, LedgerAccountBalance>> {
    const balances = new Map<string, bigint>(accounts.map((account) => [account.id, 0n]));
    const rows = await query(accounts.map((account) => account.id));

    for (const row of rows) {
      const account = accounts.find((candidate) => candidate.id === row.ledger_account_id);
      if (!account) {
        continue;
      }

      const amount = BigInt(row.amount_minor);
      const current = balances.get(account.id) ?? 0n;
      balances.set(
        account.id,
        current + (this.isNormalDirection(row.direction, account.normalBalance) ? amount : -amount),
      );
    }

    return new Map(
      accounts.map((account) => [
        account.id,
        {
          accountId: account.id,
          currency: account.currency,
          accountingUnit: account.accountingUnit,
          balanceMinor: (balances.get(account.id) ?? 0n).toString(),
        },
      ]),
    );
  }

  private normalizeJournal(command: PostJournalCommand): NormalizedJournal {
    const idempotencyKey = command.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException(
        'idempotencyKey is required and must be at most 255 characters',
      );
    }

    if (!Array.isArray(command.lines) || command.lines.length < 2 || command.lines.length > 100) {
      throw new BadRequestException('A journal must contain between 2 and 100 lines');
    }

    const currency = normalizeCurrency(command.currency);
    const accountingUnit = normalizeAccountingUnit(
      command.accountingUnit ?? DEFAULT_ACCOUNTING_UNIT,
    );
    let debitTotal = 0n;
    let creditTotal = 0n;

    const lines = command.lines.map((line, index) => {
      if (!UUID_PATTERN.test(line.accountId)) {
        throw new BadRequestException(`lines[${index}].accountId must be a UUID`);
      }
      if (
        line.direction !== LedgerEntryDirection.DEBIT &&
        line.direction !== LedgerEntryDirection.CREDIT
      ) {
        throw new BadRequestException(`lines[${index}].direction must be DEBIT or CREDIT`);
      }

      const amountMinor = parsePositiveMinorUnits(line.amountMinor, `lines[${index}].amountMinor`);
      if (line.direction === LedgerEntryDirection.DEBIT) {
        debitTotal += amountMinor;
      } else {
        creditTotal += amountMinor;
      }

      return { accountId: line.accountId, direction: line.direction, amountMinor };
    });

    if (debitTotal !== creditTotal) {
      throw new BadRequestException('A journal must have equal total debits and credits');
    }
    if (debitTotal > MAX_POSTGRES_BIGINT) {
      throw new BadRequestException('A journal total must fit in a PostgreSQL BIGINT');
    }

    const reference = this.optionalText(command.reference, 'reference');
    const description = this.optionalText(command.description, 'description');
    const correlationId = this.optionalText(command.correlationId, 'correlationId');
    const metadata = this.normalizedMetadata(command.metadata);
    const reversalOfJournalId = command.reversalOfJournalId;
    if (reversalOfJournalId !== undefined && !UUID_PATTERN.test(reversalOfJournalId)) {
      throw new BadRequestException('reversalOfJournalId must be a UUID');
    }

    const requestHash = createHash('sha256')
      .update(
        this.canonicalJson({
          currency,
          accountingUnit,
          reference: reference ?? null,
          description: description ?? null,
          correlationId: correlationId ?? null,
          metadata,
          reversalOfJournalId: reversalOfJournalId ?? null,
          lines: [...lines]
            .map((line) => ({
              accountId: line.accountId,
              direction: line.direction,
              amountMinor: line.amountMinor.toString(),
            }))
            .sort((left, right) => {
              const leftJson = JSON.stringify(left);
              const rightJson = JSON.stringify(right);
              return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
            }),
        }),
      )
      .digest('hex');

    return {
      idempotencyKey,
      currency,
      accountingUnit,
      reference,
      description,
      correlationId,
      metadata,
      reversalOfJournalId,
      lines,
      totalMinor: debitTotal,
      requestHash,
    };
  }

  private optionalText(value: string | undefined, fieldName: string): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const normalized = value.trim();
    if (normalized.length === 0) {
      return undefined;
    }
    if (normalized.length > 255) {
      throw new BadRequestException(`${fieldName} must be at most 255 characters`);
    }

    return normalized;
  }

  private normalizedMetadata(
    metadata: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (metadata === undefined) {
      return {};
    }
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      throw new BadRequestException('metadata must be a JSON object no larger than 32 KB');
    }

    try {
      const serialized = JSON.stringify(metadata);
      if (serialized === undefined || serialized.length > 32_768) {
        throw new Error('metadata is too large');
      }
      JSON.parse(serialized) as unknown;
    } catch {
      throw new BadRequestException('metadata must be a JSON object no larger than 32 KB');
    }

    return metadata;
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }

    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`)
      .join(',')}}`;
  }

  private isNormalDirection(
    direction: LedgerEntryDirection,
    normalBalance: LedgerNormalBalance,
  ): boolean {
    return direction === (normalBalance as unknown as LedgerEntryDirection);
  }

  private normalBalanceFor(accountType: LedgerAccountType): LedgerNormalBalance {
    return accountType === LedgerAccountType.ASSET || accountType === LedgerAccountType.EXPENSE
      ? LedgerNormalBalance.DEBIT
      : LedgerNormalBalance.CREDIT;
  }

  private toAccountView(account: LedgerAccount): LedgerAccountView {
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      accountType: account.accountType,
      normalBalance: account.normalBalance,
      currency: account.currency,
      accountingUnit: account.accountingUnit,
      allowNegativeBalance: account.allowNegativeBalance,
      isActive: account.isActive,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  private toJournalView(journalAndLines: JournalAndLines): LedgerJournalView {
    const { journal, lines } = journalAndLines;
    const lineViews: LedgerLineView[] = lines.map((line) => ({
      id: line.id,
      journalId: line.journalId,
      accountId: line.ledgerAccountId,
      lineNumber: line.lineNumber,
      direction: line.direction,
      amountMinor: minorUnitsToString(line.amountMinor),
      currency: line.currency,
      accountingUnit: line.accountingUnit,
      createdAt: line.createdAt,
    }));

    return {
      id: journal.id,
      idempotencyKey: journal.idempotencyKey,
      currency: journal.currency,
      accountingUnit: journal.accountingUnit,
      status: journal.status,
      reference: journal.reference,
      description: journal.description,
      correlationId: journal.correlationId,
      reversalOfJournalId: journal.reversalOfJournalId,
      metadata: journal.metadata,
      totalMinor: minorUnitsToString(journal.totalMinor),
      createdAt: journal.createdAt,
      postedAt: journal.postedAt,
      lines: lineViews,
    };
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { code?: string };
    return driverError.code === '40001' || driverError.code === '40P01';
  }

  private isConstraintViolation(error: unknown, constraintName: string): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { constraint?: string; code?: string };
    return driverError.code === '23505' && driverError.constraint === constraintName;
  }
}
