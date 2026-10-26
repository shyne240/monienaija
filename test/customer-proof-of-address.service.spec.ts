/* eslint-disable @typescript-eslint/unbound-method */

import { createHash } from 'node:crypto';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { CustomerAddress } from '../src/customer/customer-address.entity';
import type { AuditService } from '../src/operations/audit.service';
import type { CustomerProofOfAddressDocumentHistory } from '../src/customer-proof-of-address/customer-proof-of-address-document-history.entity';
import type { ProofOfAddressConfiguration } from '../src/customer-proof-of-address/customer-proof-of-address.config';
import {
  CustomerProofOfAddressDocumentStatus,
  CustomerProofOfAddressReviewStatus,
} from '../src/customer-proof-of-address/customer-proof-of-address.enums';
import { CustomerProofOfAddressSubmission } from '../src/customer-proof-of-address/customer-proof-of-address-submission.entity';
import {
  CustomerProofOfAddressService,
  type UploadProofOfAddressCommand,
} from '../src/customer-proof-of-address/customer-proof-of-address.service';
import type { ProofOfAddressMalwareScanner } from '../src/customer-proof-of-address/clamav-malware-scanner.service';
import type { PrivateDocumentEncryptionService } from '../src/customer-proof-of-address/private-document-encryption.service';
import type { PrivateProofOfAddressStorage } from '../src/customer-proof-of-address/proof-of-address-storage.interface';

const CUSTOMER_ID = '14a2a111-a08a-4da7-8ead-0e3dbe480834';
const ADDRESS_ID = '920f2feb-4d6e-4785-a266-0ce11d177e2c';
const DOCUMENT_ID = 'c94e97f3-b646-43e6-a3ec-b752dcecb074';
const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'ascii');

describe('CustomerProofOfAddressService upload security and lifecycle boundary', () => {
  it('stores unavailable-scanner files as quarantined and never treats a clean review as implied', async () => {
    const harness = makeHarness({ scanResult: 'UNAVAILABLE' });
    const result = await harness.service.upload(CUSTOMER_ID, command());

    expect(result.replayed).toBe(false);
    expect(result.document.documentStatus).toBe(CustomerProofOfAddressDocumentStatus.QUARANTINED);
    expect(result.document.reviewStatus).toBe(CustomerProofOfAddressReviewStatus.PENDING);
    expect(harness.scanner.scan).toHaveBeenCalledTimes(1);
    expect(harness.storage.put).toHaveBeenCalledTimes(1);
    expect(harness.historyRows.map(({ action }) => action)).toEqual(['UPLOADED', 'QUARANTINED']);
    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'DOCUMENT_UPLOADED_AND_QUARANTINED' }),
    );
  });

  it('makes content available only after a clean scan while leaving documentary review pending', async () => {
    const harness = makeHarness({ scanResult: 'CLEAN' });
    const result = await harness.service.upload(CUSTOMER_ID, command());

    expect(result.document.documentStatus).toBe(CustomerProofOfAddressDocumentStatus.AVAILABLE);
    expect(result.document.reviewStatus).toBe(CustomerProofOfAddressReviewStatus.PENDING);
    expect(result.document.scannerResult).toBe('CLEAN');
    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'DOCUMENT_UPLOADED_AND_SCANNED_CLEAN' }),
    );
  });

  it('does not scan or persist when the residential address belongs to another customer', async () => {
    const harness = makeHarness({ addressFound: false });

    await expect(harness.service.upload(CUSTOMER_ID, command())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(harness.addressFindOne).toHaveBeenCalledTimes(1);
    const addressQuery = harness.addressQueries[0] as {
      where: { id: string; customerId: string; deletedAt: { type?: string } };
    };
    expect(addressQuery.where.id).toBe(ADDRESS_ID);
    expect(addressQuery.where.customerId).toBe(CUSTOMER_ID);
    expect(addressQuery.where.deletedAt.type).toBe('isNull');
    expect(harness.scanner.scan).not.toHaveBeenCalled();
    expect(harness.storage.put).not.toHaveBeenCalled();
  });

  it('rejects active duplicate content before writing another encrypted object', async () => {
    const duplicate = submissionRow({ sha256Checksum: sha256(PDF_BYTES) });
    const harness = makeHarness({ transactionFindOneResults: [null, duplicate] });

    await expect(harness.service.upload(CUSTOMER_ID, command())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.storage.put).not.toHaveBeenCalled();
    expect(harness.submissionRows).toHaveLength(0);
  });

  it('replays the same idempotency request without scanning, storage, or creating another revision', async () => {
    const prior = submissionRow({ sha256Checksum: sha256(PDF_BYTES) });
    const harness = makeHarness({ priorRequest: prior });

    const result = await harness.service.upload(CUSTOMER_ID, command());

    expect(result.replayed).toBe(true);
    expect(result.document.id).toBe(prior.id);
    expect(harness.scanner.scan).not.toHaveBeenCalled();
    expect(harness.storage.put).not.toHaveBeenCalled();
    expect(harness.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects an idempotency-key replay when metadata differs even if the file bytes match', async () => {
    const prior = submissionRow({ sha256Checksum: sha256(PDF_BYTES) });
    const harness = makeHarness({ priorRequest: prior });
    const changed = command();
    changed.fields.documentDate = '2025-01-01';

    await expect(harness.service.upload(CUSTOMER_ID, changed)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.scanner.scan).not.toHaveBeenCalled();
    expect(harness.storage.put).not.toHaveBeenCalled();
  });

  it('keeps all Proof of Address routes inert while the feature flag is disabled', async () => {
    const harness = makeHarness({ enabled: false });

    expect(harness.service.capabilities()).toMatchObject({
      enabled: false,
      previewAvailable: false,
      documentaryReviewEnabled: false,
      physicalVerificationEnabled: false,
      tier3OrWalletChangesEnabled: false,
    });
    await expect(harness.service.upload(CUSTOMER_ID, command())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(harness.scanner.scan).not.toHaveBeenCalled();
    expect(harness.storage.put).not.toHaveBeenCalled();
  });

  it('attempts cleanup when private storage fails, including an ambiguous partial write', async () => {
    const harness = makeHarness({ storagePutError: new Error('backend detail') });

    await expect(harness.service.upload(CUSTOMER_ID, command())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(harness.storage.put).toHaveBeenCalledTimes(1);
    expect(harness.storage.remove).toHaveBeenCalledTimes(1);
    expect(harness.submissionRows).toHaveLength(0);
  });

  it('creates a clean replacement revision and records the previous revision as superseded', async () => {
    const prior = submissionRow();
    const harness = makeHarness({
      lockedRow: prior,
      replacementGroup: [prior],
      transactionFindOneResults: [null, null, prior],
    });
    const replacementCommand = command();
    replacementCommand.fields.supersedesSubmissionId = prior.id;

    const result = await harness.service.upload(CUSTOMER_ID, replacementCommand);

    expect(result.document.revisionNumber).toBe(2);
    expect(result.document.supersedesSubmissionId).toBe(prior.id);
    expect(result.document.documentStatus).toBe(CustomerProofOfAddressDocumentStatus.AVAILABLE);
    expect(result.document.reviewStatus).toBe(CustomerProofOfAddressReviewStatus.PENDING);
    expect(prior.documentStatus).toBe(CustomerProofOfAddressDocumentStatus.SUPERSEDED);
    expect(harness.historyRows.map(({ action }) => action)).toEqual([
      'UPLOADED',
      'SCAN_CLEAN',
      'SUPERSEDED',
    ]);
  });

  it('requires a replacement to preserve its customer address and evidence classification', async () => {
    const prior = submissionRow();
    const harness = makeHarness({
      lockedRow: prior,
      transactionFindOneResults: [null, null],
    });
    const replacementCommand = command();
    replacementCommand.fields.supersedesSubmissionId = prior.id;
    replacementCommand.fields.category = 'BANK';
    replacementCommand.fields.documentType = 'BANK_STATEMENT';

    await expect(harness.service.upload(CUSTOMER_ID, replacementCommand)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.storage.put).not.toHaveBeenCalled();
  });

  it('withdraws with an audited reason and archives only after withdrawal', async () => {
    const actor = { principalId: 'operator-1', roleKey: 'OPERATIONS' };
    const auditContext = { correlationId: 'correlation-1', requestId: 'request-1' };
    const available = submissionRow();
    const withdrawalHarness = makeHarness({ lockedRow: available });

    const withdrawn = await withdrawalHarness.service.withdraw(
      CUSTOMER_ID,
      available.id,
      'Customer provided a newer bill',
      actor,
      auditContext,
    );
    expect(withdrawn.documentStatus).toBe(CustomerProofOfAddressDocumentStatus.WITHDRAWN);
    expect(withdrawn.reviewStatus).toBe(CustomerProofOfAddressReviewStatus.PENDING);
    expect(withdrawn.withdrawnAt).toBeInstanceOf(Date);
    expect(withdrawalHarness.historyRows[0]?.action).toBe('WITHDRAWN');
    expect(withdrawalHarness.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'DOCUMENT_WITHDRAWN' }),
    );

    const archivedRow = submissionRow({
      documentStatus: CustomerProofOfAddressDocumentStatus.WITHDRAWN,
      withdrawnByPrincipalId: actor.principalId,
      withdrawnAt: new Date(),
      withdrawalReason: 'Customer provided a newer bill',
    });
    const archiveHarness = makeHarness({ lockedRow: archivedRow });
    const archived = await archiveHarness.service.archive(
      CUSTOMER_ID,
      archivedRow.id,
      'Retention review completed',
      actor,
      auditContext,
    );
    expect(archived.documentStatus).toBe(CustomerProofOfAddressDocumentStatus.ARCHIVED);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archiveHarness.historyRows[0]?.action).toBe('ARCHIVED');
    expect(archiveHarness.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'DOCUMENT_ARCHIVED' }),
    );
  });

  it('prevents a document identifier from being used under a different customer URL', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.getContent(
        '22222222-2222-4222-8222-222222222222',
        DOCUMENT_ID,
        {
          principalId: 'operator-1',
          roleKey: 'OPERATIONS',
        },
        { correlationId: 'corr-1', requestId: 'req-1' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.storage.get).not.toHaveBeenCalled();
    expect(harness.submissionRepository.findOne).toHaveBeenCalledWith({
      where: { id: DOCUMENT_ID, customerId: '22222222-2222-4222-8222-222222222222' },
    });
  });
});

function makeHarness(
  options: {
    scanResult?: 'CLEAN' | 'INFECTED' | 'UNAVAILABLE' | 'ERROR';
    addressFound?: boolean;
    priorRequest?: CustomerProofOfAddressSubmission;
    transactionFindOneResults?: Array<CustomerProofOfAddressSubmission | null>;
    storagePutError?: Error;
    lockedRow?: CustomerProofOfAddressSubmission;
    replacementGroup?: CustomerProofOfAddressSubmission[];
    enabled?: boolean;
  } = {},
) {
  const submissionRows: CustomerProofOfAddressSubmission[] = [];
  const historyRows: CustomerProofOfAddressDocumentHistory[] = [];
  const txFindOneResults = [...(options.transactionFindOneResults ?? [])];
  const txQueryBuilder = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(options.lockedRow ?? null),
  };
  const txSubmissionRepository = {
    findOne: jest.fn(() => Promise.resolve(txFindOneResults.shift() ?? null)),
    find: jest.fn(() => Promise.resolve(options.replacementGroup ?? [])),
    create: jest.fn(
      (value: Partial<CustomerProofOfAddressSubmission>) =>
        value as CustomerProofOfAddressSubmission,
    ),
    save: jest.fn((value: CustomerProofOfAddressSubmission) => {
      const foundIndex = submissionRows.findIndex((row) => row.id === value.id);
      if (foundIndex >= 0) submissionRows[foundIndex] = value;
      else submissionRows.push(value);
      return Promise.resolve(value);
    }),
    createQueryBuilder: jest.fn(() => txQueryBuilder),
  };
  const txHistoryRepository = {
    create: jest.fn(
      (value: Partial<CustomerProofOfAddressDocumentHistory>) =>
        value as CustomerProofOfAddressDocumentHistory,
    ),
    save: jest.fn((value: CustomerProofOfAddressDocumentHistory) => {
      historyRows.push(value);
      return Promise.resolve(value);
    }),
  };
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn((target: unknown) =>
      target === CustomerProofOfAddressSubmission ? txSubmissionRepository : txHistoryRepository,
    ),
  } as unknown as EntityManager;
  const transaction = jest.fn((callback: (manager: EntityManager) => Promise<unknown>) =>
    callback(manager),
  );
  const dataSource = { transaction } as unknown as DataSource;
  const submissionRepository = {
    findOne: jest.fn(() => Promise.resolve(options.priorRequest ?? null)),
  } as unknown as Repository<CustomerProofOfAddressSubmission>;
  const historyRepository = {} as Repository<CustomerProofOfAddressDocumentHistory>;
  const addressQueries: unknown[] = [];
  const addressFindOne = jest.fn((query: unknown) => {
    addressQueries.push(query);
    return Promise.resolve(
      options.addressFound === false ? null : ({ id: ADDRESS_ID } as CustomerAddress),
    );
  });
  const addressRepository = { findOne: addressFindOne } as unknown as Repository<CustomerAddress>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
  const scanner = {
    scan: jest.fn().mockResolvedValue(options.scanResult ?? 'CLEAN'),
  } as unknown as jest.Mocked<ProofOfAddressMalwareScanner>;
  const encryption = {
    encrypt: jest
      .fn()
      .mockResolvedValue({ keyVersion: 'test-v1', bytes: Buffer.from('encrypted-document') }),
  } as unknown as jest.Mocked<PrivateDocumentEncryptionService>;
  const storage = {
    put: jest.fn(() =>
      options.storagePutError ? Promise.reject(options.storagePutError) : Promise.resolve(),
    ),
    get: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<PrivateProofOfAddressStorage>;
  const config: ProofOfAddressConfiguration = {
    enabled: options.enabled ?? true,
    nodeEnv: 'test',
    maxUploadBytes: 10 * 1024 * 1024,
    storageProvider: 'local',
    localStorageRoot: './unused',
    encryptionKeyFile: './unused',
    encryptionActiveKeyVersion: 'v1',
    clamavHost: '127.0.0.1',
    clamavPort: 3310,
    clamavTimeoutMs: 1000,
    s3ForcePathStyle: false,
  };
  const service = new CustomerProofOfAddressService(
    submissionRepository,
    historyRepository,
    addressRepository,
    dataSource,
    audit,
    encryption,
    storage,
    scanner,
    config,
  );

  return {
    service,
    dataSource,
    transaction,
    submissionRepository,
    addressRepository,
    addressFindOne,
    addressQueries,
    audit,
    scanner,
    encryption,
    storage,
    submissionRows,
    historyRows,
    txQueryBuilder,
    txSubmissionRepository,
  };
}

function command(): UploadProofOfAddressCommand {
  return {
    fields: {
      residentialAddressId: ADDRESS_ID,
      category: 'UTILITY',
      documentType: 'UTILITY_BILL',
    },
    fileName: 'utility-bill.pdf',
    claimedMimeType: 'application/pdf',
    bytes: PDF_BYTES,
    idempotencyKey: 'upload-key-123456789',
    actor: { principalId: 'operator-1', roleKey: 'OPERATIONS' },
    auditContext: { correlationId: 'correlation-1', requestId: 'request-1' },
  };
}

function submissionRow(overrides: Partial<CustomerProofOfAddressSubmission> = {}) {
  return {
    id: DOCUMENT_ID,
    submissionGroupId: DOCUMENT_ID,
    revisionNumber: 1,
    supersedesSubmissionId: null,
    customerId: CUSTOMER_ID,
    residentialAddressId: ADDRESS_ID,
    category: 'UTILITY',
    documentType: 'UTILITY_BILL',
    issuerName: null,
    documentDate: null,
    reviewStatus: CustomerProofOfAddressReviewStatus.PENDING,
    documentStatus: CustomerProofOfAddressDocumentStatus.AVAILABLE,
    scannerResult: 'CLEAN',
    originalFileName: 'utility-bill.pdf',
    detectedMimeType: 'application/pdf',
    fileSizeBytes: String(PDF_BYTES.length),
    sha256Checksum: sha256(PDF_BYTES),
    storageObjectKey: 'a'.repeat(64),
    encryptionKeyVersion: 'test-v1',
    createdByPrincipalId: 'operator-1',
    uploadedByPrincipalId: 'operator-1',
    uploadedAt: new Date(),
    withdrawnAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CustomerProofOfAddressSubmission;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
