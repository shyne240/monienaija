/**
 * A7T03 — A4 product-policy persistence repository.
 *
 * The A7 product-policy service reuses the A4
 * `TypeOrmPolicyProfileVersionRepository` (which writes the A4
 * `policy_profile_versions` table) and the A4
 * `TypeOrmPolicyDecisionRecordRepository` (which writes the A4
 * `policy_decision_records` table). The A7 product-policy
 * persistence repository is a thin A7-side wrapper that:
 *
 *  - reads the A4 product-policy profile for the A7 first product via
 *    the A4 `PolicyProfileVersionRepository.getProfileAt()`;
 *  - records the A4 product-policy profile for the A7 first product
 *    via the A4 `PolicyProfileVersionRepository.insertImmutable()`
 *    when the A7 module initializes; and
 *  - reads the A4 product-policy decision for the A7 first product
 *    via the A4 `PolicyDecisionStore.findByRequestHash()` and the
 *    A4 `PolicyDecisionStore.findByDecisionReference()`.
 *
 * No new table, no new entity, no new migration, no new column, no new
 * trigger, and no new index is introduced. The A4 `policy_profile_versions`
 * table and the A4 `policy_decision_records` table are reused. The A4
 * persistence boundary is the only persistence boundary.
 */

import { Injectable } from '@nestjs/common';

import {
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
} from './a7-product-policy.constants';
import {
  A7_PRODUCT_POLICY_PROFILES,
  A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS,
} from './a7-product-policy.profiles';
import type {
  A7ProductPolicyPersistenceContract,
  A7ProductPolicyProfileRegistration,
} from './a7-product-policy.types';
import {
  TypeOrmPolicyDecisionRecordRepository,
  TypeOrmPolicyProfileVersionRepository,
} from './capability-policy-persistence.repositories';
import { PolicyProfileLifecycleState } from './capability-policy-persistence.enums';
import type { CapabilityPolicyProfile, PolicyDecisionResult } from './capability-policy.types';

/**
 * The A7 product-policy persistence repository. The A7 product-policy
 * service uses this repository to look up the A4 product-policy profile
 * for the A7 first product and to read the A4 product-policy decision
 * for the A7 first product.
 */
@Injectable()
export class A7ProductPolicyPersistenceRepository {
  constructor(
    private readonly profileRepository: TypeOrmPolicyProfileVersionRepository,
    private readonly decisionRepository: TypeOrmPolicyDecisionRecordRepository,
  ) {}

  /**
   * Reads the A4 product-policy profile for the A7 first product by
   * A4 capability and action. The A4 `PolicyProfileVersionRepository`
   * returns `null` when no A4 product-policy profile is registered for
   * the given A4 capability / action / evaluation-at time.
   */
  async getProfile(
    capability: string,
    action: string,
    evaluationAt: string = new Date().toISOString(),
  ): Promise<CapabilityPolicyProfile | null> {
    return this.profileRepository.getProfileAt(capability, action, evaluationAt);
  }

  /**
   * Reads the A4 product-policy decision for the A7 first product by the
   * A4 decision reference. The A4 `PolicyDecisionRecordRepository`
   * returns `null` when no A4 product-policy decision is recorded for
   * the given A4 decision reference.
   */
  async findDecisionByReference(decisionReference: string): Promise<PolicyDecisionResult | null> {
    return this.decisionRepository.findByDecisionReference(decisionReference);
  }

  /**
   * Reads the A4 product-policy decision for the A7 first product by the
   * A4 request hash. The A4 `PolicyDecisionRecordRepository` returns
   * `null` when no A4 product-policy decision is recorded for the given
   * A4 request hash.
   */
  async findDecisionByRequestHash(requestHash: string): Promise<PolicyDecisionResult | null> {
    return this.decisionRepository.findByRequestHash(requestHash);
  }

  /**
   * Records the A4 product-policy profile for the A7 first product by
   * inserting the A4 product-policy profile into the A4
   * `policy_profile_versions` table. The A4
   * `PolicyProfileVersionRepository.insertImmutable()` enforces the A4
   * profile reference uniqueness, the A4 definition hash integrity, the
   * A4 effective interval, and the A4 lifecycle state machine.
   */
  async recordProfile(contract: A7ProductPolicyPersistenceContract): Promise<void> {
    const profileEntry = A7_PRODUCT_POLICY_PROFILES.find(
      (candidate) => candidate.profileReference === contract.profileReference,
    );
    if (!profileEntry) {
      throw new Error(
        `A7 product policy profile not found for reference: ${contract.profileReference}`,
      );
    }
    await this.profileRepository.insertImmutable({
      ...profileEntry,
      effectiveFrom: new Date(contract.effectiveFrom),
      effectiveTo: contract.effectiveTo === null ? null : new Date(contract.effectiveTo),
      lifecycleState: contract.lifecycleState as PolicyProfileLifecycleState,
      createdBy: contract.createdBy,
      createdAt: new Date(contract.effectiveFrom),
      retentionClass: 'A4_POLICY_HISTORY',
      legalHold: false,
      retentionExpiresAt: null,
      definitionPayload: profileEntry as unknown as Readonly<Record<string, unknown>>,
    });
  }

  /**
   * Returns the A4 product-policy profile for the A7 first product by
   * the A4 policy version. The A4 `PolicyProfileVersionRepository`
   * returns `null` when no A4 product-policy profile is recorded for
   * the given A4 policy version.
   */
  async findProfileByPolicyVersion(policyVersion: string): Promise<CapabilityPolicyProfile | null> {
    const record = await this.profileRepository.findByPolicyVersion(policyVersion);
    if (!record) return null;
    return record as unknown as CapabilityPolicyProfile;
  }

  /**
   * Returns the A4 product-policy profile registrations for the A7
   * first product. The A7 product-policy service consumes the
   * registrations to look up the A4 product-policy profile for a
   * given A7 capability / action.
   */
  listProfileRegistrations(): readonly A7ProductPolicyProfileRegistration[] {
    return A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS;
  }

  /**
   * Returns the A4 product-policy profile references for the A7 first
   * product. The A7 product-policy service consumes the references
   * to verify that the A4 product-policy profile is registered.
   */
  listProfileReferences(): readonly string[] {
    return Object.freeze([
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
    ]);
  }

  /**
   * Returns the A4 product-policy versions for the A7 first product.
   * The A7 product-policy service consumes the versions to verify
   * that the A4 product-policy version is recorded.
   */
  listPolicyVersions(): readonly string[] {
    return Object.freeze([
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
    ]);
  }
}
