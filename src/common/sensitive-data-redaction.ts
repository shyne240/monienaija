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

export function redactSensitiveData(value: unknown): unknown {
  return redact(value, new WeakSet<object>());
}

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSensitiveData(value);
  return isRecord(redacted) ? redacted : {};
}

/*
 * ============================================================================
 * ERROR/LOG TEXT REDACTION (SPRINT1-F01 residuals R-03/R-04, Arena 4 reports
 * 13–15). Architecture: four separated layers instead of interleaved regex
 * exemptions —
 *
 *  A. STRUCTURED JSON: when the whole string is valid JSON, parse it and walk
 *     the structure. JSON.parse decodes `\uXXXX`-escaped property names, so
 *     escaped key spellings (`{"api\u004Bey":...}`) cannot bypass key
 *     classification (report 15, F1). String VALUES are walked recursively
 *     (stringified inner JSON is parsed, redacted and re-serialized), which
 *     preserves complete non-sensitive nested structure instead of truncating
 *     it (report 15, F4). Unchanged structures are returned byte-identical.
 *  B. EMBEDDED JSON FRAGMENTS: balanced `{...}`/`[...]` candidates inside
 *     prose are string/escape-aware scanned, parse-attempted and walked like
 *     layer A; failed candidates fall through to layer C. Bounded candidate
 *     count and fragment length keep hostile inputs linear.
 *  C. UNSTRUCTURED KEY/VALUE SCANNER: word-boundary key matching (maximal
 *     `[A-Za-z0-9_-]` runs, `\uXXXX` escape groups decoded for classification,
 *     normalized like the object-level redactor) against TEXT_SENSITIVE_KEYS
 *     and the provider-reference key set. Separators (`:`/`=`/`=>`, optional
 *     whitespace, optional — including backslash-escaped — quotes) are
 *     preserved verbatim so redacted JSON stays parseable (report 14, R-04).
 *     Quoted values are captured through the matching quote honoring escape
 *     pairs and the escaped-open context (`\"..\"` inside stringified JSON).
 *     Unquoted values use syntax-aware regions (report 15, F2): the first run
 *     is always redacted; the region then extends over sentinel-shaped runs
 *     (`_`-bearing or all-caps/digit) so multi-word credentials such as
 *     `Authorization: Bearer <cred>` or `apiKey=PART_ONE PART_TWO` are fully
 *     consumed, stopping at hard delimiters, newlines (header semantics) and
 *     the next `key=value` pair so ordinary diagnostics survive. A canonical
 *     provider token followed by whitespace is ambiguous (a malformed
 *     reference with a whitespace suffix cannot be ruled out) and fails safe
 *     through the next hard delimiter (report 14, R-03).
 *  D. KEY-LESS PROVIDER REFERENCES: a bare canonical `pvr1:` token followed by
 *     whitespace-separated sentinel-shaped runs is redacted as a region
 *     (report 15, F3); tokens surrounded by ordinary prose are preserved.
 *  E. CREDENTIAL SHAPE PATTERNS: attached malformed `pvr1:` suffixes, MNNPS1
 *     envelopes, `robe_`/`re_`/`xkeysib-`/`smtpsib-` credential shapes.
 *
 * Policy notes:
 *  - Only a COMPLETE canonical token (`^pvr1:(robase|brevo|resend|external):
 *    [0-9a-f]{32}$`) is ever exempt; prefixes/ suffixes/ malformed scopes or
 *    digests are redacted in full.
 *  - `code` is excluded from TEXT-level keys (report 15, F5): `code: 400`,
 *    `statusCode` and `errorCode` are ordinary diagnostics. Genuinely secret
 *    code-family keys (`codeHash`, `recoveryCode`, `transferCode`,
 *    `challengeHash`, ...) remain redacted, and the object-level redactor
 *    (audit/outbox payloads) keeps its full historical key set.
 *  - No regex backtracking on key/value paths; parsing is depth-, candidate-
 *    and length-bounded; hostile multi-MB inputs stay linear.
 * ============================================================================
 */

/** Index-safe char read (this project compiles with noUncheckedIndexedAccess). */
function charAt(text: string, index: number): string {
  return text[index] ?? '';
}

function normalizeKeyName(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/** Provider-reference key spellings (normalized). */
const PROVIDER_REF_TEXT_KEYS = new Set([
  'providerref',
  'lasttestproviderref',
  'lasttestedproviderref',
]);

/**
 * Text/JSON-in-error-text sensitive keys: the full object-level list (preserving its intended
 * coverage: bare `token`, `password`, `apiKey`, `authorization`, `secret`, ...) minus `code`
 * (ordinary diagnostic metadata — report 15 F5) plus common HTTP header spellings.
 */
const TEXT_SENSITIVE_KEYS = new Set<string>([
  ...Array.from(SENSITIVE_KEY_NAMES).filter((key) => key !== 'code'),
  'xapikey',
  'xauthtoken',
  'proxyauthorization',
]);

/** The ONLY provider-reference shape exempt from redaction: a complete canonical token. */
const CANONICAL_PROVIDER_REF = /^pvr1:(?:robase|brevo|resend|external):[0-9a-f]{32}$/i;

/** Bare canonical tokens in text (used by the key-less region pass). */
const CANONICAL_PROVIDER_REF_GLOBAL = /\bpvr1:(?:robase|brevo|resend|external):[0-9a-f]{32}/gi;

/** Hard delimiters that terminate value regions and key-less regions. */
const HARD_REGION_STOPPERS = new Set([',', ';', '{', '}', '(', ')', '[', ']', '"', "'"]);

/** Terminators of a single unquoted value run. */
const UNQUOTED_RUN_TERMINATORS = new Set([',', '}', ']', '"', "'"]);

const MAX_STRUCTURE_DEPTH = 16;
const MAX_FRAGMENT_CANDIDATES = 128;
const MAX_FRAGMENT_LENGTH = 65_536;

export function redactSensitiveText(value: string): string {
  return redactTextAtDepth(value, 0);
}

function redactTextAtDepth(value: string, depth: number): string {
  if (depth < MAX_STRUCTURE_DEPTH) {
    const trimmed = value.trim();
    const first = charAt(trimmed, 0);
    if (first === '{' || first === '[') {
      const parsed = tryParseJson(trimmed);
      if (parsed !== undefined) {
        const walked = walkValue(parsed, depth + 1);
        // Byte-preserve untouched diagnostics; re-serialize only when something was redacted.
        return applyShapePatterns(
          walked.changed ? JSON.stringify(walked.value) : value,
        );
      }
    }
  }
  const withFragments = redactEmbeddedJsonFragments(value, depth);
  const scanned = redactKeyValueText(withFragments);
  const keyless = redactKeylessProviderRegions(scanned);
  return applyShapePatterns(keyless);
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

interface WalkResult {
  value: unknown;
  changed: boolean;
}

function walkValue(node: unknown, depth: number): WalkResult {
  if (Array.isArray(node)) {
    let changed = false;
    const items = node.map((item) => {
      const walked = walkValue(item, depth + 1);
      changed = changed || walked.changed;
      return walked.value;
    });
    return { value: items, changed };
  }
  if (isRecord(node)) {
    let changed = false;
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(node)) {
      const normalized = normalizeKeyName(key);
      const isProviderRef = PROVIDER_REF_TEXT_KEYS.has(normalized);
      const isSensitive = !isProviderRef && TEXT_SENSITIVE_KEYS.has(normalized);
      if (isProviderRef || isSensitive) {
        // `null`/`undefined` carry no secret; keep them for diagnostic fidelity.
        if (nested === null || nested === undefined) {
          output[key] = nested;
          continue;
        }
        const exempt =
          isProviderRef && typeof nested === 'string' && CANONICAL_PROVIDER_REF.test(nested);
        output[key] = exempt ? nested : REDACTED_VALUE;
        changed = changed || !exempt && nested !== REDACTED_VALUE;
        continue;
      }
      const walked = walkValue(nested, depth + 1);
      changed = changed || walked.changed;
      output[key] = walked.value;
    }
    return { value: output, changed };
  }
  if (typeof node === 'string') {
    return walkString(node, depth);
  }
  return { value: node, changed: false };
}

/**
 * String values inside parsed JSON: either they are themselves serialized JSON
 * (stringified inner objects — parse, walk, re-serialize so the COMPLETE structure
 * survives; report 15 F4) or prose (run the fragment/key-value/key-less layers).
 */
function walkString(text: string, depth: number): WalkResult {
  if (depth >= MAX_STRUCTURE_DEPTH) {
    return { value: text, changed: false };
  }
  const trimmed = text.trim();
  const first = charAt(trimmed, 0);
  if (first === '{' || first === '[') {
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) {
      const walked = walkValue(parsed, depth + 1);
      return walked.changed
        ? { value: JSON.stringify(walked.value), changed: true }
        : { value: text, changed: false };
    }
  }
  const withFragments = redactEmbeddedJsonFragments(text, depth + 1);
  const scanned = redactKeyValueText(withFragments);
  const keyless = redactKeylessProviderRegions(scanned);
  const shaped = applyShapePatterns(keyless);
  return { value: shaped, changed: shaped !== text };
}

/** String/escape-aware scan for the balanced closing bracket of a JSON fragment. */
function findBalancedJsonEnd(text: string, start: number): number {
  const n = text.length;
  const limit = Math.min(n, start + MAX_FRAGMENT_LENGTH + 1);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < limit; i += 1) {
    const c = charAt(text, i);
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** Layer B: redact balanced, parseable JSON fragments embedded in prose. */
function redactEmbeddedJsonFragments(text: string, depth: number): string {
  if (depth >= MAX_STRUCTURE_DEPTH) return text;
  const n = text.length;
  let out = '';
  let last = 0;
  let i = 0;
  let candidates = 0;
  while (i < n) {
    const c = charAt(text, i);
    if ((c === '{' || c === '[') && candidates < MAX_FRAGMENT_CANDIDATES) {
      candidates += 1;
      const end = findBalancedJsonEnd(text, i);
      if (end !== -1) {
        const fragment = text.slice(i, end + 1);
        const parsed = tryParseJson(fragment);
        if (parsed !== undefined) {
          const walked = walkValue(parsed, depth + 1);
          out += text.slice(last, i);
          out += walked.changed ? JSON.stringify(walked.value) : fragment;
          last = end + 1;
          i = end + 1;
          continue;
        }
      }
    }
    i += 1;
  }
  out += text.slice(last);
  return out;
}

function isWordChar(c: string): boolean {
  return (
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    c === '_' ||
    c === '-'
  );
}

function isQuoteChar(c: string): boolean {
  return c === '"' || c === "'";
}

function isWhitespaceChar(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}

function isHexDigit(c: string): boolean {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
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

function isWordStart(text: string, index: number): boolean {
  if (index > 0 && isWordChar(charAt(text, index - 1))) return false;
  return isWordChar(charAt(text, index)) || isUnicodeEscapeAt(text, index);
}

interface WordRun {
  raw: string;
  decoded: string;
  end: number;
}

/**
 * Maximal word run: `[A-Za-z0-9_-]` characters plus embedded `\uXXXX` JSON escape
 * groups, which are decoded for key classification (report 15 F1) while the raw
 * source text is preserved in the output.
 */
function scanWordRun(text: string, start: number): WordRun {
  const n = text.length;
  let raw = '';
  let decoded = '';
  let i = start;
  while (i < n) {
    const c = charAt(text, i);
    if (isWordChar(c)) {
      raw += c;
      decoded += c;
      i += 1;
      continue;
    }
    if (isUnicodeEscapeAt(text, i)) {
      raw += text.slice(i, i + 6);
      decoded += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
      i += 6;
      continue;
    }
    break;
  }
  return { raw, decoded, end: i };
}

interface SeparatorScan {
  text: string;
  end: number;
  quoteChar: string | null;
  escapedQuote: boolean;
}

function scanSeparator(text: string, start: number): SeparatorScan | null {
  const n = text.length;
  let i = start;
  while (i < n && isWhitespaceChar(charAt(text, i))) i += 1;
  // optional (possibly backslash-escaped) closing quote of a JSON-style key
  if (i < n && charAt(text, i) === '\\' && isQuoteChar(charAt(text, i + 1))) i += 2;
  else if (i < n && isQuoteChar(charAt(text, i))) i += 1;
  while (i < n && isWhitespaceChar(charAt(text, i))) i += 1;
  if (i >= n || (charAt(text, i) !== ':' && charAt(text, i) !== '=')) return null;
  i += 1;
  if (i < n && charAt(text, i) === '>') i += 1; // alternate separator: `=>`
  while (i < n && isWhitespaceChar(charAt(text, i))) i += 1;
  let quoteChar: string | null = null;
  let escapedQuote = false;
  if (i < n && charAt(text, i) === '\\' && isQuoteChar(charAt(text, i + 1))) {
    quoteChar = charAt(text, i + 1);
    escapedQuote = true;
    i += 2;
  } else if (i < n && isQuoteChar(charAt(text, i))) {
    quoteChar = charAt(text, i);
    i += 1;
  }
  return { text: text.slice(start, i), end: i, quoteChar, escapedQuote };
}

interface QuotedValueScan {
  value: string;
  end: number;
  closing: string;
}

/**
 * Reads a quoted value through its MATCHING quote, honoring backslash escape pairs.
 * When the opening quote was itself escaped (`\"`, i.e. stringified-JSON context),
 * the closing delimiter is the escaped quote `\"` — so escaped inner structure is
 * not over-captured as outer grammar (report 15 F4). Unbalanced quotes fail safe:
 * the remainder of the string counts as the value.
 */
function scanQuotedValue(
  text: string,
  start: number,
  quote: string,
  escapedOpen: boolean,
): QuotedValueScan {
  const n = text.length;
  let i = start;
  while (i < n) {
    const c = charAt(text, i);
    if (c === '\\') {
      if (charAt(text, i + 1) === quote) {
        if (escapedOpen) {
          return { value: text.slice(start, i), end: i + 2, closing: `\\${quote}` };
        }
        i += 2;
        continue;
      }
      i += i + 1 < n ? 2 : 1;
      continue;
    }
    if (c === quote) {
      return { value: text.slice(start, i), end: i + 1, closing: quote };
    }
    i += 1;
  }
  return { value: text.slice(start, n), end: n, closing: '' };
}

interface UnquotedRunScan {
  run: string;
  end: number;
}

function scanUnquotedRun(text: string, start: number): UnquotedRunScan {
  const n = text.length;
  let i = start;
  while (i < n && !isWhitespaceChar(charAt(text, i)) && !UNQUOTED_RUN_TERMINATORS.has(charAt(text, i))) {
    i += 1;
  }
  let valueEnd = i;
  // Trailing backslashes belong to surrounding escape structure (e.g. \" inside
  // stringified JSON), not to the secret value; keep them outside the redaction.
  while (valueEnd > start && charAt(text, valueEnd - 1) === '\\') valueEnd -= 1;
  return { run: text.slice(start, valueEnd), end: i };
}

/** A run shaped like `key=` / `key:` — the start of the next pair; regions stop before it. */
function looksLikeKeyValuePair(run: string): boolean {
  return /^[A-Za-z0-9_-]+["']?[:=]/.test(run);
}

/**
 * Narrow sentinel-shape heuristic (report 15 F2/F3): `_`-bearing identifiers or
 * all-caps/digit runs. Ordinary prose words and timestamps do not match, so
 * diagnostics are not indiscriminately destroyed.
 */
function isSuspiciousRun(run: string): boolean {
  if (run.length < 4) return false;
  if (run.includes('_')) return true;
  return /^[A-Z0-9]{6,}$/.test(run) && /[0-9]/.test(run) && /[A-Z]/.test(run);
}

/**
 * Region extension for redacted unquoted values: consumes whitespace-separated
 * sentinel-shaped runs (multi-word credentials such as `Bearer <cred>` or
 * `SECRET_PART_ONE SECRET_PART_TWO`) and stops at hard delimiters, the next
 * key/value pair, ordinary prose, and — for header semantics — newlines
 * (provider references cross newlines because malformed references may embed them).
 */
function extendRedactionRegion(text: string, start: number, crossNewlines: boolean): number {
  const n = text.length;
  let regionEnd = start;
  let i = start;
  for (;;) {
    let sawNewline = false;
    let j = i;
    while (j < n && isWhitespaceChar(charAt(text, j))) {
      if (charAt(text, j) === '\n') sawNewline = true;
      j += 1;
    }
    if (!crossNewlines && sawNewline) return regionEnd;
    if (j >= n || HARD_REGION_STOPPERS.has(charAt(text, j))) return regionEnd;
    let k = j;
    while (k < n && !isWhitespaceChar(charAt(text, k)) && !HARD_REGION_STOPPERS.has(charAt(text, k))) {
      k += 1;
    }
    const candidate = text.slice(j, k);
    if (looksLikeKeyValuePair(candidate) || !isSuspiciousRun(candidate)) return regionEnd;
    regionEnd = k;
    i = k;
  }
}

/**
 * Ambiguous canonical-token region (report 14 R-03): an unquoted complete token
 * followed by whitespace may be a malformed reference with a whitespace/newline
 * suffix, so everything through the next hard delimiter fails safe.
 */
function scanAmbiguousRegionEnd(text: string, start: number): number {
  const n = text.length;
  let i = start;
  while (i < n && !HARD_REGION_STOPPERS.has(charAt(text, i))) i += 1;
  return i;
}

/** Layer C: the unstructured key/value scanner. */
function redactKeyValueText(text: string): string {
  const n = text.length;
  let out = '';
  let i = 0;
  while (i < n) {
    if (!isWordStart(text, i)) {
      out += charAt(text, i);
      i += 1;
      continue;
    }
    const word = scanWordRun(text, i);
    if (word.raw.length === 0) {
      out += charAt(text, i);
      i += 1;
      continue;
    }
    const normalized = normalizeKeyName(word.decoded);
    const isProviderRef = PROVIDER_REF_TEXT_KEYS.has(normalized);
    const isSensitive = !isProviderRef && TEXT_SENSITIVE_KEYS.has(normalized);
    if (!isProviderRef && !isSensitive) {
      out += word.raw;
      i = word.end;
      continue;
    }
    const separator = scanSeparator(text, word.end);
    if (!separator) {
      out += word.raw;
      i = word.end;
      continue;
    }
    if (separator.quoteChar !== null) {
      const quoted = scanQuotedValue(text, separator.end, separator.quoteChar, separator.escapedQuote);
      const exempt = isProviderRef && CANONICAL_PROVIDER_REF.test(quoted.value);
      out += word.raw + separator.text + (exempt ? quoted.value : REDACTED_VALUE) + quoted.closing;
      i = quoted.end;
      continue;
    }
    const unquoted = scanUnquotedRun(text, separator.end);
    const trailingEscapes = text.slice(separator.end + unquoted.run.length, unquoted.end);
    if (isProviderRef && CANONICAL_PROVIDER_REF.test(unquoted.run)) {
      const nextChar = charAt(text, unquoted.end);
      if (nextChar !== '' && isWhitespaceChar(nextChar)) {
        out += word.raw + separator.text + REDACTED_VALUE + trailingEscapes;
        i = scanAmbiguousRegionEnd(text, unquoted.end);
        continue;
      }
      // Complete canonical token at a hard boundary or end of string: preserve verbatim.
      out += word.raw + separator.text + unquoted.run + trailingEscapes;
      i = unquoted.end;
      continue;
    }
    const regionEnd =
      unquoted.run.length > 0
        ? extendRedactionRegion(text, unquoted.end, isProviderRef)
        : unquoted.end;
    out += word.raw + separator.text + REDACTED_VALUE + trailingEscapes;
    i = regionEnd;
  }
  return out;
}

/** Layer D: key-less canonical provider references with sentinel-shaped suffix regions. */
function redactKeylessProviderRegions(text: string): string {
  const n = text.length;
  CANONICAL_PROVIDER_REF_GLOBAL.lastIndex = 0;
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null = CANONICAL_PROVIDER_REF_GLOBAL.exec(text);
  while (match !== null) {
    const tokenStart = match.index;
    const tokenEnd = tokenStart + match[0].length;
    match = CANONICAL_PROVIDER_REF_GLOBAL.exec(text);
    if (tokenStart < last) continue;
    const after = charAt(text, tokenEnd);
    if (after === '' || !isWhitespaceChar(after)) continue; // attached suffixes: layer E
    let regionEnd = tokenEnd;
    let suspicious = false;
    let i = tokenEnd;
    for (;;) {
      let j = i;
      while (j < n && isWhitespaceChar(charAt(text, j))) j += 1;
      if (j >= n || HARD_REGION_STOPPERS.has(charAt(text, j))) break;
      let k = j;
      while (k < n && !isWhitespaceChar(charAt(text, k)) && !HARD_REGION_STOPPERS.has(charAt(text, k))) {
        k += 1;
      }
      const candidate = text.slice(j, k);
      if (looksLikeKeyValuePair(candidate)) break;
      if (isSuspiciousRun(candidate)) suspicious = true;
      regionEnd = k;
      i = k;
    }
    if (suspicious) {
      out += text.slice(last, tokenStart) + REDACTED_VALUE;
      last = regionEnd;
    }
  }
  out += text.slice(last);
  return out;
}

/** Layer E: credential-shaped patterns (retained from the historical redactor). */
function applyShapePatterns(text: string): string {
  return (
    text
      // Key-less malformed canonical-token shapes with an ATTACHED suffix (complete exact
      // tokens followed by a hard delimiter are not matched). A following `\"` is an escaped
      // closing quote (stringified-JSON boundary), not a suffix — the lookahead preserves it
      // so escaped structure stays intact.
      .replace(
        /\bpvr1:(?:robase|brevo|resend|external):[0-9a-f]{32}(?!\\["'])[^,\s}"';)(\[\]]+/gi,
        REDACTED_VALUE,
      )
      .replace(
        /\bMNNPS1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}/g,
        REDACTED_VALUE,
      )
      .replace(/\b(?:robe|re)_[A-Za-z0-9_-]{8,}\b/g, REDACTED_VALUE)
      .replace(/\bx(?:keysib|smtpsib)-[A-Za-z0-9_-]{8,}\b/g, REDACTED_VALUE)
  );
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }
  if (value instanceof Date || value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return REDACTED_VALUE;
  }
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED_VALUE : redact(nestedValue, seen);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_NAMES.has(normalizeKeyName(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
