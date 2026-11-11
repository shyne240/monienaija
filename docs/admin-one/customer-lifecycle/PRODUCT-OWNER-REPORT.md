# Customer onboarding and financial readiness — product-owner briefing

**What this is:** a source-code investigation of baseline `5a7c14896dbb3ef8a2534a00b6f7415dbbad4da5`, not a live-system audit or a recommendation already approved for implementation. No real customer, payment, notification or database was used. For precise code references, endpoints and limitations, see the technical report and configuration inventory.

## The short answer

**An administrator registering someone does not activate them.** The Admin Console saves a customer as a draft. An authorized operator can later activate or reactivate the customer after the primary phone is verified. That activation does not itself approve KYC, complete the separate onboarding workflow, create a financial wallet, or authorize every transaction.

**Customers have another route:** the customer mobile registration flow can verify a Nigerian phone and, when a password is supplied, create an active individual, credential and NGN wallet together. That still does not automatically create an approved KYC assessment or transaction PIN. Actual phone-message delivery depends on deployment configuration, which was not checked.

**There is no one universal “ready to transact” switch shown to govern every transaction.** The Cash-In, Cash-Out, Transfer and Cash-to-Cash flows make different checks. Some separate eligibility and onboarding records exist but were not found directly used by those individual posting paths. This does not establish that these records are never used elsewhere.

## How an administrator creates a customer

1. In Customer Directory, the operator starts registration. Individual first and last names are required; middle name, date of birth and nationality are optional. A business needs a business name. The system creates a reference and a DRAFT record.
2. A valid primary phone is saved; an email is optional. The phone can be verified with the existing Nigerian-phone one-time-code flow. Saving a phone is not the same as verifying it.
3. Address and identity metadata can be saved or skipped. Identity actions have extra permissions. Saving a number or document record is not proof that a document was uploaded or verified with an official source.
4. The summary says DRAFT. The wizard does not activate the customer or create a financial wallet. Previously saved data can be continued from Customer 360, but unsaved edits and the exact wizard position are not guaranteed to return.

Each save is separate. If a response is lost, the operation may already have succeeded: check the record and audit before retrying. The system detects a duplicate normalized live phone/email and reference, and checks duplicate identity entries within a customer; this is not proof of a complete cross-customer identity-matching system.

## What activation means

Activation is the customer account status ACTIVE. In Customer 360, authorized staff can activate, suspend, reactivate or close a customer. A verified primary phone is required when entering ACTIVE, including reactivation. There is no maker-checker step in the inspected activation route. An agent cannot use that workforce activation route, and a customer cannot use it to reactivate themselves. The separate initial self-registration flow can create an ACTIVE customer after phone verification and password setup.

Customer status and KYC are distinct: a customer can be ACTIVE while KYC is NOT_STARTED. Completing a separate onboarding workflow actually requires an already ACTIVE customer, plus profile, address, identity record, required accepted agreements, completed tasks and an allowed risk state. A record of identity is not the same as verified identity.

## KYC levels and customer classes

The code recognizes NONE and Levels 1, 2 and 3. The Compliance screen can record a customer's KYC assessment and the selected level, with appropriate permissions. Assessments must follow the backend status sequence: NOT_STARTED → PENDING → APPROVED or REJECTED; an approved or rejected assessment goes back to PENDING for a new decision. The level is manually supplied on each assessment, including PENDING; approval does not automatically calculate the next level.

**There is no identified working Admin Console screen to configure what each KYC level requires**, and no general level-to-documents rule was found in the assessment service. The individual/business forms allow different identity types, but that is not a complete policy for levels 1–3. Proof-of-address has its own workflow; it is not proof that Level 3 is automatically granted.

No operational Customer Class of Service system with customer class definitions, assignment and approval was identified. Agent Classes are real but apply to agents. Other concepts — product enrollment, restrictions, permissions, direct limits, and a separate commercial tier architecture — should not be presented as a finished customer-class system without further integration evidence.

## Before a first transaction: an example

Assume an administrator creates an individual and verifies the primary phone. An operator activates the customer. From there:

- **Cash-In:** an authenticated, authorized agent with the right service capability and agent PIN resolves the customer's receiving identity. The customer must be ACTIVE; the flow can create the financial wallet if needed. Agent float, transaction rules and applicable customer incoming limits must also permit the transaction. The customer's transaction PIN is not required by this path.
- **Cash-Out:** the ACTIVE customer needs a transaction PIN, a customer-bound one-time-code/MFA challenge, and sufficient wallet funds. The agent needs the appropriate capability and agent PIN. The transaction also passes applicable customer outgoing limits.
- **Transfer:** the customer needs an issued/usable credential and customer session, their own active funded financial wallet and transaction PIN; the recipient needs a compatible active wallet. Source ownership, active customer states, currency, applicable outgoing limit and ledger checks apply.
- **Cash-to-Cash claim:** the claimant must control the beneficiary's verified phone, be ACTIVE and meet the claim's approved KYC and evidence checks; transfer code, OTP and agent-side checks also apply. This is stricter in a different way than the above paths.

These are code-path conditions, not an assurance that a deployed service or message provider works. The administrator's wizard does not itself issue the customer's credential, complete KYC, enroll a PIN or supply wallet funds. Separate credential issuance and rotation code exists; its actual delivery and hand-off need operational validation.

## Limits, fees, commissions and rewards

- **Limits:** profiles can be assigned directly or by other supported scopes. The highest stored precedence wins; a customer-specific rule does not automatically beat a global one. If there is no matching assignment, the selected profile is unusable, or no rule matches, the examined enforcement allows the transaction without a limit from this catalogue. Decide whether this is acceptable. The Admin Console can inspect customer assignments but the current assignment form is for agents and agent classes, not creating customer assignments.
- **Fees:** a matching product/currency rule can be calculated; the main resolver does not target customers or KYC tiers. Calculation and a decision snapshot do not prove a fee was charged. Actual accounting requires explicit enabled configuration and valid treatments/accounts.
- **Commissions:** rules can target agent or agent class and some agent flows calculate a decision. A decision is not necessarily paid: configured accounting may accrue a payable or post wallet netting under different conditions.
- **Rewards:** a backend rules and calculation foundation exists, including targeting by customer or KYC level. The inspected transaction flows do not call the reward engine to award rewards. Do not describe reward points or credits as live.

Commercial rule changes use a finance maker/checker process in the backend. Limit changes use separate function checks, and the inspected limit mutations do not consume that commercial approval workflow. The Admin commercial catalogue is primarily a viewing interface, not a full policy-management workflow.

## Highest-priority decisions for the owner

1. Should ACTIVE be allowed before approved KYC, and should each transaction type have a uniform or intentionally different KYC requirement?
2. Should the separate onboarding/eligibility, enrollment, restrictions and permissions be mandatory for each transaction, and what should happen when they are missing?
3. What are the precise KYC requirements and valid evidence for individuals versus businesses at each level, including review, expiry, upgrade and downgrade authority?
4. Is a Customer Class of Service needed, or do existing products, eligibility and direct/segment limits meet the business need? How would it relate to the separate commercial tier model?
5. What precedence, fallback and default-deny/default-allow policy should apply to limits, and which product/direction/channel combinations must be covered?
6. Which fees, taxes, commissions and rewards are approved, when should they be posted or settled, and who must approve changes?
7. Who owns credential hand-off, PIN recovery, monitoring, suspension and customer support? What separation of duties is required?

## What to improve after approval

Prioritize a clear Customer 360 readiness explanation and safe navigation; separate KYC assessment from a future requirements configuration facility; expose evidence and blocked reasons; provide appropriate customer limit-management controls; connect or deliberately retire disconnected models only after a backend/control review; and make commercial calculation versus posting versus settlement visible. These are investigation recommendations, not an authorized implementation plan. Stop for owner decisions before changing policy or code.
