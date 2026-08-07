import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import {
  PolicyCollectionStatus,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from './capability-policy.enums';
import { calculateSnapshotInputHash } from './capability-policy.service';
import { defaultSnapshotReference } from './capability-policy-evidence.adapters';
import type {
  PolicyEvidenceAdapter,
  PolicyEvidenceAdapterResult,
  PolicyEvidenceCollectionCommand,
  PolicyEvidenceCollectionContext,
  PolicyEvidenceCoordinatorOptions,
} from './capability-policy-evidence.types';
import type { PolicyEvidenceItem, PolicyEvidenceSnapshot } from './capability-policy.types';

@Injectable()
export class PolicySourceEvidenceCoordinator {
  private readonly adapterBySourceClass: ReadonlyMap<PolicySourceClass, PolicyEvidenceAdapter>;
  private readonly now: () => Date;
  private readonly snapshotReferenceFactory: (normalizedInputHash: string) => string;
  private readonly defaultClassification: string;

  constructor(
    adapters: readonly PolicyEvidenceAdapter[],
    options: PolicyEvidenceCoordinatorOptions = {},
  ) {
    const map = new Map<PolicySourceClass, PolicyEvidenceAdapter>();
    for (const adapter of adapters) {
      if (map.has(adapter.sourceClass)) {
        throw new ConflictException(`Duplicate A4 source adapter: ${adapter.sourceClass}`);
      }
      map.set(adapter.sourceClass, adapter);
    }
    this.adapterBySourceClass = map;
    this.now = options.now ?? (() => new Date());
    this.snapshotReferenceFactory = options.snapshotReferenceFactory ?? defaultSnapshotReference;
    this.defaultClassification = options.defaultClassification ?? 'Restricted';
  }

  async collect(command: PolicyEvidenceCollectionCommand): Promise<PolicyEvidenceSnapshot> {
    this.validateCommand(command);
    const requiredSourceClasses = [...new Set(command.requiredSourceClasses)].sort();
    const context: PolicyEvidenceCollectionContext = {
      customerId: command.customerId,
      capability: command.capability,
      action: command.action,
      requestedAt: command.requestedAt,
      asOf: command.asOf,
      evidenceProfile: command.evidenceProfile,
      requiredSourceClasses,
      ...(command.policyVersionHint ? { policyVersionHint: command.policyVersionHint } : {}),
      ...(command.evaluationContext ? { evaluationContext: command.evaluationContext } : {}),
      ...(command.targetBindingId ? { targetBindingId: command.targetBindingId } : {}),
      actorContext: command.actorContext,
      requestContext: command.requestContext,
    };
    const collectedAt = this.now().toISOString();
    const startedAt = command.startedAt ?? collectedAt;
    const results = await Promise.all(
      requiredSourceClasses.map((sourceClass) => this.collectSourceClass(sourceClass, context)),
    );
    const sourceItems = results.flatMap((result) => result.items).sort(compareEvidenceItems);
    const collection = this.collectionMetadata(
      requiredSourceClasses,
      results,
      sourceItems,
      startedAt,
      collectedAt,
    );
    const freshnessStates = [...new Set(sourceItems.map((item) => item.freshnessState))].sort();
    const snapshotWithoutIdentity: PolicyEvidenceSnapshot = {
      contractName: 'A4-EVIDENCE-SNAPSHOT',
      contractVersion: 1,
      snapshotReference: 'pending',
      subject: { type: 'CUSTOMER', customerId: command.customerId },
      policyRequestScope: {
        capability: command.capability,
        action: command.action,
        requestedAt: command.requestedAt,
        asOf: command.asOf,
        evidenceProfile: command.evidenceProfile,
        ...(command.policyVersionHint ? { policyVersionHint: command.policyVersionHint } : {}),
        ...(command.evaluationContext ? { evaluationContext: command.evaluationContext } : {}),
        ...(command.targetBindingId ? { targetBindingId: command.targetBindingId } : {}),
      },
      collection,
      sourceItems,
      evidenceSummary: {
        freshnessStates,
        sourceCount: sourceItems.length,
        normalizedInputHash: '',
      },
      integrity: {
        canonicalizationVersion: 1,
        arrayOrderingRule: 'sourceClass/sourceType/sourceId/sourceVersion',
        hashAlgorithm: 'SHA-256',
      },
    };
    const normalizedInputHash = calculateSnapshotInputHash(snapshotWithoutIdentity);
    return {
      ...snapshotWithoutIdentity,
      snapshotReference: this.snapshotReferenceFactory(normalizedInputHash),
      evidenceSummary: {
        ...snapshotWithoutIdentity.evidenceSummary,
        normalizedInputHash,
      },
    };
  }

  private async collectSourceClass(
    sourceClass: PolicySourceClass,
    context: PolicyEvidenceCollectionContext,
  ): Promise<PolicyEvidenceAdapterResult> {
    const adapter = this.adapterBySourceClass.get(sourceClass);
    if (!adapter) {
      const observedAt = this.now().toISOString();
      return {
        contractName: 'A4-SOURCE-EVIDENCE',
        contractVersion: 1,
        sourceClass,
        collectionStatus: 'MISSING',
        sourceType: sourceClass,
        observedAt,
        items: [
          {
            sourceClass,
            sourceType: sourceClass,
            sourceId: null,
            customerId: context.customerId,
            sourceVersion: null,
            sourceUpdatedAt: null,
            observedAt,
            deleted: false,
            freshnessState: PolicyEvidenceFreshnessState.MISSING,
            freshnessReasonCode: 'SOURCE_ADAPTER_MISSING',
            classification: this.defaultClassification,
            normalizedValue: {},
            sourceReference: null,
          },
        ],
        failureReference: 'SOURCE_ADAPTER_MISSING',
      };
    }
    try {
      return await adapter.collect(context);
    } catch {
      const observedAt = this.now().toISOString();
      return {
        contractName: 'A4-SOURCE-EVIDENCE',
        contractVersion: 1,
        sourceClass,
        collectionStatus: 'UNAVAILABLE',
        sourceType: sourceClass,
        observedAt,
        items: [
          {
            sourceClass,
            sourceType: sourceClass,
            sourceId: null,
            customerId: context.customerId,
            sourceVersion: null,
            sourceUpdatedAt: null,
            observedAt,
            deleted: false,
            freshnessState: PolicyEvidenceFreshnessState.UNAVAILABLE,
            freshnessReasonCode: 'SOURCE_ADAPTER_FAILED',
            classification: this.defaultClassification,
            normalizedValue: {},
            sourceReference: null,
          },
        ],
        failureReference: 'SOURCE_ADAPTER_FAILED',
      };
    }
  }

  private collectionMetadata(
    requiredSourceClasses: readonly PolicySourceClass[],
    results: readonly PolicyEvidenceAdapterResult[],
    sourceItems: readonly PolicyEvidenceItem[],
    startedAt: string,
    collectedAt: string,
  ): PolicyEvidenceSnapshot['collection'] {
    const missingSourceClasses = results
      .filter((result) => result.collectionStatus === 'MISSING')
      .map((result) => result.sourceClass)
      .sort();
    const unavailableSourceClasses = results
      .filter((result) => result.collectionStatus === 'UNAVAILABLE')
      .map((result) => result.sourceClass)
      .sort();
    const restrictedSourceClasses = results
      .filter((result) => result.collectionStatus === 'RESTRICTED')
      .map((result) => result.sourceClass)
      .sort();
    const conflictSourceClasses = results
      .filter((result) => result.collectionStatus === 'CONFLICTING')
      .map((result) => result.sourceClass)
      .sort();
    const itemClasses = new Set(sourceItems.map((item) => item.sourceClass));
    const collectedSourceClasses = results
      .filter(
        (result) => result.collectionStatus === 'COMPLETE' || itemClasses.has(result.sourceClass),
      )
      .map((result) => result.sourceClass)
      .sort();
    const hasUnavailable =
      unavailableSourceClasses.length > 0 ||
      sourceItems.some((item) => item.freshnessState === PolicyEvidenceFreshnessState.UNAVAILABLE);
    const hasIncomplete =
      missingSourceClasses.length > 0 ||
      restrictedSourceClasses.length > 0 ||
      conflictSourceClasses.length > 0 ||
      sourceItems.some((item) => item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT);
    const status: PolicyCollectionStatus = hasUnavailable
      ? PolicyCollectionStatus.UNAVAILABLE
      : hasIncomplete
        ? PolicyCollectionStatus.INCOMPLETE
        : PolicyCollectionStatus.COMPLETE;
    return {
      status,
      startedAt,
      collectedAt,
      requiredSourceClasses,
      collectedSourceClasses,
      missingSourceClasses,
      unavailableSourceClasses,
      restrictedSourceClasses,
      conflictSourceClasses,
    };
  }

  private validateCommand(command: PolicyEvidenceCollectionCommand): void {
    if (!isUuid(command.customerId)) {
      throw new BadRequestException('A4 evidence customerId must be a UUID');
    }
    if (!command.capability || !command.action || !command.evidenceProfile) {
      throw new BadRequestException('A4 evidence capability, action, and profile are required');
    }
    if (!command.requiredSourceClasses.length) {
      throw new BadRequestException('A4 evidence requires at least one source class');
    }
    if (!command.requestContext.requestId || !command.requestContext.correlationId) {
      throw new BadRequestException('A4 evidence request context is required');
    }
  }
}

function compareEvidenceItems(left: PolicyEvidenceItem, right: PolicyEvidenceItem): number {
  const leftKey = [
    left.sourceClass,
    left.sourceType,
    left.sourceId ?? '',
    String(left.sourceVersion ?? ''),
  ].join('|');
  const rightKey = [
    right.sourceClass,
    right.sourceType,
    right.sourceId ?? '',
    String(right.sourceVersion ?? ''),
  ].join('|');
  return leftKey.localeCompare(rightKey);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
