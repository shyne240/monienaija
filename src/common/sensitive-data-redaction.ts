export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_NAMES = new Set([
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'accesstoken',
  'refreshtoken',
  'secret',
  'secretkey',
  'clientsecret',
  'apikey',
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
]);

export function redactSensitiveData(value: unknown): unknown {
  return redact(value, new WeakSet<object>());
}

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSensitiveData(value);
  return isRecord(redacted) ? redacted : {};
}

export function redactSensitiveText(value: string): string {
  return value.replace(
    /(passwordHash|tokenHash|accessToken|refreshToken|secret|apiKey|authorization|cookie|codeHash|challengeHash|providedHash|fingerprintHash)\s*[:=]\s*([^,\s}]+)/gi,
    (_match, key: string) => `${key}=${REDACTED_VALUE}`,
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
