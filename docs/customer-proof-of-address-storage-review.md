# Customer Proof of Address: storage and upload review

**Status:** no approved document storage service was found. Database models and a disabled Customer 360° interface may be prepared, but this review does not authorize accepting, storing, previewing, or downloading customer files.

## Existing infrastructure reviewed

- `CustomerAddress` stores structured residential/business/mailing address fields; it is not a document store.
- `CustomerIdentityDocument` stores identity metadata (including a document number and dates); it does not store document images or files.
- `CustomerComplianceCase` and `ComplianceCaseEvidence` store case/document names, types, references, uploader text, and timestamps. They do not provide binary upload, private object storage, content inspection, malware scanning, or secure preview/download. The evidence controller accepts caller-supplied metadata and is not a reusable secure file-ingress boundary.
- `immutable_evidence_snapshot_attachments` is an internal policy-snapshot attachment/hash mechanism, not a general-purpose customer-document store or download service.
- No customer-scoped object/blob upload flow, signed-download service, MIME/magic-byte validation pipeline, quarantine, or malware-scanning integration was found in the reviewed `src` and Admin Web code.

Therefore, none of the inspected facilities is currently suitable to reuse for actual Proof of Address files without a security review and a purpose-built authorization boundary.

## Recommended architecture for approval

1. **Private object storage:** use a private bucket/container with public access blocked. Keep document bytes outside PostgreSQL. Use server-generated opaque object keys; do not put customer names, phone numbers, account numbers, or document numbers in paths.
2. **Authenticated ingress:** accept uploads only through a customer-scoped workforce endpoint. Resolve the authenticated principal server-side; never trust caller-supplied customer ID, uploader identity, MIME type, or size. Enforce the approved configurable size limit while streaming, not only from `Content-Length`.
3. **Quarantine and content checks:** allow only the requested PDF/JPG/JPEG/PNG families after checking extension, claimed media type, and file signatures. Treat all client metadata as untrusted. Quarantine first, malware-scan/sandbox, then publish the opaque storage reference only on a clean result. Reject malformed, polyglot, encrypted/unsupported, or oversized files according to the approved security policy.
4. **Encryption and least privilege:** require TLS in transit, managed encryption at rest, least-privilege service identities, key rotation, and private network/service access where available. Keep credentials out of application logs and client bundles.
5. **Safe retrieval:** reauthorize customer and workforce access for every preview/download. Prefer an authenticated streaming proxy or short-lived, object-specific signed access only after authorization. Set safe content-disposition and anti-sniffing headers; do not expose permanent object URLs. Isolate PDF/image preview from the Admin application origin or serve downloads by default until an approved preview design exists.
6. **History-preserving resubmission:** use a new opaque object key and a new immutable submission revision for each resubmission. Never overwrite the previous file. Store a server-computed checksum, detected media type, byte count, uploader principal, and timestamp as metadata only.
7. **Logging and retention:** emit metadata-only audit events (record ID, action, actor, timestamp, changed field names, and outcome). Never log file bytes, OCR/text extraction, document numbers, signed URLs, access tokens, or raw customer documents. Retention, legal hold, deletion, backup, and disaster-recovery periods require Compliance/Legal and platform approval; none is hard-coded here.
8. **Configuration:** keep maximum bytes, allowed formats, candidate evidence options, malware provider, and retention controls in approved operational configuration. No universal file-size or freshness number is selected by this implementation.

## Policy boundary

CBN Customer Due Diligence Regulations 2023, regulation 7, lists utility bills, tax assessments, bank statements, and a letter from a public authority among possible address-verification sources. That language does not itself define a universal Proof of Address acceptance list or document-freshness period. The four options surfaced in the UI are configurable **candidates only**, marked not approved; they are not automatically verified or treated as Tier 3 eligibility.

Until the storage design and authorization matrix are approved, the UI keeps file selection and upload disabled, and no upload/download/preview API is created.
