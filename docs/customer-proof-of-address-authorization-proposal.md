# Customer Proof of Address and physical verification: authorization proposal

**Status:** audit and recommendation only. No new authorization functions, role grants, approval actions, or Tier 3 actions are enabled by this proposal.

## Existing workforce roles reviewed

The current authorization catalogue defines these eleven roles: `SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY`, and `ADMINISTRATOR`.

Relevant current catalogue assignments include:

| Existing function                                          | Current catalogue assignments relevant to customer servicing                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `customer.view`                                            | `SUPER_ADMIN`, `FINANCE_AUDITOR`, `OPERATIONS`, `COMPLIANCE`, `CUSTOMER_SERVICE`, `ADMINISTRATOR` |
| `customer.view_address` / `customer.view_contact_methods`  | `SUPER_ADMIN`, `FINANCE_AUDITOR`, `OPERATIONS`, `COMPLIANCE`, `CUSTOMER_SERVICE`                  |
| `customer.view_identity_documents`                         | `SUPER_ADMIN`, `COMPLIANCE` only; deliberately narrower than general customer/address access      |
| `customer.create` and lifecycle functions                  | `SUPER_ADMIN`, `OPERATIONS`                                                                       |
| `kyc.view`                                                 | `SUPER_ADMIN`, `FINANCE_AUDITOR`, `COMPLIANCE`                                                    |
| `kyc.review`, `kyc.approve`, `kyc.reject`                  | `SUPER_ADMIN`, `COMPLIANCE`                                                                       |
| `compliance.manage_case`, `compliance.manage_risk_profile` | `SUPER_ADMIN`, `COMPLIANCE`                                                                       |

The other roles have no general customer Proof of Address function in the current catalogue. `ADMINISTRATOR` is explicitly excluded from KYC and compliance decision functions. `FINANCE_CONTROLLER` is an existing checker for selected governed finance/role actions, not a KYC approver.

## Existing approval and evidence boundaries

- `POST /customers/:id/kyc-assessment` derives a catalogue function from the requested status: `kyc.review` for `NOT_STARTED`/`PENDING`, `kyc.approve` for `APPROVED`, and `kyc.reject` for `REJECTED`. The seeded catalogue grants the final approve/reject functions directly to both `SUPER_ADMIN` and `COMPLIANCE`; this path does not use the shared maker/checker approval service or require a distinct second approver. That existing `SUPER_ADMIN` decision grant conflicts with the stated target governance that Compliance makes final KYC approval and `SUPER_ADMIN` must not bypass independent review. It is not changed here; the current KYC grant/route requires an explicit governance review before any Tier 3 workflow relies on it.
- The customer KYC assessment path is not a PoA-specific maker/checker workflow. Its assessment records an assessor and current status, but does not itself provide the proposed upload-versus-review separation or independent physical-verification decision for PoA.
- The shared `PrivilegedActionApprovalService`/governed-action infrastructure is used for registered commercial, ledger-reversal, agent-funding, and role-governance actions. It is not currently registered for customer PoA or physical-address decisions. Its finance approval rules must not be repurposed silently.
- Existing compliance-case evidence is metadata/reference-only, not secure document storage. `CustomerComplianceController` also has no controller-local catalogue-function checks; its customer routes rely on the generic customer route policy, which does not express a dedicated evidence permission. That legacy surface and its caller-provided uploader metadata are not a substitute for a new authenticated, customer-scoped PoA authorization boundary.
- `CustomerOnboardingService` readiness checks include an identity-document _record exists_ check, not a separate verified-identity result, and do not assess PoA or physical address verification. `CustomerEligibilityService` represents general operating eligibility after onboarding; it is not a Tier 3 KYC or wallet-tier decision.

## Proposed functions and role assignments for review

The following are proposed function codes and assignments only; they are not added to the live catalogue and have no runtime grants yet.

| Proposed function                               | Proposed roles                                                                                        | Boundary                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `customer.view_proof_of_address_metadata`       | `OPERATIONS`, `COMPLIANCE`; optionally limited metadata for `CUSTOMER_SERVICE`                        | Record metadata only; not a file download grant.                                                                         |
| `customer.upload_proof_of_address`              | `OPERATIONS`; `CUSTOMER_SERVICE` may assist with collection/upload if specifically approved           | Authenticated principal is recorded by the server; caller-supplied uploader identity is ignored.                         |
| `customer.download_proof_of_address`            | `COMPLIANCE`, specifically authorized `OPERATIONS`                                                    | Sensitive content access; authorize each request and customer scope. Do not grant to Finance/Audit roles by implication. |
| `customer.review_proof_of_address`              | `COMPLIANCE`                                                                                          | A reviewer records `VERIFIED` or `REJECTED`; rejection requires a reason.                                                |
| `customer.assign_physical_address_verification` | `OPERATIONS`                                                                                          | Assign a named authorized officer/provider; record assigner and timestamp.                                               |
| `customer.submit_physical_address_findings`     | The assigned verification officer/provider identity, represented by an authorized workforce principal | A submitter cannot decide/approve their own findings.                                                                    |
| `customer.review_physical_address_verification` | `COMPLIANCE`                                                                                          | Independent final review of submitted visit findings and evidence reference.                                             |

Recommended exclusions: `SUPER_ADMIN` may administer permissions through the existing governed permission-management path but should not directly approve/reject PoA or bypass evidence, verification, or independent-review requirements. `ADMINISTRATOR`, Finance roles, `AGENT_NETWORK_MANAGER`, `RISK_FRAUD`, and `TREASURY` receive no PoA decision function by default. `CUSTOMER_SERVICE` may help collect evidence but must not approve PoA or Tier 3 eligibility.

Recommended enforcement, subject to approval:

1. Require an authenticated workforce principal and customer-scoped authorization for every read/write/download.
2. Record uploader, physical-verification submitter, reviewer/approver, role key, and timestamps from the authenticated server principal—not request fields.
3. Reject a documentary decision when the reviewer is the uploader/submitter. Reject a physical-verification decision when the reviewer is the assigned field officer or findings submitter. Enforce this in service logic and database constraints.
4. Make decision history append-only. Require a non-empty rejection reason. Preserve previous submissions and decisions when a new revision is submitted.
5. Keep assignment/visit submission separate from documentary review and from KYC assessment/financial eligibility/wallet-tier change. Before enabling final KYC approval, require the approved Compliance decision path and reject an approver who is the document uploader or physical-verification findings submitter/verifier; enforce that actor comparison in the authorized service/transaction, not only in the UI.
6. Register new functions and any maker/checker action only after Compliance, Security, and Authorization owners approve the matrix. Do not infer approvals from the current `kyc.approve` grant.

No role grant, authorization route, reviewer action, or Tier 3 privilege is changed by the current policy-neutral work.
