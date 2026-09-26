# A8 Agent Class / Application / Lifecycle — Unresolved Blocker Documentation

This file records the exact boundaries where A8 stops rather than inventing business/regulatory policy, as required by the fail-closed rule.

## Approval Hierarchy

**Missing:**
- No `A2_MAKER_CHECKER_RULES_JSON` entry exists for:
  - `AGENT_APPLICATION_APPROVE`
  - `AGENT_APPLICATION_REJECT`
  - `AGENT_ACTIVATE`
  - `AGENT_SUSPEND`
  - `AGENT_REACTIVATE`
  - `AGENT_TERMINATE`
  - `AGENT_CLASS_CREATE`
  - `AGENT_CLASS_UPDATE`

Existing required rules (per `src/authorization/workforce-configuration.ts`) are only:
- `FINANCE_ROLE_ASSIGN`
- `FINANCE_ROLE_REVOKE`
- `FINANCE_CONTROL_POLICY_ACTIVATE`

**Decision:**
- Do NOT invent a new approval hierarchy (initiatingRoles/approvingRoles/minimumApprovals) for Agent lifecycle.
- Implement the safe domain foundation (AgentClass, AgentApplication, Agent lifecycle transitions) with direct privileged execution.
- Privileged execution requires `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` via `RoutePolicyRegistry` internal-route policy, and is blocked for `AGENT`/`CUSTOMER` at controller (`requirePrivileged`).
- The `PrivilegedActionApprovalService` is **not** invoked for Agent actions; if a rule were added later, controller should call `approvalService.request/approve/consume` and require `approvalId`.
- Production must configure `A2_MAKER_CHECKER_RULES_JSON` with appropriate `AGENT_*` rules and update `workforceConfiguration.ts` `REQUIRED_RULES` before requiring maker-checker for Agent actions.

## Regulatory Document / KYC / Requirements

**Missing:**
- CBN-required document sets for Agent onboarding
- KYC thresholds, capital requirements, physical outlet requirements, POS requirements
- Transaction limits (₦1.2m figure explicitly not implemented)

**Decision:**
- `AgentClass` stores configurable JSONB fields: `requirements`, `requiredInformation`, `requiredDocumentCategories`, `applicableServices`, `applicableLimits`.
- Values are **not hardcoded**; they remain `null` unless configured by an administrator.
- Downstream policy must treat missing limits as fail-closed (deny) rather than defaulting to an arbitrary limit.
- No Customer row is created for Agent applicant (identity safety).

## Financial Disposition on Suspension/Termination

**Missing (F-5):**
- Residual float treatment for `SUSPENDED`/`TERMINATED` Agents.

**Decision:**
- Transitions `ACTIVE→SUSPENDED`, `SUSPENDED→ACTIVE`, `ACTIVE→TERMINATED`, `SUSPENDED→TERMINATED`, `PENDING→ACTIVE/TERMINATED` are allowed via `AgentLifecycleService` with audit only.
- **No automatic** refund, transfer to suspense, confiscation, zeroing, or reversal is performed.
- Balance is left untouched; a future finance decision must explicitly handle residual float.

## Limits Framework Integration

**Existing:**
- `LimitEngine` is Customer-wallet specific (`customerId`, `walletId`, `paymentType`).
- No Agent-specific limit policy exists.

**Decision:**
- `AgentClass.applicableLimits` is a generic `jsonb` relationship to future limit configuration.
- No hard-coded limits are applied; if a limit check is needed, it must resolve the class's `applicableLimits` and delegate to a future Agent-limit engine.
- Documented as missing decision: actual Agent limits are undefined and must not be silently defaulted.

## Service / Permission Catalogue

**Missing:**
- Final V1 service catalogue (cash-in, cash-out, transfers, commissions)

**Decision:**
- `AgentClass.applicableServices` is a generic `jsonb` array of service identifiers.
- No services are hardcoded as active capabilities.
- Integration with the existing capability/policy framework (e.g., `capability-policy.service.ts`) is possible but not automatically enabled.

## Terminology

- Agent != Customer is preserved at the authorization layer (`customerAccess: NONE`, `agentAccess: SELF` for AGENT, `AGENT` not added to internal policies).
- No second Agent wallet is created; financial binding remains the existing `agents` identity plus future wallet logic, not duplicated on application.

## What Is Implemented and Verifiable

- `agent_classes` with UUID/reference/code/name/active/version + configurable JSONB + soft-delete + audit
- `agent_applications` with DRAFT→SUBMITTED→UNDER_REVIEW→APPROVED/REJECTED, `agentClassId` FK, `applicantReference` isolation, `agentId` link to canonical Agent, audit for every step
- `agents` extended with `agent_class_id` / `origin_application_id` (nullable, additive)
- Guarded Agent status machine (PENDING→ACTIVE, PENDING→TERMINATED, ACTIVE→SUSPENDED, SUSPENDED→ACTIVE, ACTIVE/SUSPENDED→TERMINATED, TERMINATED→ACTIVE blocked)
- Every transition audited via `AuditService` with actor, previous/new values, no secrets
- HTTP surfaces: `POST /api/v1/agents/applications` (AGENT_LOGIN applicant), `GET/PATCH .../applications/:id`, `POST .../:id/submit` (applicant), `GET/POST /api/v1/internal/agents/...` (privileged: classes, applications, lifecycle) — all blocked for AGENT/CUSTOMER

When the above missing policies are defined, the only change required is to add maker-checker rules and route policy entries; the domain tables and services remain unchanged.
