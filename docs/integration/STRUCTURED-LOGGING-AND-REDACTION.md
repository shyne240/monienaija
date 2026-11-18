# Structured Logging and Redaction

ARENA 3D Group 16. Covers where logs come from, what is redacted and at which boundary, and what an
operator can rely on when reading them.

This document does not claim that a log aggregation platform is deployed, that retention is configured, or
that any incident has been reconstructed from these logs. It describes the emitting side.

---

## 1. What was wrong

The logging configuration looked complete. It had a long `redact.paths` list covering authorization headers,
cookies, API keys and 31 `req.body.*` fields. The reasonable conclusion — and the one taken at first — was
that logging was handled.

Writing one line and reading it showed otherwise, in two independent ways.

### 1.1 The paths only reach HTTP logs

`redact.paths` matches **paths on the log object**. Every entry began with `req.` or `res.`. A service or
worker log — the kind that carries provider payloads, PINs and database coordinates — has no `req`, so
nothing matched it.

Measured with a plain pino instance using the production redaction list:

```json
{
  "event": "payment",
  "providerApiKey": "sk_live_ABC123",
  "customerPin": "1234",
  "nested": { "dbPassword": "hunter2" }
}
```

Written to the stream verbatim. The HTTP path redaction was working exactly as configured; it simply did not
cover the majority of log volume.

### 1.2 The object redactor matched exact names only

The shared `redactSensitiveData` uses a key list containing `apikey`, `password` and `pin`. It normalises
case and separators, then requires an **exact** match. Compound field names — the normal way these appear in
DTOs and provider payloads — were invisible to it:

| Field            | Uses in `src/` | Redacted before Group 16 |
| ---------------- | -------------- | ------------------------ |
| `agentPin`       | 32             | No                       |
| `customerPin`    | 10             | No                       |
| `providerApiKey` | —              | No                       |
| `dbPassword`     | —              | No                       |

This was not only a logging problem. `redactRecord` — the same underlying function — is used at **30 call
sites**, including persisted audit metadata in `privileged-action-approval.service.ts` and
`customer-authentication-runtime.service.ts`. A secret-bearing compound field would have been stored as well
as logged.

---

## 2. What changed

### 2.1 A sink-level hook

`buildPinoHttpOptions()` now supplies `formatters.log`, which runs for **every record from every logger**:

```ts
formatters: {
  log: (object) => {
    const redacted = redactSensitiveData(object);
    return redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)
      ? (redacted as Record<string, unknown>)
      : { redactionFailure: true };
  },
},
```

This is the only place that can cover both HTTP and non-HTTP sinks, because it sits at the serializer rather
than at any individual call site.

**It fails closed.** If the redactor returns a non-object — `[REDACTED]` on budget exhaustion or an
unexpected shape — the record is replaced with `{ redactionFailure: true }`. Emitting the original object at
that moment would defeat the hook precisely when the input was too large or too deep to inspect.

The path-based `redact` list is **retained** as defence in depth. The hook runs first; the paths still apply
to any shape the walker might skip.

### 2.2 A bounded prefix rule for compound names

The exact-match list is unchanged. A prefix rule is layered on top, over a **named qualifier list**
(`agent`, `customer`, `user`, `staff`, `owner`, `admin`, `db`, `database`, `provider`, `banking`,
`aggregator`, `partner`, `merchant`, `webhook`, `sms`, `email`, `resend`) combined with a short suffix list
(`pin`, `password`, `apikey`, `secret`, `accesstoken`, `refreshtoken`).

Two deliberate choices:

- **Prefix, not suffix.** A suffix rule ("anything ending in `pin`") would swallow legitimate fields like
  `pinAttemptCount` and `tokenCount`, destroying diagnostic value for non-secret data. The prefix rule only
  fires on shapes this application actually uses, and adding a new qualifier is a visible edit to a named
  list.
- **Fail empty, not fail closed, on non-matches.** A field that does not match stays untouched. Redaction
  that over-reaches makes incidents harder to diagnose, which has its own operational cost.

Verified in the same suite: `pinAttemptCount: 3`, `tokenCount: 7`, `codeReviewStatus: 'approved'`,
`agentName`, `customerReference` and `providerStatus` all survive.

---

## 3. Evidence

`test/logging-redaction-at-sink.spec.ts` (11 assertions) emits **real log lines through a real pino
instance** built from the production options, then asserts on the serialized output. A test that inspected
the options object would have passed against the broken configuration, because the options looked complete —
the output did not.

Both fixes were checked to be independently load-bearing by reverting each in turn:

| Reverted                      | Result           |
| ----------------------------- | ---------------- |
| `formatters.log` hook removed | **5 of 11 fail** |
| Prefix rule removed           | **6 of 11 fail** |
| Both restored                 | 11/11 pass       |

---

## 4. Reading the logs

- Every record from every logger passes through object redaction. There is no "unredacted service log"
  category left by construction.
- `redactionFailure: true` in a record means the input was too large or too deep to inspect safely. Treat it
  as "this record's content is unknown", not as an empty log line. Its appearance is a signal about the
  emitting code, not about the request.
- `[REDACTED]` appears in place of a matched value; the key is preserved so the shape of the payload remains
  readable.
- Correlation identifiers propagate through the HTTP request context (`customProps`) and are emitted
  explicitly by workers that generate them (for example the cash-to-cash expiry tick).

---

## 5. What is not done

- **No log aggregation, shipping or retention policy.** Where these lines go, how long they are kept and who
  can read them is a deployment decision that is not implemented here.
- **No sampling, rate limiting or PII-free structured schema.** Records are structured JSON, but there is no
  enforced schema and no field allowlist.
- **Redaction is name-based, not value-based.** A secret placed in a generically named field (`note`,
  `comment`, `metadata.value`) is **not** detected. This is a real limitation: the rule understands names,
  not secrets. Callers must not put credentials in unlabelled fields.
- **No audit trail of redaction events.** A `redactionFailure` is emitted but not counted, alerted on
  (Group 19), or exported as a metric (Group 17).
- **Text-embedded secrets are handled by a separate scanner**, not by this group; see
  `redactSensitiveText` for the bounded raw-scan path used on exception text.

None of the above is claimed as working. Each is named with the group that owns it, or as a limitation a
reader must know.
