import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DataSource } from 'typeorm';

import type { CustomerService } from '../../src/customer/customer.service';
import type { TestNotificationProvider } from '../../src/notification/notification-provider.interface';

/**
 * Authoritative customer-onboarding fixture for the **implemented** controlled flow.
 *
 * ## Why this exists
 *
 * The legacy self-service front door — `POST /api/v1/customers/registration` — is closed by
 * design (Arena 1 commit `05a38f4`, "Fail closed legacy onboarding pending trusted KYC"): it
 * answers `503` and creates nothing until genuine KYC is integrated. Several suites used that
 * route purely as a *setup step* to obtain "a DRAFT customer with a verified primary phone";
 * they were failing on the setup, not on the behaviour they actually assert.
 *
 * This helper produces exactly the same state through paths that are still implemented, with
 * no stored procedure short-cut for the security-relevant part:
 *
 *   1. `POST /customers/registration/otp` — the real OTP request (cooldown, rate limits,
 *      enumeration-safe responses, SMS through the injected provider adapter);
 *   2. `POST /customers/registration/otp/verify` — the real code check, which flips the
 *      challenge to `VERIFIED` and mints the one-time verification token;
 *   3. the customer row is inserted in the state the closed route would have produced
 *      (`DRAFT` / `NONE` / `NOT_STARTED`, canonical reference), plus a PHONE contact with
 *      `verified_at = NULL`;
 *   4. the phone is verified through `CustomerService.updateContactMethod` with that token, so
 *      `CustomerService.consumePhoneVerificationToken` performs the real single-use consumption
 *      (hash comparison, `VERIFIED` + unconsumed + unrevoked challenge, TTL) and writes the
 *      authoritative `verified_at`.
 *
 * Nothing here fabricates a verified phone: a real OTP must be requested, read from the test
 * SMS provider, and accepted by the production verifier before `verified_at` can be non-null.
 * The helper deliberately does not call the workforce `customer.create` surface, so suites that
 * stub `A2WorkforceSessionService` keep their existing scope sets untouched.
 */

export interface ControlledOnboardingContext {
  app: NestFastifyApplication;
  dataSource: DataSource;
  /** The injected test notification adapter, used to read the delivered OTP. */
  provider: TestNotificationProvider;
  /** Real `CustomerService` from the Nest module under test. */
  customerService: CustomerService;
}

export interface DraftWithVerifiedPhone {
  customerId: string;
  /** 0-prefixed input form the caller supplied (e.g. `08061110005`). */
  phone: string;
  /** Canonical 10-digit national form stored on the contact (`811100005`). */
  canonical: string;
  /** E.164 rendering stored as the contact value (`+234811100005`). */
  e164: string;
  contactId: string;
  /** The one-time token returned by the real verify endpoint (already consumed). */
  verificationToken: string;
  /** The 6-digit OTP that the production verifier accepted. */
  code: string;
}

/** Monotonic Nigerian-mobile phone factory (`08` + valid 811/806 ranges). */
export function controlledPhoneFactory(base = 110_000_000): () => string {
  let counter = base;
  return () => `0${8}${String(counter++).slice(0, 9)}`;
}

/** Splits a 0-prefixed NG mobile number into the canonical and E.164 forms the platform uses. */
export function phoneForms(phone: string): { canonical: string; e164: string } {
  const digits = phone.replace(/^\+234/, '').replace(/^0/, '');
  return { canonical: `8${digits.slice(1)}`, e164: `+2348${digits.slice(1)}` };
}

/** Requests a real OTP for `phone` and returns the code the platform actually sent. */
export async function requestRealOtp(
  ctx: ControlledOnboardingContext,
  phone: string,
  expected = 200,
): Promise<string> {
  const { e164 } = phoneForms(phone);
  await ctx.app
    .inject({ method: 'POST', url: '/api/v1/customers/registration/otp', payload: { phone } })
    .then((response) => {
      if (response.statusCode !== expected) {
        throw new Error(
          `OTP request expected ${expected}, got ${response.statusCode}: ${response.body}`,
        );
      }
      return response;
    });
  const sent = ctx.provider.sent.filter((entry) => entry.destination === e164).at(-1);
  if (!sent) throw new Error(`No OTP was delivered to ${e164}`);
  const match = /code is (\d{6})/.exec(sent.message);
  if (!match) throw new Error(`OTP SMS did not contain a 6-digit code: ${sent.message}`);
  return match[1]!;
}

/** Verifies an OTP through the real endpoint and returns the one-time verification token. */
export async function verifyRealOtp(
  ctx: ControlledOnboardingContext,
  phone: string,
  code: string,
): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/customers/registration/otp/verify',
    payload: { phone, code },
  });
  if (response.statusCode !== 200) {
    throw new Error(`OTP verify expected 200, got ${response.statusCode}: ${response.body}`);
  }
  const body = JSON.parse(response.body) as { verificationToken?: string };
  if (!body.verificationToken) throw new Error('OTP verify returned no verification token');
  return body.verificationToken;
}

/**
 * Creates a DRAFT customer whose primary phone is verified through the real OTP flow.
 *
 * `verified: false` inserts the contact with `verified_at = NULL` and is used by suites that
 * assert the *unverified* phone is rejected by the activation gate. `registerReference` lets a
 * caller reuse the historic reference shape (`mn-<canonical>`).
 */
export async function createDraftCustomerWithPhone(
  ctx: ControlledOnboardingContext,
  options: { phone?: string; verified?: boolean; reference?: string; status?: string } = {},
): Promise<DraftWithVerifiedPhone & { verificationToken: string; code: string }> {
  const phone = options.phone ?? controlledPhoneFactory()();
  const { canonical, e164 } = phoneForms(phone);
  const verified = options.verified ?? true;

  const code = await requestRealOtp(ctx, phone);
  const token = await verifyRealOtp(ctx, phone, code);

  const rows: Array<{ id: string }> = await ctx.dataSource.query(
    `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
     VALUES ($1,'INDIVIDUAL',$2,'NONE','NOT_STARTED') RETURNING id`,
    [options.reference ?? `mn-${canonical}`, options.status ?? 'DRAFT'],
  );
  const customerId = rows[0]!.id;

  const contacts: Array<{ id: string }> = await ctx.dataSource.query(
    `INSERT INTO customer_contact_methods
       (customer_id, type, value, normalized_value, is_primary, verified_at)
     VALUES ($1,'PHONE',$2,$3,true,NULL) RETURNING id`,
    [customerId, e164, canonical],
  );
  const contactId = contacts[0]!.id;

  if (verified) {
    // Real single-use token consumption → authoritative verified_at.
    await ctx.customerService.updateContactMethod(customerId, contactId, {
      verificationToken: token,
      actor: 'controlled-onboarding-fixture',
    });
  }

  return { customerId, phone, canonical, e164, contactId, verificationToken: token, code };
}

/** A unique reference in the historic `mn-...` shape, for callers that need one. */
export const controlledReference = (prefix = 'mn'): string => `${prefix}-${randomUUID()}`;
