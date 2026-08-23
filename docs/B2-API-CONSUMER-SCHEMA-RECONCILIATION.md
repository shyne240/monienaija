# B2 API Consumer Schema Reconciliation

- **Decision:** Approved schema correction with recorded contract discrepancy
- **Scope:** `b2_api_consumer.consumer_id`
- **Migration:** [`1785753600043-CreateB2ApiConsumerTables.ts`](../src/migrations/1785753600043-CreateB2ApiConsumerTables.ts)
- **Entity:** [`src/policy/b2-api-consumer.entity.ts`](../src/policy/b2-api-consumer.entity.ts)
- **Frozen contract (unchanged):** [`B2-API-CREDENTIALS-CONTRACT.md`](B2-API-CREDENTIALS-CONTRACT.md)
- **Contract text changed:** None
- **Runtime, identifier, event, idempotency-scope, or service-behaviour changes:** None

## 1. Defect

Migration `1785753600043` declares three foreign keys onto `b2_api_consumer(consumer_id)`:

```text
fk_b2_api_credential_consumer   b2_api_credential(consumer_id)    -> b2_api_consumer(consumer_id)
fk_b2_api_quota_consumer        b2_api_quota(consumer_id)         -> b2_api_consumer(consumer_id)
fk_b2_rate_limit_consumer       b2_rate_limit_bucket(consumer_id) -> b2_api_consumer(consumer_id)
```

`consumer_id` carried no unique constraint. PostgreSQL rejects a foreign key whose referenced
column set is not uniquely constrained:

```text
SQLSTATE 42830: there is no unique constraint matching given keys for referenced table "b2_api_consumer"
```

The migration was therefore not executable against real PostgreSQL. The defect was latent
because no real-PostgreSQL migration-chain coverage existed at the time it was introduced.

## 2. Correction

```sql
CONSTRAINT uq_b2_api_consumer_consumer_id UNIQUE (consumer_id)
```

with the matching entity declaration:

```ts
@Index('uq_b2_api_consumer_consumer_id', ['consumerId'], { unique: true })
```

## 3. Why uniqueness is the correct interpretation

- `consumerId` is generated exactly once per consumer row with `randomUUID()`.
- `consumer_version` is pinned by `chk_b2_api_consumer_version CHECK (consumer_version = 1)`,
  so no second row may legitimately share a `consumer_id`.
- All three child tables key on `consumer_id` alone, never on `(consumer_id, consumer_version)`.
- The foreign-key intent already treats `consumer_id` as the referenced identity.

The alternative — repointing the three foreign keys at the surrogate `id` primary key — was
rejected because it would change the frozen credential, quota and rate-limit persistence
shape. Preserving the foreign keys and constraining the referenced column is the minimal
correction that makes the declared intent executable.

## 4. Recorded discrepancy

The frozen contract describes `consumerId` as **indexed**:

> "...and indexes on `consumerId`, `keyId`, `state`, `idempotencyScope+key`, `correlationId`."

The schema enforces **unique**. These are not identical, and this document exists so that the
difference is recorded rather than silently absorbed:

| Surface | States |
| --- | --- |
| `B2-API-CREDENTIALS-CONTRACT.md` (frozen) | `consumerId` is indexed |
| `b2_api_consumer` schema + entity | `consumer_id` is **uniquely** indexed |

A unique index satisfies every read path the contract relies on, so no contract obligation is
weakened. The contract text is deliberately left unmodified because it is frozen; this
reconciliation is the authoritative record of the delta.

## 5. Reserved-word correction (same migration)

`window` is a reserved word in PostgreSQL. In `b2_api_quota` it is now quoted in both the
column definition and the CHECK expression:

```sql
"window" VARCHAR(32) NOT NULL,
CONSTRAINT chk_b2_api_quota_window CHECK ("window" = 'UTC_CALENDAR_DAY'),
```

This matches the existing treatment of `"limit"` in the same table. The entity already maps
the property through `@Column({ name: 'window' })`, which TypeORM quotes automatically, so no
entity change was required.

## 6. Not changed

- The frozen B2 API credentials contract.
- Any service behaviour, decision hash, idempotency scope, or event.
- The `b2_api_credential`, `b2_api_quota` and `b2_rate_limit_bucket` table shapes.
