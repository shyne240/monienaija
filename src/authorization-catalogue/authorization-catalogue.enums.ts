/**
 * V1-ADMIN-AUTHORIZATION-FOUNDATION-01
 *
 * Enumerations for the database-backed function/role authorization
 * catalogue. These are TypeScript-side conveniences only; the database
 * constraints (CHECK clauses in the migration) are the actual source of
 * truth enforced by PostgreSQL.
 */

/** Sensitivity classification carried by a catalogued function. */
export enum FunctionSensitivity {
  READ = 'READ',
  OPERATIONAL = 'OPERATIONAL',
  SENSITIVE = 'SENSITIVE',
  PRIVILEGED = 'PRIVILEGED',
  CRITICAL_FINANCIAL = 'CRITICAL_FINANCIAL',
}

/**
 * The exact 5-way V1 status classification used throughout
 * docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md. A function existing in
 * the catalogue with a non-IMPLEMENTED status does NOT mean it is
 * assignable — see the separate `assignable` flag.
 */
export enum FunctionV1Status {
  IMPLEMENTED = 'IMPLEMENTED',
  PARTIALLY_IMPLEMENTED = 'PARTIALLY_IMPLEMENTED',
  BACKEND_ONLY = 'BACKEND_ONLY',
  FUTURE = 'FUTURE',
  OUT_OF_V1_SCOPE = 'OUT_OF_V1_SCOPE',
}

/**
 * The capacity in which a role holds a given function. Lives on the
 * role/function assignment (not the function) because the same function
 * code can be held by a maker role as INITIATE and by a checker role as
 * APPROVE — mirroring the existing A2_MAKER_CHECKER_RULES_JSON pattern of
 * one governed action with separate initiatingRoles/approvingRoles arrays.
 */
export enum RoleFunctionAccessType {
  VIEW = 'VIEW',
  EXECUTE = 'EXECUTE',
  INITIATE = 'INITIATE',
  APPROVE = 'APPROVE',
}
