import { createHash } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import type { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PaymentFailureDetails {
  code: string;
  statusCode: number;
  message: string;
}

export function normalizePaymentText(
  value: string | undefined,
  fieldName: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.length > 255) {
    throw new BadRequestException(`${fieldName} must be at most 255 characters`);
  }
  return normalized;
}

export function paymentRequestHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function assertPaymentUuid(value: string, fieldName: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException(`${fieldName} must be a UUID`);
  }
}

export function failureFromHttpException(
  error: HttpException,
  rejectedCode: string,
  insufficientFundsCode?: string,
): PaymentFailureDetails {
  const statusCode = error.getStatus();
  const response = error.getResponse();
  const rawMessage =
    typeof response === 'string'
      ? response
      : ((response as { message?: string | string[] }).message ?? 'Payment was rejected');
  const message = Array.isArray(rawMessage) ? rawMessage.join('; ') : rawMessage;
  return {
    code: statusCode === 422 && insufficientFundsCode ? insufficientFundsCode : rejectedCode,
    statusCode,
    message: message.slice(0, 255),
  };
}

export function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { code?: string };
  return driverError.code === '40001' || driverError.code === '40P01';
}

export function isConstraintViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { constraint?: string; code?: string };
  return driverError.code === '23505' && driverError.constraint === constraintName;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}
