export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_NAMES = new Set([
  'password',
  'temporarypassword',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'pin',
  'pinhash',
  'currentpin',
  'newpin',
  'pinconfirmation',
  'token',
  'tokenhash',
  'applicantaccesstoken',
  'applicantaccesstokenhash',
  'accesstoken',
  'refreshtoken',
  'secret',
  'secretkey',
  'clientsecret',
  'apikey',
  'encryptedapikey',
  'proposedencryptedapikey',
  'authorization',
  'proxyauthorization',
  'xapikey',
  'xauthtoken',
  'cookie',
  'code',
  'codehash',
  'recoverycode',
  'challengehash',
  'providedhash',
  'devicefingerprinthash',
  'fingerprinthash',
  'identifierhash',
  'privatekey',
  'transfercode',
  'transfercodehash',
]);

const PROVIDER_REF_KEYS = new Set(['providerref', 'lasttestproviderref', 'lasttestedproviderref']);
const TEXT_SENSITIVE_KEYS = new Set([...SENSITIVE_KEY_NAMES].filter((key) => key !== 'code'));
const SAFE_DIAGNOSTIC_KEYS = new Set([
  'status',
  'statuscode',
  'errorcode',
  'requestid',
  'correlationid',
  'traceid',
  'path',
  'method',
  'operationname',
  'attempts',
  'channel',
  'eventtype',
  'eventkey',
]);
const VALUE_BOUNDARY_KEYS = new Set([
  ...TEXT_SENSITIVE_KEYS,
  ...PROVIDER_REF_KEYS,
  ...SAFE_DIAGNOSTIC_KEYS,
  'code',
]);
const CANONICAL_PROVIDER_REF = /^pvr1:(?:robase|brevo|resend|external):[0-9a-f]{32}$/i;
const CANONICAL_PROVIDER_REF_GLOBAL = /\bpvr1:(?:robase|brevo|resend|external):[0-9a-f]{32}/gi;

// Explicit budgets apply to structured JSON, prose, and direct objects. On structured-parser
// failure, the separately bounded raw scanner may still produce sanitized output; if it cannot
// prove that result safe, processing falls back to a generic message.
const MAX_INPUT_LENGTH = 256 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_TEXT_DEPTH = 12;
const MAX_JSON_NODES = 12_000;
const MAX_TEXT_KEY_MATCHES = 2_048;
const MAX_SCAN_OPERATIONS = 1_000_000;
const MAX_KEYLESS_CANDIDATES = 1_024;
const MAX_KEYLESS_LOOKAHEAD = 8_192;
const MAX_KEYLESS_SUFFIX_PARTS = 8;
const SAFE_JSON_DIAGNOSTIC_CODES = new Set([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'PAYMENT_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'NOT_ACCEPTABLE',
  'REQUEST_TIMEOUT',
  'CONFLICT',
  'GONE',
  'LENGTH_REQUIRED',
  'PRECONDITION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE_ENTITY',
  'TOO_MANY_REQUESTS',
  'INTERNAL_SERVER_ERROR',
  'NOT_IMPLEMENTED',
  'BAD_GATEWAY',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
]);

export function redactSensitiveData(value: unknown): unknown {
  try {
    const budget = { nodes: 0 };
    return redactObjectValue(value, new WeakSet<object>(), 0, budget);
  } catch {
    return REDACTED_VALUE;
  }
}

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSensitiveData(value);
  return isRecord(redacted) ? redacted : {};
}

/**
 * Redacts error/log text with bounded, fail-closed processing:
 *
 * 1. A small lossless JSON tokenizer handles complete JSON. It decodes property names, processes
 *    every raw property occurrence (including duplicate keys), enforces node/depth budgets, and
 *    re-emits source slices so unchanged JSON remains byte-identical. Sensitive values are
 *    replaced in-place with a JSON string; nested JSON strings are recursively processed within
 *    the same budgets.
 * 2. Non-JSON text is scanned once for sensitive key/value pairs and known credential shapes.
 *    Authorization values are consumed as a complete region to a safe boundary; no token-shape
 *    heuristic is used to decide whether a recognized Authorization value is secret.
 * 3. Key-less canonical provider references are preserved only when they are complete tokens or
 *    followed by ordinary prose. Credential-shaped suffixes (JWT, long opaque tokens, secret
 *    sentinels) cause the reference and suffix region to be removed.
 *
 * Oversized/text-depth input, direct-object budget exhaustion, or an unprovable raw-scan result
 * becomes the generic redacted *message*. Malformed/deep JSON is offered to the separately
 * bounded raw scanner; it returns sanitized text only if that scan completes safely, otherwise
 * the generic message. No parse/scan failure returns the original text. Context-free values
 * named `code` are diagnostics only for recognized HTTP status/error codes; other values redact.
 */
export function redactSensitiveText(value: string): string {
  if (typeof value !== 'string') return REDACTED_VALUE;
  if (value.length > MAX_INPUT_LENGTH) return REDACTED_VALUE;
  try {
    return redactTextBounded(value, 0);
  } catch {
    return REDACTED_VALUE;
  }
}

interface WorkBudget {
  operations: number;
}

function redactTextBounded(text: string, textDepth: number): string {
  if (text.length > MAX_INPUT_LENGTH || textDepth > MAX_TEXT_DEPTH) return REDACTED_VALUE;
  const start = skipWhitespace(text, 0);
  if (isLikelyJsonStart(text, start)) {
    try {
      const parser = new JsonTextRedactor(text, textDepth);
      const prefix = parser.parseDocumentPrefix();
      const suffix = text.slice(prefix.end);
      if (skipWhitespace(suffix, 0) === suffix.length) return prefix.output + suffix;
      // A valid embedded JSON value followed by diagnostics is not malformed; sanitize the
      // suffix independently and preserve both spans.
      return prefix.output + redactTextBounded(suffix, textDepth + 1);
    } catch {
      // Try the bounded raw scanner for malformed/escaped fragments. If it cannot establish a
      // safe sanitization, return only the generic message—not the original structured text.
      const fallback = redactUnstructuredText(text);
      return fallback === text ? REDACTED_VALUE : fallback;
    }
  }
  return redactUnstructuredText(text);
}

function redactUnstructuredText(text: string): string {
  const budget: WorkBudget = { operations: 0 };
  const textRedacted = redactKeyValueText(text, budget);
  if (textRedacted === null) return REDACTED_VALUE;
  const keyless = redactKeylessProviderRegions(textRedacted, budget);
  if (keyless === null) return REDACTED_VALUE;
  return applyCredentialShapes(keyless);
}

function isLikelyJsonStart(text: string, start: number): boolean {
  const first = charAt(text, start);
  const next = charAt(text, skipWhitespace(text, start + 1));
  if (first === '"') return true;
  if (first === '{') return next === '"' || next === '}';
  if (first !== '[') return false;
  return (
    next === '"' ||
    next === '{' ||
    next === '[' ||
    next === ']' ||
    next === '-' ||
    isDigit(next) ||
    next === 't' ||
    next === 'f' ||
    next === 'n'
  );
}

interface JsonValueResult {
  output: string;
  kind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  scalar?: string | number | boolean | null;
  changed: boolean;
}

/** Lossless-enough recursive JSON tokenizer; duplicate property occurrences are never collapsed. */
class JsonTextRedactor {
  private index = 0;
  private nodes = 0;
  private operations = 0;
  private readonly text: string;
  private readonly textDepth: number;

  constructor(text: string, textDepth: number) {
    this.text = text;
    this.textDepth = textDepth;
  }

  parseDocumentPrefix(): { output: string; end: number } {
    const leadingEnd = skipWhitespace(this.text, 0);
    this.index = leadingEnd;
    const result = this.parseValue(0);
    return { output: this.text.slice(0, leadingEnd) + result.output, end: this.index };
  }

  private parseValue(depth: number): JsonValueResult {
    this.bumpNode(depth);
    this.skipSpace();
    const char = charAt(this.text, this.index);
    if (char === '{') return this.parseObject(depth);
    if (char === '[') return this.parseArray(depth);
    if (char === '"') return this.parseString(depth);
    if (char === 't') return this.parseLiteral('true', 'boolean', true);
    if (char === 'f') return this.parseLiteral('false', 'boolean', false);
    if (char === 'n') return this.parseLiteral('null', 'null', null);
    if (char === '-' || isDigit(char)) return this.parseNumber();
    throw new Error('invalid JSON value');
  }

  private parseObject(depth: number): JsonValueResult {
    const parts: string[] = ['{'];
    let changed = false;
    this.index += 1;
    let wsStart = this.index;
    this.skipSpace();
    parts.push(this.text.slice(wsStart, this.index));
    if (charAt(this.text, this.index) === '}') {
      parts.push('}');
      this.index += 1;
      return { output: parts.join(''), kind: 'object', changed: false };
    }

    for (;;) {
      if (charAt(this.text, this.index) !== '"') throw new Error('object key must be a string');
      const keyToken = this.readStringToken();
      const key = keyToken.value;
      parts.push(keyToken.raw);

      wsStart = this.index;
      this.skipSpace();
      parts.push(this.text.slice(wsStart, this.index));
      if (charAt(this.text, this.index) !== ':') throw new Error('missing object colon');
      parts.push(':');
      this.index += 1;
      wsStart = this.index;
      this.skipSpace();
      parts.push(this.text.slice(wsStart, this.index));

      const child = this.parseValue(depth + 1);
      const replacement = shouldRedactJsonProperty(key, child);
      if (replacement) {
        parts.push(JSON.stringify(REDACTED_VALUE));
        changed = true;
      } else {
        parts.push(child.output);
        changed = changed || child.changed;
      }

      wsStart = this.index;
      this.skipSpace();
      parts.push(this.text.slice(wsStart, this.index));
      const separator = charAt(this.text, this.index);
      if (separator === ',') {
        parts.push(',');
        this.index += 1;
        wsStart = this.index;
        this.skipSpace();
        parts.push(this.text.slice(wsStart, this.index));
        continue;
      }
      if (separator === '}') {
        parts.push('}');
        this.index += 1;
        break;
      }
      throw new Error('unterminated JSON object');
    }
    return { output: parts.join(''), kind: 'object', changed };
  }

  private parseArray(depth: number): JsonValueResult {
    const parts: string[] = ['['];
    let changed = false;
    this.index += 1;
    let wsStart = this.index;
    this.skipSpace();
    parts.push(this.text.slice(wsStart, this.index));
    if (charAt(this.text, this.index) === ']') {
      parts.push(']');
      this.index += 1;
      return { output: parts.join(''), kind: 'array', changed: false };
    }

    for (;;) {
      const child = this.parseValue(depth + 1);
      parts.push(child.output);
      changed = changed || child.changed;
      wsStart = this.index;
      this.skipSpace();
      parts.push(this.text.slice(wsStart, this.index));
      const separator = charAt(this.text, this.index);
      if (separator === ',') {
        parts.push(',');
        this.index += 1;
        wsStart = this.index;
        this.skipSpace();
        parts.push(this.text.slice(wsStart, this.index));
        continue;
      }
      if (separator === ']') {
        parts.push(']');
        this.index += 1;
        break;
      }
      throw new Error('unterminated JSON array');
    }
    return { output: parts.join(''), kind: 'array', changed };
  }

  private parseString(depth: number): JsonValueResult {
    const token = this.readStringToken();
    const sanitized = redactTextBounded(token.value, this.textDepth + depth + 1);
    const changed = sanitized !== token.value;
    return {
      output: changed ? JSON.stringify(sanitized) : token.raw,
      kind: 'string',
      scalar: token.value,
      changed,
    };
  }

  private parseNumber(): JsonValueResult {
    const start = this.index;
    while (this.index < this.text.length && /[0-9eE+\-.]/.test(charAt(this.text, this.index))) {
      this.index += 1;
      this.bumpOperation();
    }
    const raw = this.text.slice(start, this.index);
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) {
      throw new Error('invalid JSON number');
    }
    return { output: raw, kind: 'number', scalar: Number(raw), changed: false };
  }

  private parseLiteral<T extends 'boolean' | 'null'>(
    literal: string,
    kind: T,
    scalar: T extends 'boolean' ? boolean : null,
  ): JsonValueResult {
    if (this.text.slice(this.index, this.index + literal.length) !== literal) {
      throw new Error('invalid JSON literal');
    }
    this.index += literal.length;
    this.bumpOperation(literal.length);
    return { output: literal, kind, scalar, changed: false };
  }

  private readStringToken(): { raw: string; value: string } {
    const start = this.index;
    this.index += 1;
    let closed = false;
    while (this.index < this.text.length) {
      const char = charAt(this.text, this.index);
      if (char === '"') {
        this.index += 1;
        closed = true;
        break;
      }
      if (char === '\\') {
        this.index += 2;
      } else {
        if (char.charCodeAt(0) < 0x20) throw new Error('control character in JSON string');
        this.index += 1;
      }
      this.bumpOperation();
    }
    if (!closed) throw new Error('unterminated JSON string');
    const raw = this.text.slice(start, this.index);
    const value = JSON.parse(raw) as string;
    this.bumpOperation(raw.length);
    return { raw, value };
  }

  private skipSpace(): void {
    while (isJsonWhitespace(charAt(this.text, this.index))) {
      this.index += 1;
      this.bumpOperation();
    }
  }

  private bumpNode(depth: number): void {
    if (depth > MAX_JSON_DEPTH) throw new Error('JSON nesting limit exceeded');
    this.nodes += 1;
    if (this.nodes > MAX_JSON_NODES) throw new Error('JSON node limit exceeded');
    this.bumpOperation();
  }

  private bumpOperation(amount = 1): void {
    // Parsing is linear and input length is already capped. This local guard also protects
    // against future parser changes that accidentally revisit spans super-linearly.
    this.operations += amount;
    if (this.operations > MAX_SCAN_OPERATIONS) throw new Error('JSON processing limit exceeded');
  }
}

function shouldRedactJsonProperty(key: string, value: JsonValueResult): boolean {
  const normalized = normalizeKeyName(key);
  if (value.kind === 'null' || (value.kind === 'string' && value.scalar === REDACTED_VALUE))
    return false;
  if (PROVIDER_REF_KEYS.has(normalized)) {
    return !(
      value.kind === 'string' &&
      typeof value.scalar === 'string' &&
      CANONICAL_PROVIDER_REF.test(value.scalar)
    );
  }
  if (normalized === 'code') return !isDiagnosticCode(value);
  return TEXT_SENSITIVE_KEYS.has(normalized);
}

function isDiagnosticCode(value: JsonValueResult): boolean {
  if (value.kind === 'number' && typeof value.scalar === 'number') {
    return Number.isInteger(value.scalar) && value.scalar >= 100 && value.scalar <= 599;
  }
  if (value.kind !== 'string' || typeof value.scalar !== 'string') return false;
  const code = value.scalar.toUpperCase();
  return SAFE_JSON_DIAGNOSTIC_CODES.has(code) || /^E_[A-Z0-9_]{1,32}$/.test(code);
}

interface TextKey {
  rawEnd: number;
  normalized: string;
}

function scanTextKey(text: string, start: number): TextKey | null {
  if (start > 0 && isTextWordChar(charAt(text, start - 1))) return null;
  const pieces: string[] = [];
  let index = start;
  let tooLong = false;
  while (index < text.length) {
    const char = charAt(text, index);
    if (isTextWordChar(char)) {
      if (!tooLong) pieces.push(char);
      index += 1;
    } else if (isUnicodeEscapeAt(text, index)) {
      if (!tooLong)
        pieces.push(String.fromCharCode(parseInt(text.slice(index + 2, index + 6), 16)));
      index += 6;
    } else {
      break;
    }
    if (index - start > 256) {
      tooLong = true;
      pieces.length = 0;
    }
  }
  if (index === start || tooLong) return null;
  return { rawEnd: index, normalized: normalizeKeyName(pieces.join('')) };
}

interface TextSeparator {
  start: number;
  valueStart: number;
  valueQuote: string | null;
  escapedOpen: boolean;
}

function scanTextSeparator(text: string, start: number): TextSeparator | null {
  let index = start;
  while (isHorizontalWhitespace(charAt(text, index))) index += 1;
  if (charAt(text, index) === '\\' && isQuoteChar(charAt(text, index + 1))) index += 2;
  else if (isQuoteChar(charAt(text, index))) index += 1;
  while (isHorizontalWhitespace(charAt(text, index))) index += 1;
  if (charAt(text, index) !== ':' && charAt(text, index) !== '=') return null;
  index += 1;
  if (charAt(text, index) === '>') index += 1;
  while (isHorizontalWhitespace(charAt(text, index))) index += 1;
  let valueQuote: string | null = null;
  let escapedOpen = false;
  if (charAt(text, index) === '\\' && isQuoteChar(charAt(text, index + 1))) {
    valueQuote = charAt(text, index + 1);
    escapedOpen = true;
    index += 2;
  } else if (isQuoteChar(charAt(text, index))) {
    valueQuote = charAt(text, index);
    index += 1;
  }
  return { start, valueStart: index, valueQuote, escapedOpen };
}

function redactKeyValueText(text: string, budget: WorkBudget): string | null {
  const chunks: string[] = [];
  let changed = false;
  let outputCursor = 0;
  let index = 0;
  let matches = 0;
  while (index < text.length) {
    budget.operations += 1;
    if (budget.operations > MAX_SCAN_OPERATIONS) return null;
    if (!isTextWordStart(text, index)) {
      index += 1;
      continue;
    }
    const key = scanTextKey(text, index);
    if (!key) {
      index += 1;
      continue;
    }
    const isProviderRef = PROVIDER_REF_KEYS.has(key.normalized);
    const isAuthorization =
      key.normalized === 'authorization' || key.normalized === 'proxyauthorization';
    const isCodeKey = key.normalized === 'code';
    const isSensitive = !isProviderRef && (TEXT_SENSITIVE_KEYS.has(key.normalized) || isCodeKey);
    if (!isProviderRef && !isSensitive) {
      index = key.rawEnd;
      continue;
    }
    const separator = scanTextSeparator(text, key.rawEnd);
    if (!separator) {
      index = key.rawEnd;
      continue;
    }
    matches += 1;
    if (matches > MAX_TEXT_KEY_MATCHES) return null;
    const valueStart = separator.valueStart;
    let valueEnd: number;
    let replacement = true;

    if (separator.valueQuote !== null) {
      if (separator.escapedOpen) {
        // An escaped inner quote has ambiguous ownership in malformed/prose context. The whole
        // message is safer than guessing which escaped quote closes the secret value.
        return REDACTED_VALUE;
      }
      const quoted = scanQuotedText(text, valueStart, separator.valueQuote);
      valueEnd = quoted.end;
      if (isProviderRef && quoted.closed && CANONICAL_PROVIDER_REF.test(quoted.value))
        replacement = false;
      if (isCodeKey && quoted.closed && isPlainDiagnosticCode(quoted.value)) replacement = false;
      if (!quoted.closed) valueEnd = text.length;
    } else {
      const runEnd = scanSingleRunEnd(text, valueStart);
      const firstRun = text.slice(valueStart, runEnd);
      if (isProviderRef && CANONICAL_PROVIDER_REF.test(firstRun)) {
        const next = charAt(text, runEnd);
        if (isSafeProviderBoundary(next)) {
          index = key.rawEnd;
          continue;
        }
        valueEnd = findProviderFieldEnd(text, valueStart, budget);
      } else if (isProviderRef) {
        valueEnd = findProviderFieldEnd(text, valueStart, budget);
      } else if (isCodeKey && isPlainDiagnosticCode(firstRun)) {
        index = key.rawEnd;
        continue;
      } else if (isAuthorization) {
        valueEnd = findUnquotedFieldEnd(text, valueStart, budget);
      } else {
        valueEnd = findGenericSecretEnd(text, valueStart, budget);
      }
      if (valueEnd < 0) return null;
      if (valueStart === valueEnd) valueEnd = Math.min(text.length, valueStart);
    }

    if (replacement) {
      chunks.push(text.slice(outputCursor, valueStart));
      chunks.push(REDACTED_VALUE);
      if (
        separator.valueQuote !== null &&
        valueEnd > valueStart &&
        text[valueEnd - 1] === separator.valueQuote
      ) {
        chunks.push(separator.valueQuote);
      }
      outputCursor = valueEnd;
      changed = true;
      index = Math.max(valueEnd, key.rawEnd);
    } else {
      index = key.rawEnd;
    }
  }
  if (!changed) return text;
  chunks.push(text.slice(outputCursor));
  return chunks.join('');
}

function scanQuotedText(
  text: string,
  start: number,
  quote: string,
): { value: string; end: number; closed: boolean } {
  let index = start;
  while (index < text.length) {
    const char = charAt(text, index);
    if (char === '\\') {
      index += index + 1 < text.length ? 2 : 1;
      continue;
    }
    if (char === quote) return { value: text.slice(start, index), end: index + 1, closed: true };
    index += 1;
  }
  return { value: text.slice(start), end: text.length, closed: false };
}

function scanSingleRunEnd(text: string, start: number): number {
  let index = start;
  while (
    index < text.length &&
    !isWhitespace(charAt(text, index)) &&
    !isTextDelimiter(charAt(text, index))
  )
    index += 1;
  return index;
}

function findUnquotedFieldEnd(text: string, start: number, budget: WorkBudget): number {
  let index = start;
  while (index < text.length) {
    budget.operations += 1;
    if (budget.operations > MAX_SCAN_OPERATIONS) return -1;
    const char = charAt(text, index);
    if (
      char === '\n' ||
      char === '\r' ||
      char === ',' ||
      char === ';' ||
      char === '}' ||
      char === ']' ||
      char === ')' ||
      char === '"' ||
      char === "'"
    )
      return index;
    if (isWhitespace(char)) {
      const next = skipWhitespace(text, index);
      if (looksLikeKeyValueAt(text, next)) return index;
    }
    index += 1;
  }
  return text.length;
}

function findGenericSecretEnd(text: string, start: number, budget: WorkBudget): number {
  let end = scanSingleRunEnd(text, start);
  if (end === start) return end;
  let priorRun = text.slice(start, end).toLowerCase();
  for (let part = 0; part < MAX_KEYLESS_SUFFIX_PARTS; part += 1) {
    let next = end;
    while (isHorizontalWhitespace(charAt(text, next))) next += 1;
    if (next === end || looksLikeKeyValueAt(text, next)) break;
    const candidateEnd = scanSingleRunEnd(text, next);
    if (candidateEnd === next) break;
    const candidate = text.slice(next, candidateEnd);
    const schemeFollowup = priorRun === 'bearer' || priorRun === 'basic';
    if (!schemeFollowup && !isCredentialLike(candidate)) break;
    end = candidateEnd;
    priorRun = candidate.toLowerCase();
    budget.operations += candidateEnd - next;
    if (budget.operations > MAX_SCAN_OPERATIONS) return -1;
  }
  return end;
}

function findProviderFieldEnd(text: string, start: number, budget: WorkBudget): number {
  let index = start;
  while (index < text.length) {
    budget.operations += 1;
    if (budget.operations > MAX_SCAN_OPERATIONS) return -1;
    const char = charAt(text, index);
    if (
      char === ',' ||
      char === '}' ||
      char === ']' ||
      char === ')' ||
      char === '"' ||
      char === "'"
    )
      return index;
    if (char === ';') {
      const next = skipWhitespace(text, index + 1);
      if (charAt(text, next) === '{' || looksLikeKeyValueAt(text, next)) return index;
    }
    if (isWhitespace(char)) {
      const next = skipWhitespace(text, index);
      if (looksLikeKeyValueAt(text, next)) return index;
    }
    index += 1;
  }
  return text.length;
}

function isSafeProviderBoundary(char: string): boolean {
  return (
    char === '' ||
    char === ',' ||
    char === '}' ||
    char === ']' ||
    char === ')' ||
    char === '"' ||
    char === "'"
  );
}

function looksLikeKeyValueAt(text: string, start: number): boolean {
  const key = scanTextKey(text, start);
  if (!key) return false;
  if (!VALUE_BOUNDARY_KEYS.has(key.normalized)) return false;
  return scanTextSeparator(text, key.rawEnd) !== null;
}

interface ProviderSuffix {
  credential: boolean;
  end: number;
}

function inspectProviderSuffix(text: string, runEnd: number, budget: WorkBudget): ProviderSuffix {
  let index = runEnd;
  let parts = 0;
  let foundCredential = false;
  let credentialEnd = runEnd;
  const stop = Math.min(text.length, runEnd + MAX_KEYLESS_LOOKAHEAD);
  // Report 19 finding A: a fragment ATTACHED directly to the canonical token (no whitespace)
  // belongs to the same provider-reference region. Scan it as the first suffix part so a
  // credential-shaped part later in the region still removes the complete region, instead of
  // stopping the scan before the attachment and leaving the credential visible.
  if (
    index < stop &&
    !isWhitespace(charAt(text, index)) &&
    !isTextDelimiter(charAt(text, index)) &&
    !looksLikeKeyValueAt(text, index)
  ) {
    const partStart = index;
    while (
      index < stop &&
      !isWhitespace(charAt(text, index)) &&
      !isTextDelimiter(charAt(text, index))
    ) {
      index += 1;
      budget.operations += 1;
    }
    parts += 1;
    const part = text.slice(partStart, index);
    if (isCredentialLike(part)) {
      foundCredential = true;
      credentialEnd = index;
    }
    if (budget.operations > MAX_SCAN_OPERATIONS) return { credential: true, end: -1 };
  }
  while (!foundCredential && index < stop && parts < MAX_KEYLESS_SUFFIX_PARTS) {
    const whitespaceStart = index;
    while (index < stop && isWhitespace(charAt(text, index))) {
      index += 1;
      budget.operations += 1;
    }
    if (index === whitespaceStart || index >= stop || isTextDelimiter(charAt(text, index))) break;
    if (looksLikeKeyValueAt(text, index)) break;
    const partStart = index;
    while (
      index < stop &&
      !isWhitespace(charAt(text, index)) &&
      !isTextDelimiter(charAt(text, index))
    ) {
      index += 1;
      budget.operations += 1;
    }
    const part = text.slice(partStart, index);
    parts += 1;
    if (isCredentialLike(part)) {
      foundCredential = true;
      credentialEnd = index;
      break;
    }
    if (budget.operations > MAX_SCAN_OPERATIONS) return { credential: true, end: -1 };
  }
  return { credential: foundCredential, end: credentialEnd };
}

function redactKeylessProviderRegions(text: string, budget: WorkBudget): string | null {
  CANONICAL_PROVIDER_REF_GLOBAL.lastIndex = 0;
  const chunks: string[] = [];
  let cursor = 0;
  let candidates = 0;
  let match: RegExpExecArray | null;
  while ((match = CANONICAL_PROVIDER_REF_GLOBAL.exec(text)) !== null) {
    candidates += 1;
    if (candidates > MAX_KEYLESS_CANDIDATES) return null;
    const endToken = match.index + match[0].length;
    const suffix = inspectProviderSuffix(text, endToken, budget);
    if (suffix.end < 0) return null;
    if (suffix.credential && suffix.end > endToken) {
      chunks.push(text.slice(cursor, match.index), REDACTED_VALUE);
      cursor = suffix.end;
      CANONICAL_PROVIDER_REF_GLOBAL.lastIndex = Math.max(
        CANONICAL_PROVIDER_REF_GLOBAL.lastIndex,
        cursor,
      );
    }
    if (budget.operations > MAX_SCAN_OPERATIONS) return null;
  }
  if (cursor === 0) return text;
  chunks.push(text.slice(cursor));
  return chunks.join('');
}

function applyCredentialShapes(text: string): string {
  return (
    text
      .replace(
        /\bMNNPS1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}/g,
        REDACTED_VALUE,
      )
      .replace(/\b(?:robe|re)_[A-Za-z0-9_-]{8,}\b/g, REDACTED_VALUE)
      .replace(/\b(?:xkeysib|xsmtpsib)-[A-Za-z0-9_-]{8,}\b/gi, REDACTED_VALUE)
      .replace(
        /\bpvr1:(?:robase|brevo|resend|external):[0-9a-f]{32}(?!\\["'])[^,\s}"';)(\x5b\]]+/gi,
        REDACTED_VALUE,
      )
      // Report 21/23/25 findings: an explicit authentication scheme prefix is credential
      // context. HTTP auth schemes are case-insensitive (RFC 7235) and RFC 6750 b64token
      // permits one-or-more token characters, so report 25 replaced the former two-branch
      // shape (canonical-casing Branch A and marker-gated Branch B, both with a >=4-character
      // floor) with a single unified rule: any casing of `basic`/`bearer` (word-bounded)
      // followed by whitespace and a run of at least one token character is redacted as a
      // complete credential region. Documented policy trade-off (report 25 mandate: explicit
      // credentials outweigh ambiguous prose): an ordinary word directly after a scheme word
      // (`the bearer of good news`) is conservatively redacted, while a scheme word followed
      // by a colon (`Basic: ...`), bare scheme words, and context-free strings without a
      // scheme prefix are never touched by this shape.
      .replace(
        /\b(?:[bB][aA][sS][iI][cC]|[bB][eE][aA][rR][eE][rR])\s+[^\s"',;:()[\]{}|\\`]*[A-Za-z0-9+/=_-]/g,
        REDACTED_VALUE,
      )
      // Report 19 finding B variant: a bare (key-less) JWT in a diagnostic field is a credential
      // wherever it appears. `eyJ` is the base64url encoding of `{"` — the universal JWT header
      // marker — so a three-segment eyJ token is redacted without touching ordinary prose.
      .replace(/\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}/g, REDACTED_VALUE)
  );
}

function isCredentialLike(value: string): boolean {
  if (value.length < 4) return false;
  if (value.includes('_') && /[A-Z]/.test(value) && /[A-Z0-9]/.test(value)) return true;
  if (value.length < 8) return false;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true;
  if (
    value.length >= 32 &&
    /^[A-Za-z0-9_-]+$/.test(value) &&
    /[A-Za-z]/.test(value) &&
    /[0-9]/.test(value)
  )
    return true;
  if (/^[a-f0-9]{24,}$/i.test(value) && /[0-9]/.test(value)) return true;
  if (/(?:xkeysib|xsmtpsib)-[A-Za-z0-9_-]{8,}|(?:robe|re)_[A-Za-z0-9_-]{8,}/i.test(value))
    return true;
  if (value.includes('_') && /[A-Z]/.test(value) && /[A-Z0-9]/.test(value)) return true;
  return /^[A-Z0-9]{8,}$/.test(value) && /[0-9]/.test(value) && /[A-Z]/.test(value);
}

function isPlainDiagnosticCode(value: string): boolean {
  const trimmed = value.trim();
  if (/^\d{3}$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return numeric >= 100 && numeric <= 599;
  }
  const normalized = trimmed.toUpperCase();
  return SAFE_JSON_DIAGNOSTIC_CODES.has(normalized) || /^E_[A-Z0-9_]{1,32}$/.test(normalized);
}

function normalizeKeyName(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, '');
}

function isTextWordStart(text: string, index: number): boolean {
  if (index > 0 && isTextWordChar(charAt(text, index - 1))) return false;
  return isTextWordChar(charAt(text, index)) || isUnicodeEscapeAt(text, index);
}

function isTextWordChar(char: string): boolean {
  return (
    (char >= 'a' && char <= 'z') ||
    (char >= 'A' && char <= 'Z') ||
    (char >= '0' && char <= '9') ||
    char === '_' ||
    char === '-'
  );
}

function isTextDelimiter(char: string): boolean {
  return (
    char === ',' ||
    char === ';' ||
    char === '}' ||
    char === ']' ||
    char === ')' ||
    char === '(' ||
    char === '"' ||
    char === "'" ||
    char === '{' ||
    char === '['
  );
}

function isHorizontalWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\f' || char === '\v';
}

function isWhitespace(char: string): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f' ||
    char === '\v'
  );
}

function isJsonWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isQuoteChar(char: string): boolean {
  return char === '"' || char === "'";
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isHexDigit(char: string): boolean {
  return isDigit(char) || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F');
}

function isUnicodeEscapeAt(text: string, index: number): boolean {
  return (
    charAt(text, index) === '\\' &&
    charAt(text, index + 1) === 'u' &&
    isHexDigit(charAt(text, index + 2)) &&
    isHexDigit(charAt(text, index + 3)) &&
    isHexDigit(charAt(text, index + 4)) &&
    isHexDigit(charAt(text, index + 5))
  );
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (isWhitespace(charAt(text, index))) index += 1;
  return index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ObjectBudget {
  nodes: number;
}

function redactObjectValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  budget: ObjectBudget,
): unknown {
  budget.nodes += 1;
  if (depth > MAX_JSON_DEPTH || budget.nodes > MAX_JSON_NODES)
    throw new Error('object redaction budget exceeded');
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (const item of value) output.push(redactObjectValue(item, seen, depth + 1, budget));
    return output;
  }
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return REDACTED_VALUE;
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const nestedValue = (value as Record<string, unknown>)[key];
    output[key] = isObjectSensitiveKey(key)
      ? REDACTED_VALUE
      : redactObjectValue(nestedValue, seen, depth + 1, budget);
  }
  return output;
}

function isObjectSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_NAMES.has(normalizeKeyName(key));
}

function charAt(text: string, index: number): string {
  return text[index] ?? '';
}

/**
 * Report 25: shared diagnostic-path boundary for URL-derived strings (moved verbatim
 * out of `GlobalExceptionFilter` so every URL sink uses one implementation). Query
 * strings and fragments routinely carry credentials (signed links, integration
 * callbacks, misconfigured clients) and have no diagnostic value, so everything from
 * the first '?' or '#' is excluded and the remainder still passes through the full
 * redaction boundary. Pure string operations: malformed URLs cannot throw.
 */
export function redactDiagnosticPath(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) return REDACTED_VALUE;
  const cut = url.search(/[?#]/);
  const path = cut >= 0 ? url.slice(0, cut) : url;
  return redactSensitiveText(path);
}

/**
 * Report 25: variant of `redactDiagnosticPath` for raw request URLs. Percent-encoded
 * sequences can smuggle a scheme credential (`bearer%20abcdefgh`) past the text rule,
 * so the query-free path is percent-decoded before redaction; malformed escapes fall
 * back to the raw path, which is still redacted. Bounded: cannot throw.
 */
export function redactRequestUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) return REDACTED_VALUE;
  const cut = url.search(/[?#]/);
  const rawPath = cut >= 0 ? url.slice(0, cut) : url;
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Malformed percent-encoding must never throw at a diagnostic boundary.
  }
  return redactDiagnosticPath(decoded);
}

/**
 * Report 25: sanitizes route-parameter values for structured request logs. Parameter
 * keys come from the application's own route templates (trusted); values are
 * client-controlled and pass through the full redaction boundary. Hostile or
 * unserializable values fail closed to the canonical redaction marker.
 */
export function sanitizeDiagnosticParams(value: unknown): Record<string, string> {
  const output: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return output;
  try {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (raw === undefined) continue;
      try {
        if (typeof raw === 'string') {
          output[key] = redactSensitiveText(raw);
        } else if (Array.isArray(raw)) {
          // Array.isArray throws on revoked Proxies; join may throw on hostile
          // arrays — both degrade to the canonical marker below.
          output[key] = redactSensitiveText(raw.join(','));
        } else {
          output[key] = REDACTED_VALUE;
        }
      } catch {
        output[key] = REDACTED_VALUE;
      }
    }
  } catch {
    // A hostile object (e.g. throwing entries/getters) fails closed to what was built.
  }
  return output;
}
