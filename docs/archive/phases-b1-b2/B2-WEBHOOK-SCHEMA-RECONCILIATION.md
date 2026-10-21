# B2 Webhook Schema Reconciliation

- **Decision:** Approved schema correction with recorded contract discrepancy
- **Scope:** `b2_webhook_registration.registration_id`
- **Migration:** [`1785753600044-CreateB2WebhookTables.ts`](../src/migrations/1785753600044-CreateB2WebhookTables.ts)
- **Entity:** [`src/policy/b2-webhook.entity.ts`](../src/policy/b2-webhook.entity.ts)
- **Frozen contract (unchanged):** [`B2-WEBHOOK-CONTRACT.md`](B2-WEBHOOK-CONTRACT.md)
- **Contract text changed:** None
- **Runtime, identifier, event, idempotency-scope, or service-behaviour changes:** None

## 1. Defect

Migration `1785753600044` declares:

```text
fk_b2_webhook_delivery_registration  b2_webhook_delivery(registration_id)
                                     -> b2_webhook_registration(registration_id)
```

`registration_id` carried no unique constraint. PostgreSQL rejects a foreign key whose
referenced column set is not uniquely constrained:

```text
SQLSTATE 42830: there is no unique constraint matching given keys for referenced table "b2_webhook_registration"
```

The migration was therefore not executable against real PostgreSQL. The defect was latent
because no real-PostgreSQL migration-chain coverage existed at the time it was introduced.

## 2. Correction

```sql
CONSTRAINT uq_b2_webhook_registration_registration_id UNIQUE (registration_id)
```

with the matching entity declaration:

```ts
@Index('uq_b2_webhook_registration_registration_id', ['registrationId'], { unique: true })
```

## 3. Why uniqueness is the correct interpretation

- `registrationId` is generated exactly once per registration with `randomUUID()`.
- `registration_version` is pinned by
  `chk_b2_webhook_registration_version CHECK (registration_version = 1)`, so no second row may
  legitimately share a `registration_id`.
- The delivery contract expects `registrationId` to resolve to exactly one **VERIFIED**
  registration; a non-unique referenced column would make that resolution ambiguous.
- `b2_webhook_delivery` keys on `registration_id` alone, never on
  `(registration_id, registration_version)`.

Repointing the foreign key at the surrogate `id` primary key was rejected because it would
change the frozen delivery persistence shape. Preserving the foreign key and constraining the
referenced column is the minimal correction that makes the declared intent executable.

## 4. Recorded discrepancy

The frozen contract enumerates the registration indexes as:

> "...and indexes on `consumerId`, `state`, `requestHash`, `idempotencyScope+key`,
> `deliveryId`, `correlationId`."

It does not describe any index — unique or otherwise — on `registrationId`. The schema now
carries one, and it is unique:

| Surface | States |
| --- | --- |
| `B2-WEBHOOK-CONTRACT.md` (frozen) | no `registrationId` index enumerated |
| `b2_webhook_registration` schema + entity | `registration_id` is **uniquely** indexed |

The added constraint is strictly additive: it removes no index the contract requires and
weakens no obligation. The contract text is deliberately left unmodified because it is frozen;
this reconciliation is the authoritative record of the delta.

## 5. Not changed

- The frozen B2 webhook contract.
- Any service behaviour, decision hash, idempotency scope, or event.
- The `b2_webhook_delivery` table shape or its HMAC/challenge fields.
