import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import type { Environment } from '../config/environment';
import { NIBSS_NIP_PARTNER_KEY } from './partner-adapter.types';
import type {
  PartnerCallbackHeadersV1,
  VerifiedPartnerCallbackV1,
} from './external-callback.types';

const HEADER_PARTNER_KEY = 'partnerKey';
const HEADER_CALLBACK_EVENT_ID = 'callbackEventId';
const HEADER_CALLBACK_TIMESTAMP = 'callbackTimestamp';
const HEADER_CALLBACK_SIGNATURE = 'callbackSignature';
const SIGNATURE_PREFIX = 'sha256=';
const SAFE_HEADER_PATTERN = /^[\x20-\x7E]{1,255}$/;
const HEX_PATTERN = /^[a-f0-9]{64}$/i;

export const PARTNER_CALLBACK_SECRET_SOURCE = Symbol('PARTNER_CALLBACK_SECRET_SOURCE');

export interface PartnerCallbackSecretSource {
  load(): string;
}

export class PartnerCallbackAuthenticationException extends UnauthorizedException {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super({ code, message });
  }
}

@Injectable()
export class EnvironmentPartnerCallbackSecretSource implements PartnerCallbackSecretSource {
  constructor(private readonly configService: ConfigService) {}

  load(): string {
    const environment =
      this.configService.get<Environment['A6_PARTNER_ENVIRONMENT']>('A6_PARTNER_ENVIRONMENT') ??
      'sandbox';
    const enabled =
      this.configService.get<Environment['A6_PARTNER_ENABLED']>('A6_PARTNER_ENABLED') ?? false;
    if (!enabled) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_SECRET_UNAVAILABLE',
        'The A6 partner callback boundary is disabled',
      );
    }
    const key =
      environment === 'sandbox'
        ? 'A6_PARTNER_SANDBOX_CALLBACK_SECRET'
        : 'A6_PARTNER_PRODUCTION_CALLBACK_SECRET';
    const secret = this.configService.get<string>(key);
    if (!secret) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_SECRET_UNAVAILABLE',
        'The selected A6 partner callback secret is unavailable',
      );
    }
    return secret;
  }
}

@Injectable()
export class PartnerCallbackAuthenticationService {
  constructor(
    @Inject(PARTNER_CALLBACK_SECRET_SOURCE)
    private readonly secretSource: PartnerCallbackSecretSource,
    private readonly configService: ConfigService,
  ) {}

  authenticate(headers: PartnerCallbackHeadersV1, payload: unknown): VerifiedPartnerCallbackV1 {
    const partnerKey = this.header(headers.partnerKey, HEADER_PARTNER_KEY);
    const callbackEventId = this.header(headers.callbackEventId, HEADER_CALLBACK_EVENT_ID);
    const callbackTimestampText = this.header(headers.callbackTimestamp, HEADER_CALLBACK_TIMESTAMP);
    const callbackSignature = this.header(headers.callbackSignature, HEADER_CALLBACK_SIGNATURE);
    if (partnerKey !== NIBSS_NIP_PARTNER_KEY) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_UNAUTHORIZED',
        'The callback partner key is not registered',
      );
    }
    if (!isRecord(payload)) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_MALFORMED',
        'The callback payload must be a JSON object',
      );
    }
    const payloadEventId = this.stringValue(payload.callbackEventId);
    if (payloadEventId !== callbackEventId) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_MALFORMED',
        'The callback event ID header and payload do not match',
      );
    }
    const timestamp = this.parseTimestamp(callbackTimestampText);
    const maxSkew = this.configService.get<number>('A6_PARTNER_CALLBACK_MAX_SKEW_SECONDS') ?? 300;
    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > maxSkew) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_STALE',
        'The callback timestamp is outside the permitted freshness window',
      );
    }
    const signature = this.signatureValue(callbackSignature);
    const canonicalPayload = canonicalJson(payload);
    let secret: string;
    try {
      secret = this.secretSource.load();
    } catch (error) {
      if (error instanceof PartnerCallbackAuthenticationException) throw error;
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_SECRET_UNAVAILABLE',
        'The callback authentication secret could not be loaded',
      );
    }
    const signedValue = `${partnerKey}.${callbackEventId}.${timestamp}.${canonicalPayload}`;
    const expectedSignature = createHmac('sha256', secret).update(signedValue).digest('hex');
    if (!this.constantTimeEqual(signature, expectedSignature)) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_SIGNATURE_INVALID',
        'The callback signature is invalid',
      );
    }
    return {
      payload: payload as unknown as VerifiedPartnerCallbackV1['payload'],
      callbackEventId,
      callbackTimestamp: timestamp,
      payloadHash: createHash('sha256').update(canonicalPayload).digest('hex'),
      signatureHash: createHash('sha256').update(callbackSignature).digest('hex'),
    };
  }

  private header(value: string | string[] | undefined, field: string): string {
    const normalized = Array.isArray(value) ? value[0] : value;
    if (!normalized || !SAFE_HEADER_PATTERN.test(normalized)) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_UNAUTHORIZED',
        `The callback ${field} header is missing or invalid`,
      );
    }
    return normalized.trim();
  }

  private signatureValue(value: string): string {
    if (!value.startsWith(SIGNATURE_PREFIX)) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_SIGNATURE_INVALID',
        'The callback signature format is invalid',
      );
    }
    const signature = value.slice(SIGNATURE_PREFIX.length).trim().toLowerCase();
    if (!HEX_PATTERN.test(signature)) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_SIGNATURE_INVALID',
        'The callback signature value is invalid',
      );
    }
    return signature;
  }

  private parseTimestamp(value: string): number {
    if (!/^\d{1,12}$/.test(value)) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_MALFORMED',
        'The callback timestamp is invalid',
      );
    }
    const timestamp = Number(value);
    if (!Number.isSafeInteger(timestamp)) {
      throw new PartnerCallbackAuthenticationException(
        'CALLBACK_MALFORMED',
        'The callback timestamp is invalid',
      );
    }
    return timestamp;
  }

  private constantTimeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
