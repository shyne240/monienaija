import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { AuditService } from '../operations/audit.service';
import { CustomerFundingInstrument } from './customer-funding-instrument.entity';
import {
  CustomerFundingInstrumentStatus,
  FundingInstrumentHistoryAction,
  FundingInstrumentVerificationState,
} from './customer-funding-instrument.enums';
import type {
  CreateCustomerFundingInstrumentCommand,
  CustomerFundingInstrumentView,
  UpdateCustomerFundingInstrumentCommand,
  VerifyCustomerFundingInstrumentCommand,
} from './customer-funding-instrument.types';
import { FundingInstrumentHistory } from './funding-instrument-history.entity';
import { FundingInstrumentOwnership } from './funding-instrument-ownership.entity';
import { FundingInstrumentVerification } from './funding-instrument-verification.entity';

@Injectable()
export class CustomerFundingInstrumentService {
  constructor(
    @InjectRepository(CustomerFundingInstrument)
    private readonly instrumentRepository: Repository<CustomerFundingInstrument>,
    @InjectRepository(FundingInstrumentOwnership)
    private readonly ownershipRepository: Repository<FundingInstrumentOwnership>,
    @InjectRepository(FundingInstrumentVerification)
    private readonly verificationRepository: Repository<FundingInstrumentVerification>,
    @InjectRepository(FundingInstrumentHistory)
    private readonly historyRepository: Repository<FundingInstrumentHistory>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createInstrument(
    customerId: string,
    command: CreateCustomerFundingInstrumentCommand,
  ): Promise<CustomerFundingInstrumentView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const displayName = this.normalizeText(command.displayName, 'displayName', 200);
    const reference = this.normalizeReference(command.reference);
    try {
      const instrumentId = await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const repository = manager.getRepository(CustomerFundingInstrument);
        const existing = await repository.findOne({
          where: { reference },
          withDeleted: true,
        });
        if (existing) {
          throw new ConflictException(`Funding instrument reference ${reference} already exists`);
        }
        const instrument = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            type: command.type,
            displayName,
            reference,
            status: CustomerFundingInstrumentStatus.PENDING,
            verificationState: FundingInstrumentVerificationState.UNVERIFIED,
            version: 1,
            deletedAt: null,
          }),
        );
        const ownership = await manager.getRepository(FundingInstrumentOwnership).save(
          manager.getRepository(FundingInstrumentOwnership).create({
            id: randomUUID(),
            instrumentId: instrument.id,
            customerId,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_FUNDING_INSTRUMENT',
          instrument.id,
          'CREATED',
          actor,
          undefined,
          this.instrumentValues(instrument),
        );
        await this.audit(
          manager,
          'FUNDING_INSTRUMENT_OWNERSHIP',
          ownership.id,
          'CREATED',
          actor,
          undefined,
          this.ownershipValues(ownership),
        );
        await this.appendHistory(
          manager,
          instrument.id,
          FundingInstrumentHistoryAction.CREATED,
          actor,
          null,
          instrument.status,
          null,
          instrument.verificationState,
          { type: instrument.type, reference: instrument.reference },
        );
        await this.appendHistory(
          manager,
          instrument.id,
          FundingInstrumentHistoryAction.OWNERSHIP_CREATED,
          actor,
          null,
          null,
          null,
          null,
          { ownershipId: ownership.id },
        );
        return instrument.id;
      });
      return this.getInstrument(customerId, instrumentId);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`Funding instrument reference ${reference} already exists`);
      }
      throw error;
    }
  }

  async listInstruments(customerId: string): Promise<CustomerFundingInstrumentView[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const instruments = await this.instrumentRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(
      instruments
        .filter((instrument) => this.isNotDeleted(instrument.deletedAt))
        .map((instrument) => this.toView(instrument)),
    );
  }

  async getInstrument(
    customerId: string,
    instrumentId: string,
  ): Promise<CustomerFundingInstrumentView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(instrumentId, 'instrumentId');
    await this.requireCustomer(this.customerRepository, customerId);
    const instrument = await this.instrumentRepository.findOne({
      where: { id: instrumentId, customerId },
    });
    if (!instrument || !this.isNotDeleted(instrument.deletedAt)) {
      throw new NotFoundException(`Funding instrument ${instrumentId} was not found`);
    }
    return this.toView(instrument);
  }

  async updateInstrument(
    customerId: string,
    instrumentId: string,
    command: UpdateCustomerFundingInstrumentCommand,
  ): Promise<CustomerFundingInstrumentView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(instrumentId, 'instrumentId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      const repository = manager.getRepository(CustomerFundingInstrument);
      const instrument = await repository.findOne({ where: { id: instrumentId, customerId } });
      if (!instrument || !this.isNotDeleted(instrument.deletedAt)) {
        throw new NotFoundException(`Funding instrument ${instrumentId} was not found`);
      }
      if (command.version !== undefined && command.version !== instrument.version) {
        throw new ConflictException('Funding instrument version is stale');
      }
      if (command.status === CustomerFundingInstrumentStatus.VERIFIED) {
        throw new ConflictException(
          'Funding instruments must use the verification endpoint to become VERIFIED',
        );
      }
      if (instrument.status === command.status) {
        return this.toView(instrument);
      }
      this.assertStatusTransition(instrument.status, command.status);
      const previousStatus = instrument.status;
      const previousVerificationState = instrument.verificationState;
      instrument.status = command.status;
      if (command.status === CustomerFundingInstrumentStatus.REJECTED) {
        instrument.verificationState = FundingInstrumentVerificationState.REJECTED;
      } else if (command.status === CustomerFundingInstrumentStatus.PENDING) {
        instrument.verificationState = FundingInstrumentVerificationState.UNVERIFIED;
      }
      const saved = await repository.save(instrument);
      await this.audit(
        manager,
        'CUSTOMER_FUNDING_INSTRUMENT',
        saved.id,
        'STATUS_UPDATED',
        actor,
        { status: previousStatus, verificationState: previousVerificationState },
        {
          status: saved.status,
          verificationState: saved.verificationState,
          version: saved.version,
        },
      );
      await this.appendHistory(
        manager,
        saved.id,
        FundingInstrumentHistoryAction.STATUS_CHANGED,
        actor,
        previousStatus,
        saved.status,
        previousVerificationState,
        saved.verificationState,
        {},
      );
      return this.toView(saved);
    });
  }

  async verifyInstrument(
    customerId: string,
    instrumentId: string,
    command: VerifyCustomerFundingInstrumentCommand,
  ): Promise<FundingInstrumentVerification> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(instrumentId, 'instrumentId');
    const verifiedBy = this.normalizeActor(command.verifiedBy);
    const verificationMethod = this.normalizeText(
      command.verificationMethod,
      'verificationMethod',
      80,
    );
    const remarks = this.normalizeOptionalText(command.remarks, 'remarks', 500);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      const instrumentRepository = manager.getRepository(CustomerFundingInstrument);
      const instrument = await instrumentRepository.findOne({
        where: { id: instrumentId, customerId },
      });
      if (!instrument || !this.isNotDeleted(instrument.deletedAt)) {
        throw new NotFoundException(`Funding instrument ${instrumentId} was not found`);
      }
      if (instrument.status === CustomerFundingInstrumentStatus.REJECTED) {
        throw new ConflictException('Rejected funding instruments cannot become VERIFIED');
      }
      if (instrument.status === CustomerFundingInstrumentStatus.INACTIVE) {
        throw new ConflictException('Inactive funding instruments cannot be verified');
      }
      if (instrument.status === CustomerFundingInstrumentStatus.VERIFIED) {
        throw new ConflictException('Funding instrument is already VERIFIED');
      }
      if (
        instrument.status !== CustomerFundingInstrumentStatus.PENDING &&
        instrument.status !== CustomerFundingInstrumentStatus.SUSPENDED
      ) {
        throw new ConflictException('Funding instrument is not ready for verification');
      }
      const previousStatus = instrument.status;
      const previousVerificationState = instrument.verificationState;
      instrument.status = CustomerFundingInstrumentStatus.VERIFIED;
      instrument.verificationState = FundingInstrumentVerificationState.VERIFIED;
      const saved = await instrumentRepository.save(instrument);
      const verification = await manager.getRepository(FundingInstrumentVerification).save(
        manager.getRepository(FundingInstrumentVerification).create({
          id: randomUUID(),
          instrumentId: saved.id,
          verifiedBy,
          verifiedAt: new Date(),
          verificationMethod,
          remarks,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'CUSTOMER_FUNDING_INSTRUMENT',
        saved.id,
        'VERIFIED',
        verifiedBy,
        { status: previousStatus, verificationState: previousVerificationState },
        {
          status: saved.status,
          verificationState: saved.verificationState,
          version: saved.version,
        },
      );
      await this.audit(
        manager,
        'FUNDING_INSTRUMENT_VERIFICATION',
        verification.id,
        'CREATED',
        verifiedBy,
        undefined,
        this.verificationValues(verification),
      );
      await this.appendHistory(
        manager,
        saved.id,
        FundingInstrumentHistoryAction.VERIFIED,
        verifiedBy,
        previousStatus,
        saved.status,
        previousVerificationState,
        saved.verificationState,
        { verificationId: verification.id, verificationMethod },
      );
      return verification;
    });
  }

  async listHistory(customerId: string, instrumentId: string): Promise<FundingInstrumentHistory[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(instrumentId, 'instrumentId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireInstrument(this.instrumentRepository, customerId, instrumentId);
    const history = await this.historyRepository.find({ where: { instrumentId } });
    return this.sortByCreatedAt(history.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async getOwnership(
    customerId: string,
    instrumentId: string,
  ): Promise<FundingInstrumentOwnership> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(instrumentId, 'instrumentId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireInstrument(this.instrumentRepository, customerId, instrumentId);
    const ownership = await this.ownershipRepository.findOne({ where: { instrumentId } });
    if (!ownership || !this.isNotDeleted(ownership.deletedAt)) {
      throw new NotFoundException(`Ownership for funding instrument ${instrumentId} was not found`);
    }
    return ownership;
  }

  private async requireCustomer(
    repository: Repository<Customer>,
    customerId: string,
  ): Promise<Customer> {
    const customer = await repository.findOne({ where: { id: customerId } });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} was not found`);
    }
    return customer;
  }

  private async requireInstrument(
    repository: Repository<CustomerFundingInstrument>,
    customerId: string,
    instrumentId: string,
  ): Promise<CustomerFundingInstrument> {
    const instrument = await repository.findOne({ where: { id: instrumentId, customerId } });
    if (!instrument || !this.isNotDeleted(instrument.deletedAt)) {
      throw new NotFoundException(`Funding instrument ${instrumentId} was not found`);
    }
    return instrument;
  }

  private assertStatusTransition(
    current: CustomerFundingInstrumentStatus,
    next: CustomerFundingInstrumentStatus,
  ): void {
    const allowed: Record<CustomerFundingInstrumentStatus, CustomerFundingInstrumentStatus[]> = {
      [CustomerFundingInstrumentStatus.PENDING]: [
        CustomerFundingInstrumentStatus.SUSPENDED,
        CustomerFundingInstrumentStatus.INACTIVE,
        CustomerFundingInstrumentStatus.REJECTED,
      ],
      [CustomerFundingInstrumentStatus.VERIFIED]: [
        CustomerFundingInstrumentStatus.SUSPENDED,
        CustomerFundingInstrumentStatus.INACTIVE,
        CustomerFundingInstrumentStatus.REJECTED,
      ],
      [CustomerFundingInstrumentStatus.SUSPENDED]: [
        CustomerFundingInstrumentStatus.PENDING,
        CustomerFundingInstrumentStatus.INACTIVE,
        CustomerFundingInstrumentStatus.REJECTED,
      ],
      [CustomerFundingInstrumentStatus.INACTIVE]: [
        CustomerFundingInstrumentStatus.PENDING,
        CustomerFundingInstrumentStatus.REJECTED,
      ],
      [CustomerFundingInstrumentStatus.REJECTED]: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(
        `Invalid funding instrument transition from ${current} to ${next}`,
      );
    }
  }

  private async appendHistory(
    manager: EntityManager,
    instrumentId: string,
    action: FundingInstrumentHistoryAction,
    actor: string,
    previousStatus: CustomerFundingInstrumentStatus | null,
    newStatus: CustomerFundingInstrumentStatus | null,
    previousVerificationState: FundingInstrumentVerificationState | null,
    newVerificationState: FundingInstrumentVerificationState | null,
    metadata: Record<string, unknown>,
  ): Promise<FundingInstrumentHistory> {
    const history = await manager.getRepository(FundingInstrumentHistory).save(
      manager.getRepository(FundingInstrumentHistory).create({
        id: randomUUID(),
        instrumentId,
        action,
        previousStatus,
        newStatus,
        previousVerificationState,
        newVerificationState,
        actor,
        metadata,
        deletedAt: null,
      }),
    );
    await this.audit(
      manager,
      'FUNDING_INSTRUMENT_HISTORY',
      history.id,
      'CREATED',
      actor,
      undefined,
      this.historyValues(history),
    );
    return history;
  }

  private async audit(
    manager: EntityManager,
    entityType: string,
    entityId: string,
    action: string,
    actor: string,
    previousValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType,
      entityId,
      action,
      actor,
      previousValues,
      newValues,
    });
  }

  private normalizeReference(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.:-]{0,159}$/.test(normalized)) {
      throw new BadRequestException('reference must contain 1 to 160 safe characters');
    }
    return normalized;
  }

  private normalizeActor(value: string): string {
    return this.normalizeText(value, 'actor', 160);
  }

  private normalizeOptionalText(
    value: string | undefined,
    field: string,
    max: number,
  ): string | null {
    if (value === undefined) {
      return null;
    }
    const normalized = value.trim();
    if (normalized.length > max) {
      throw new BadRequestException(`${field} must contain at most ${max} characters`);
    }
    return normalized || null;
  }

  private normalizeText(value: string, field: string, max: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > max) {
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    }
    return normalized;
  }

  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }

  private isNotDeleted(value: Date | null | undefined): boolean {
    return value === null || value === undefined;
  }

  private sortByCreatedAt<T extends { createdAt: Date }>(records: T[]): T[] {
    return [...records].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  private toView(instrument: CustomerFundingInstrument): CustomerFundingInstrumentView {
    return {
      id: instrument.id,
      customerId: instrument.customerId,
      type: instrument.type,
      displayName: instrument.displayName,
      reference: instrument.reference,
      status: instrument.status,
      verificationState: instrument.verificationState,
      version: instrument.version,
      createdAt: instrument.createdAt,
      updatedAt: instrument.updatedAt,
    };
  }

  private instrumentValues(instrument: CustomerFundingInstrument): Record<string, unknown> {
    return {
      customerId: instrument.customerId,
      type: instrument.type,
      displayName: instrument.displayName,
      reference: instrument.reference,
      status: instrument.status,
      verificationState: instrument.verificationState,
      version: instrument.version,
    };
  }

  private ownershipValues(ownership: FundingInstrumentOwnership): Record<string, unknown> {
    return {
      instrumentId: ownership.instrumentId,
      customerId: ownership.customerId,
      version: ownership.version,
    };
  }

  private verificationValues(verification: FundingInstrumentVerification): Record<string, unknown> {
    return {
      instrumentId: verification.instrumentId,
      verifiedBy: verification.verifiedBy,
      verifiedAt: verification.verifiedAt,
      verificationMethod: verification.verificationMethod,
      remarks: verification.remarks,
    };
  }

  private historyValues(history: FundingInstrumentHistory): Record<string, unknown> {
    return {
      instrumentId: history.instrumentId,
      action: history.action,
      previousStatus: history.previousStatus,
      newStatus: history.newStatus,
      previousVerificationState: history.previousVerificationState,
      newVerificationState: history.newVerificationState,
      actor: history.actor,
      metadata: history.metadata,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }
}
