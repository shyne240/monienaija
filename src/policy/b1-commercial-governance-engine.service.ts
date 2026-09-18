/**
 * B1T10 — B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface service.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
} from './b1-commercial-governance-engine.constants';
import { B1CommercialGovernanceEngineRepository } from './b1-commercial-governance-engine.repository';
import type {
  B1CommercialApprovalDecisionReplaySafeResultV1,
  B1CommercialApprovalDecisionV1,
  B1CommercialApprovalRequestV1,
  B1CommercialAuditDecisionReplaySafeResultV1,
  B1CommercialAuditDecisionV1,
  B1CommercialAuditRequestV1,
  B1CommercialDataClassificationDecisionReplaySafeResultV1,
  B1CommercialDataClassificationDecisionV1,
  B1CommercialDataClassificationRequestV1,
  B1CommercialFeatureFlagDecisionReplaySafeResultV1,
  B1CommercialFeatureFlagDecisionV1,
  B1CommercialFeatureFlagRequestV1,
  B1CommercialGovernanceEngineCompatibilityResultV1,
  B1CommercialGovernanceEngineConsumerPortsV1,
  B1CommercialGovernanceEngineDocumentPersistenceRecordV1,
  B1CommercialGovernanceEngineDocumentVersioningContractV1,
  B1CommercialIdempotencyDecisionReplaySafeResultV1,
  B1CommercialIdempotencyDecisionV1,
  B1CommercialIdempotencyRequestV1,
} from './b1-commercial-governance-engine.types';

@Injectable()
export class B1CommercialGovernanceEngineService {
  constructor(
    @Inject(B1CommercialGovernanceEngineRepository)
    private readonly repository: B1CommercialGovernanceEngineRepository,
  ) {}

  getContractName(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_VERSION;
  }

  getConsumerPorts(): B1CommercialGovernanceEngineConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  generateCommercialDataClassificationDecision(
    request: B1CommercialDataClassificationRequestV1,
  ): B1CommercialDataClassificationDecisionV1 {
    return this.repository.generateCommercialDataClassificationDecision(request);
  }

  async replaySafeGenerateCommercialDataClassificationDecision(
    request: B1CommercialDataClassificationRequestV1,
  ): Promise<B1CommercialDataClassificationDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCommercialDataClassificationDecision(request);
  }

  generateCommercialIdempotencyDecision(
    request: B1CommercialIdempotencyRequestV1,
  ): B1CommercialIdempotencyDecisionV1 {
    return this.repository.generateCommercialIdempotencyDecision(request);
  }

  async replaySafeGenerateCommercialIdempotencyDecision(
    request: B1CommercialIdempotencyRequestV1,
  ): Promise<B1CommercialIdempotencyDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCommercialIdempotencyDecision(request);
  }

  generateCommercialAuditDecision(
    request: B1CommercialAuditRequestV1,
  ): B1CommercialAuditDecisionV1 {
    return this.repository.generateCommercialAuditDecision(request);
  }

  async replaySafeGenerateCommercialAuditDecision(
    request: B1CommercialAuditRequestV1,
  ): Promise<B1CommercialAuditDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCommercialAuditDecision(request);
  }

  generateCommercialApprovalDecision(
    request: B1CommercialApprovalRequestV1,
  ): B1CommercialApprovalDecisionV1 {
    return this.repository.generateCommercialApprovalDecision(request);
  }

  async replaySafeGenerateCommercialApprovalDecision(
    request: B1CommercialApprovalRequestV1,
  ): Promise<B1CommercialApprovalDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCommercialApprovalDecision(request);
  }

  generateCommercialFeatureFlagDecision(
    request: B1CommercialFeatureFlagRequestV1,
  ): B1CommercialFeatureFlagDecisionV1 {
    return this.repository.generateCommercialFeatureFlagDecision(request);
  }

  async replaySafeGenerateCommercialFeatureFlagDecision(
    request: B1CommercialFeatureFlagRequestV1,
  ): Promise<B1CommercialFeatureFlagDecisionReplaySafeResultV1> {
    return this.repository.replaySafeGenerateCommercialFeatureFlagDecision(request);
  }

  compatibilityCheck(
    request:
      | B1CommercialDataClassificationRequestV1
      | B1CommercialIdempotencyRequestV1
      | B1CommercialAuditRequestV1
      | B1CommercialApprovalRequestV1
      | B1CommercialFeatureFlagRequestV1,
  ): B1CommercialGovernanceEngineCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  getVersioningContract(): B1CommercialGovernanceEngineDocumentVersioningContractV1 {
    return this.repository.getVersioningContract();
  }

  listPersistenceRecords(): Promise<
    readonly B1CommercialGovernanceEngineDocumentPersistenceRecordV1[]
  > {
    return this.repository.findPersistenceRecords();
  }

  getPersistenceRecordByReference(
    documentReference: string,
    documentVersion: 1,
  ): Promise<B1CommercialGovernanceEngineDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByReference(documentReference, documentVersion);
  }

  getPersistenceRecordByIdempotencyKey(
    idempotencyScope: string,
    idempotencyKey: string,
  ): Promise<B1CommercialGovernanceEngineDocumentPersistenceRecordV1 | null> {
    return this.repository.findPersistenceRecordByIdempotencyKey(idempotencyScope, idempotencyKey);
  }

  getAuditActor(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_ENTITY_TYPE;
  }

  getOutboxEventType(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE;
  }

  getCommercialDataClassificationIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE;
  }

  getCommercialIdempotencyIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_IDEMPOTENCY_SCOPE;
  }

  getCommercialAuditIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_IDEMPOTENCY_SCOPE;
  }

  getCommercialApprovalIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_IDEMPOTENCY_SCOPE;
  }

  getCommercialFeatureFlagIdempotencyScope(): string {
    return B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_FLAG_IDEMPOTENCY_SCOPE;
  }

  getIdempotencyRetentionSeconds(): number {
    return this.repository.getIdempotencyRetentionSeconds();
  }

  getReferencePrefix(): string {
    return this.repository.getReferencePrefix();
  }

  getScopeKey(): string {
    return this.repository.getScopeKey();
  }

  getScopeVersion(): 1 {
    return this.repository.getScopeVersion();
  }

  getScopeCurrency(): 'NGN' {
    return this.repository.getScopeCurrency();
  }

  getScopeAccountingUnit(): 'CUSTOMER_FUNDS' {
    return this.repository.getScopeAccountingUnit();
  }

  getScopeDirection(): 'inbound' {
    return this.repository.getScopeDirection();
  }

  getScopeProductDependency(): 'VIRTUAL_ACCOUNT' {
    return this.repository.getScopeProductDependency();
  }

  getScopeProductDependencyVersion(): 1 {
    return this.repository.getScopeProductDependencyVersion();
  }

  getScopePartnerDependency(): 'NIBSS_NIP' {
    return this.repository.getScopePartnerDependency();
  }

  getPeriodKey(): string {
    return this.repository.getPeriodKey();
  }

  getRetentionDays(): number {
    return this.repository.getRetentionDays();
  }

  getCommercialDataClassificationStates(): readonly string[] {
    return this.repository.getCommercialDataClassificationStates();
  }

  getCommercialIdempotencyStates(): readonly string[] {
    return this.repository.getCommercialIdempotencyStates();
  }

  getCommercialAuditStates(): readonly string[] {
    return this.repository.getCommercialAuditStates();
  }

  getCommercialApprovalStates(): readonly string[] {
    return this.repository.getCommercialApprovalStates();
  }

  getCommercialFeatureFlagStates(): readonly string[] {
    return this.repository.getCommercialFeatureFlagStates();
  }

  getDecisionKinds(): readonly string[] {
    return this.repository.getDecisionKinds();
  }

  getDecisionOutcomes(): readonly string[] {
    return this.repository.getDecisionOutcomes();
  }

  getDocumentKinds(): readonly string[] {
    return this.repository.getDocumentKinds();
  }

  getRuleKinds(): readonly string[] {
    return this.repository.getRuleKinds();
  }

  getRuleOutcomes(): readonly string[] {
    return this.repository.getRuleOutcomes();
  }

  getClassificationLevels(): readonly string[] {
    return this.repository.getClassificationLevels();
  }

  getDataControlClassifications(): readonly string[] {
    return this.repository.getDataControlClassifications();
  }

  getCommercialSensitivities(): readonly string[] {
    return this.repository.getCommercialSensitivities();
  }

  getCommercialDisclosureLevels(): readonly string[] {
    return this.repository.getCommercialDisclosureLevels();
  }

  getCommercialRetentionClasses(): readonly string[] {
    return this.repository.getCommercialRetentionClasses();
  }

  getCommercialExportRules(): readonly string[] {
    return this.repository.getCommercialExportRules();
  }

  getCommercialReplayPolicies(): readonly string[] {
    return this.repository.getCommercialReplayPolicies();
  }

  getCommercialReplayEligibilities(): readonly string[] {
    return this.repository.getCommercialReplayEligibilities();
  }

  getCommercialAuditEvents(): readonly string[] {
    return this.repository.getCommercialAuditEvents();
  }

  getCommercialApprovalRequirements(): readonly string[] {
    return this.repository.getCommercialApprovalRequirements();
  }

  getCommercialApprovalPolicies(): readonly string[] {
    return this.repository.getCommercialApprovalPolicies();
  }

  getCommercialFeatureFlagRolloutStates(): readonly string[] {
    return this.repository.getCommercialFeatureFlagRolloutStates();
  }

  getCommercialActivationReadinesses(): readonly string[] {
    return this.repository.getCommercialActivationReadinesses();
  }

  getCompatibilityRuleIds(): readonly string[] {
    return this.repository.getCompatibilityRuleIds();
  }

  getConsumerContractIds(): readonly string[] {
    return this.repository.getConsumerContractIds();
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return this.repository.getVersionNegotiationRuleIds();
  }

  getReplayRuleIds(): readonly string[] {
    return this.repository.getReplayRuleIds();
  }

  getDeclaredDependencies(): readonly string[] {
    return this.repository.getDeclaredDependencies();
  }

  getProhibitedDependencies(): readonly string[] {
    return this.repository.getProhibitedDependencies();
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return this.repository.getProhibitedAdjacentScopes();
  }

  getFailureCodes(): readonly string[] {
    return this.repository.getFailureCodes();
  }

  getMetrics(): readonly string[] {
    return this.repository.getMetrics();
  }
}
