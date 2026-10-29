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

export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /(temporaryPassword|passwordHash|pin|pinHash|tokenHash|applicantAccessToken|accessToken|refreshToken|secret|apiKey|encryptedApiKey|proposedEncryptedApiKey|authorization|cookie|codeHash|challengeHash|providedHash|fingerprintHash|transferCode|transferCodeHash)\s*[:=]\s*([^,\s}]+)/gi,
      (_match, key: string) => `${key}=${REDACTED_VALUE}`,
    )
    .replace(
      /**
       * SPRINT1-F01 residual R-03 (Arena 4 report 13): the exemption lookahead previously ended
       * with `\b` after the 32-hex digest, so ANY value merely STARTING with a canonical
       * `pvr1:<scope>:<32 hex>` token (e.g. `pvr1:brevo:<32hex>:<SENSITIVE_SUFFIX>`) bypassed
       * redaction in full and leaked through 4xx bodies / 5xx structured logs. The exemption now
       * requires the ENTIRE captured value to be a canonical token: the digest must be followed
       * by a value terminator (anything outside the value character class: comma, closing brace,
       * whitespace, quote) or end of string; everything else is redacted completely.
       * The separator group additionally accepts JSON-quoted forms (`"providerRef":"..."`) and is
       * preserved verbatim in the replacement so redacted JSON text stays parseable.
       */
      /(providerRef|provider_ref|lastTestProviderRef|last_tested_provider_ref|last_test_provider_ref)(["']?\s*[:=]\s*["']?)(?!pvr1:(?:robase|brevo|resend|external):[0-9a-f]{32}(?![^,\s}"']))([^,\s}"']+)/gi,
      (_match, key: string, separator: string) => `${key}${separator}${REDACTED_VALUE}`,
    )
    .replace(
      /\bMNNPS1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}/g,
      REDACTED_VALUE,
    )
    .replace(/\b(?:robe|re)_[A-Za-z0-9_-]{8,}\b/g, REDACTED_VALUE)
    .replace(/\bx(?:keysib|smtpsib)-[A-Za-z0-9_-]{8,}\b/g, REDACTED_VALUE);
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
