/**
 * ARENA 1 — stable class-resolution contract for Arena 3 (coordination §4 "Customer class" and §3.2).
 *
 * Arena 3's limit `SEGMENT` targeting and any approved class-specific pricing consume the class
 * **code** only — never the class row. Consumption pattern:
 *
 *   const classCode = await resolver.resolveClassCode(manager, customerId);
 *   // → pass segmentCodes: classCode ? [classCode] : [] into LimitEnforcementService
 *
 * Guarantees:
 * - deterministic: at most one live assignment per customer (unique index), resolved with a fixed
 *   ordering and no dependence on caller state;
 * - versioned: both the assignment (`assignmentVersion`) and the class catalogue row
 *   (`classVersion`) are exposed so callers can record evidence;
 * - audited: every assignment/switch writes an audit event (`CUSTOMER_CLASS_ASSIGNMENT`);
 * - fail-closed: any missing, disabled, deprecated or unconfigured class resolves to `null` —
 *   an explicit unresolved-class state, never an invented class.
 *
 * The customer-class module never reads or writes KYC tier data; KYC ceilings continue to be
 * resolved by `CustomerFinancialEligibilityService.require()` ahead of any commercial rule.
 */

export interface EffectiveCustomerClass {
  customerId: string;
  assignmentId: string;
  classId: string;
  classCode: string;
  className: string;
  /** Version of the assignment row that produced this resolution (bumps on switch). */
  assignmentVersion: number;
  /** Version of the class catalogue row (bumps on class update). */
  classVersion: number;
  source: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface CustomerClassAssignmentView extends EffectiveCustomerClass {
  isActive: boolean;
  precedence: number;
  reason: string | null;
  createdBy: string;
  createdAt: Date;
}
