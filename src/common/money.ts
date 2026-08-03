import { BadRequestException } from '@nestjs/common';

/** PostgreSQL BIGINT's largest positive value. */
export const MAX_POSTGRES_BIGINT = 9223372036854775807n;

/**
 * Parse a monetary amount without ever passing through a floating-point
 * representation. API clients may send a JSON number for convenience, but it
 * must be a safe integer before it is converted to a string.
 */
export function parseMinorUnits(
  value: string | number | bigint,
  fieldName = 'amountMinor',
): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n || value > MAX_POSTGRES_BIGINT) {
      throw new BadRequestException(`${fieldName} must fit in a PostgreSQL BIGINT`);
    }

    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestException(`${fieldName} must be a safe non-negative integer`);
    }

    return parseMinorUnits(String(value), fieldName);
  }

  if (!/^\d+$/.test(value)) {
    throw new BadRequestException(`${fieldName} must be a non-negative integer in minor units`);
  }

  const parsed = BigInt(value);
  if (parsed > MAX_POSTGRES_BIGINT) {
    throw new BadRequestException(`${fieldName} must fit in a PostgreSQL BIGINT`);
  }

  return parsed;
}

export function parsePositiveMinorUnits(
  value: string | number | bigint,
  fieldName = 'amountMinor',
): bigint {
  const parsed = parseMinorUnits(value, fieldName);
  if (parsed === 0n) {
    throw new BadRequestException(`${fieldName} must be greater than zero`);
  }

  return parsed;
}

export function minorUnitsToString(value: string | number | bigint): string {
  return parseMinorUnits(value).toString();
}

export function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new BadRequestException('currency must be a three-letter ISO 4217 code');
  }

  return normalized;
}

export function normalizeAccountingUnit(accountingUnit?: string): string {
  const normalized = (accountingUnit ?? 'CUSTOMER_FUNDS').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_:-]{1,63}$/.test(normalized)) {
    throw new BadRequestException(
      'accountingUnit must contain 2 to 64 uppercase letters, numbers, underscores, colons, or hyphens',
    );
  }

  return normalized;
}
