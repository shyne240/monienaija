# Cash-out intent checkpoint — not integration-ready

Cash-out OTP issuance requires customer, amount in minor units, currency and operation key. The server resolves the active customer wallet, credential version, authenticated agent and agent session, and creates an immutable, expiring Cash-Out intent before challenge delivery. The execution boundary rechecks that binding. Cash-Out challenges do not create customer authentication sessions. Customer, destination and operation OTP budgets are shared across resends.

This deployment is explicitly scoped to the single `MONIENAIJA` institution; there is no cross-institution isolation claim. Multi-institution support requires an authoritative institution identity and migration/integration review. The Cash-to-Cash claim pathway remains outside this checkpoint.

## Known blockers

* The mobile pending-operation record stores the operation key but not the original challenge identity. Following an ambiguous completed execution or process restart, the client cannot yet recover the existing receipt: the completed intent refuses a new challenge and the execution API requires the original challenge. Same-session direct retries with the original challenge are supported. Design a read-only, PIN-authorized receipt recovery path or persist and safely recover the challenge binding before declaring completion.
* Existing pre-intent Cash-Out challenges and legacy completed receipts do not have the required intent binding and are deliberately rejected; a governed migration or operational recovery policy is needed for in-flight legacy operations.
* Changing material operation details under an existing operation key is rejected; it does not cancel the earlier intent. Explicit cancellation/invalidation behavior and its acceptance test remain open.
* The acceptance suite does not yet cover all requested wrong-wallet/customer/agent, expired or cancelled intent, or recovery scenarios. Do not deploy or treat this checkpoint as accepted.
* Reconcile migration `1785753600132-CashOutIntents.ts` with Arena 1 (`0117`), Arena 4 (`0118`), and any migrations added after the remote scan. The production trusted KYC evidence reader remains unavailable and fails closed.
