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

/**
 * Provider-reference key spellings (normalized: lowercased, `-`/`_` stripped — the same
 * normalization the object-level redactor uses). Values under these keys receive the
 * canonical-token exemption; every other sensitive key is redacted unconditionally.
 */
const PROVIDER_REF_TEXT_KEYS = new Set([
  'providerref',
  'lasttestproviderref',
  'lasttestedproviderref',
]);

/**
 * The ONLY provider-reference shape that may survive error/log text redaction: a complete,
 * exact canonical opaque token (as produced by sanitizeProviderRefForBoundary). Anything else
 * — prefixes, suffixed, quoted-with-trailing-content, malformed scopes/digests — is redacted.
 */
const CANONICAL_PROVIDER_REF = /^pvr1:(?:robase|brevo|resend|external):[0-9a-f]{32}$/i;

/**
 * SPRINT1-F01 residuals R-03 + R-04 (Arena 4 report 14, retest of aef51dd):
 * The previous regex-based redaction had two independently reproduced bypasses:
 *  - R-03: the provider-ref exemption treated whitespace as the end of the value, so a
 *    sensitive suffix inside a QUOTED value (`"providerRef":"pvr1:brevo:<32hex> SENTINEL"`) —
 *    and the ambiguous unquoted `token SENTINEL` shape — survived redaction.
 *  - R-04: the generic sensitive-key pattern could not cross the quote between a JSON property
 *    name and its colon, so `{"apiKey":"SECRET"}` was returned unchanged.
 * Both regexes were replaced with this value-aware scanner (no lookahead exemptions):
 *  1. keys match at word boundaries (maximal [A-Za-z0-9_-] runs, normalized like the
 *     object-level redactor) against the FULL sensitive-key list (preserving and extending the
 *     coverage of the old text list: bare `token`, `password`, snake_case spellings, ...);
 *     word-boundary matching avoids false positives such as `statusCode`/`errorCode`.
 *  2. the separator scan accepts `:`/`=` (also `=>`), optional surrounding whitespace and
 *     optional (backslash-escaped) quotes on either side, and is preserved verbatim in the
 *     output so redacted JSON stays parseable.
 *  3. QUOTED values are captured through the matching quote, honoring backslash escape pairs
 *     (embedded/escaped quotes, newlines, very long values); UNQUOTED values run to whitespace
 *     or a hard delimiter (`,`, `}`, `]`, `"`).
 *  4. a provider-ref value is exempt ONLY when the COMPLETE captured value is a canonical
 *     token. For unquoted text, a canonical run followed by whitespace is AMBIGUOUS (it may be
 *     a malformed reference with a whitespace suffix), so it fails safe: everything through the
 *     next hard delimiter (``,`` `;` `{` `}` `(` `)` `[` `]` `"` `'`) or end of string is
 *     redacted. Unbalanced quotes fail safe too (the remainder of the value is redacted).
 * The scanner is single-pass/linear with no regex backtracking on the key-value paths; hostile
 * multi-hundred-KB inputs complete without hanging.
 */
/** Index-safe char read (this project compiles with noUncheckedIndexedAccess). */
function charAt(text: string, index: number): string {
  return text[index] ?? '';
}

function isRedactionWordChar(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char === '_' || char === '-';
}

function isQuoteChar(char: string): boolean {
  return char === '"' || char === "'";
}

function isWhitespaceChar(char: string): boolean {
  return /\s/.test(char);
}

/** Terminators of an UNQUOTED value run (whitespace handled separately for the ambiguity rule). */
const UNQUOTED_RUN_TERMINATORS = new Set([',', '}', ']', '"', "'"]);

/** Hard delimiters that stop the fail-safe ambiguous-region redaction after a canonical token. */
const AMBIGUOUS_REGION_STOPPERS = new Set([',', ';', '{', '}', '(', ')', '[', ']', '"', "'"]);

interface SeparatorScan {
  text: string;
  end: number;
  quote: string | null;
}

function scanSeparator(text: string, start: number): SeparatorScan | null {
  const n = text.length;
  let i = start;
  while (i < n && isWhitespaceChar(charAt(text, i))) i += 1;
  // optional (possibly backslash-escaped) closing quote of a JSON key
  if (i < n && charAt(text, i) === '\\' && i + 1 < n && isQuoteChar(charAt(text, i + 1))) i += 2;
  else if (i < n && isQuoteChar(charAt(text, i))) i += 1;
  while (i < n && isWhitespaceChar(charAt(text, i))) i += 1;
  if (i >= n || (charAt(text, i) !== ':' && charAt(text, i) !== '=')) return null;
  i += 1;
  if (i < n && charAt(text, i) === '>') i += 1; // alternate separator: `=>`
  while (i < n && isWhitespaceChar(charAt(text, i))) i += 1;
  let quote: string | null = null;
  if (i < n && charAt(text, i) === '\\' && i + 1 < n && isQuoteChar(charAt(text, i + 1))) {
    quote = charAt(text, i + 1);
    i += 2;
  } else if (i < n && isQuoteChar(charAt(text, i))) {
    quote = charAt(text, i);
    i += 1;
  }
  return { text: text.slice(start, i), end: i, quote };
}

interface QuotedValueScan {
  value: string;
  end: number;
  closing: string | null;
}

/** Reads a quoted value through its matching quote, honoring backslash escape pairs. */
function scanQuotedValue(text: string, start: number, quote: string): QuotedValueScan {
  const n = text.length;
  let i = start;
  while (i < n) {
    const char = charAt(text, i);
    if (char === '\\') {
      i += 2; // escape pair (\", \\, \n, ...) belongs to the value
      continue;
    }
    if (char === quote) {
      return { value: text.slice(start, i), end: i + 1, closing: quote };
    }
    i += 1;
  }
  // Unbalanced quote: fail safe — the whole remainder counts as the value.
  return { value: text.slice(start, n), end: n, closing: null };
}

interface UnquotedRunScan {
  run: string;
  end: number;
}

function scanUnquotedRun(text: string, start: number): UnquotedRunScan {
  const n = text.length;
  let i = start;
  while (i < n && !isWhitespaceChar(charAt(text, i)) && !UNQUOTED_RUN_TERMINATORS.has(charAt(text, i))) i += 1;
  let valueEnd = i;
  // Trailing backslashes belong to surrounding escape structure (e.g. \" inside stringified
  // JSON), not to the secret value; keep them outside the redaction so quoting stays intact.
  while (valueEnd > start && charAt(text, valueEnd - 1) === '\\') valueEnd -= 1;
  return { run: text.slice(start, valueEnd), end: i };
}

function scanAmbiguousRegionEnd(text: string, start: number): number {
  const n = text.length;
  let i = start;
  while (i < n && !AMBIGUOUS_REGION_STOPPERS.has(charAt(text, i))) i += 1;
  return i;
}

function redactKeyValueText(text: string): string {
  const n = text.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const char = charAt(text, i);
    if (!isRedactionWordChar(char) || (i > 0 && isRedactionWordChar(charAt(text, i - 1)))) {
      out += char;
      i += 1;
      continue;
    }
    let wordEnd = i + 1;
    while (wordEnd < n && isRedactionWordChar(charAt(text, wordEnd))) wordEnd += 1;
    const word = text.slice(i, wordEnd);
    const normalized = word.toLowerCase().replace(/[-_]/g, '');
    const isProviderRef = PROVIDER_REF_TEXT_KEYS.has(normalized);
    const isSensitive = !isProviderRef && SENSITIVE_KEY_NAMES.has(normalized);
    if (!isProviderRef && !isSensitive) {
      out += word;
      i = wordEnd;
      continue;
    }
    const separator = scanSeparator(text, wordEnd);
    if (!separator) {
      out += word;
      i = wordEnd;
      continue;
    }
    if (separator.quote !== null) {
      const quoted = scanQuotedValue(text, separator.end, separator.quote);
      const exempt = isProviderRef && CANONICAL_PROVIDER_REF.test(quoted.value);
      out += word + separator.text + (exempt ? quoted.value : REDACTED_VALUE) + (quoted.closing ?? '');
      i = quoted.end;
      continue;
    }
    const unquoted = scanUnquotedRun(text, separator.end);
    if (isProviderRef && CANONICAL_PROVIDER_REF.test(unquoted.run)) {
      const nextChar = unquoted.end < n ? charAt(text, unquoted.end) : '';
      if (nextChar !== '' && isWhitespaceChar(nextChar)) {
        // Ambiguous: could be a malformed reference with a whitespace/newline suffix.
        // Fail safe — redact through the next hard delimiter instead of preserving the prefix.
        out += word + separator.text + REDACTED_VALUE;
        i = scanAmbiguousRegionEnd(text, unquoted.end);
        continue;
      }
      // Complete canonical token at a hard boundary (`,`, `}`, `]`, quote) or end of string.
      out += word + separator.text + unquoted.run;
      i = unquoted.end;
      continue;
    }
    // Re-emit any trailing backslashes that were excluded from the value so surrounding
    // escape structure (e.g. \" inside stringified JSON) stays intact.
    const trailingEscapes = text.slice(separator.end + unquoted.run.length, unquoted.end);
    out += word + separator.text + REDACTED_VALUE + trailingEscapes;
    i = unquoted.end;
  }
  return out;
}

export function redactSensitiveText(value: string): string {
  return (
    redactKeyValueText(value)
      // Key-less malformed canonical-token shapes with an attached suffix (e.g. inside arrays
      // or bare prose) are redacted; a complete exact token followed by a hard delimiter is not.
      .replace(/\bpvr1:(?:robase|brevo|resend|external):[0-9a-f]{32}[^,\s}"';)\]]+/gi, REDACTED_VALUE)
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
  return SENSITIVE_KEY_NAMES.has(key.replace(/[-_]/g, '').toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
