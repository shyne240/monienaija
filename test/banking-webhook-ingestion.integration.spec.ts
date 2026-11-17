import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { BankingWebhookService } from '../src/banking/banking-webhook.service';
import { BankingInboundService } from '../src/banking/banking-inbound.service';
import { BankingProviderRegistry, capabilitiesOf } from '../src/banking/banking-provider.registry';
import type { BankingProvider } from '../src/banking/banking-provider.types';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Acceptance for webhook ingestion.
 *
 * A webhook endpoint is the most exposed part of a payments integration: unauthenticated, internet
 * facing, and believed by default by careless implementations. Every assertion here is about not
 * believing it.
 */
describe('banking webhook ingestion (real PostgreSQL)', () => {
  let db: DataSource;
  let webhooks: BankingWebhookService;
  let institutionId: string;

  const CLIENT_SECRET = 'sandbox-client-secret-value';

  function payload(over: Record<string, unknown> = {}) {
    return JSON.stringify({
      eventType: 'SUCCESSFUL_TRANSACTION',
      eventData: {
        transactionReference: `MNFY|${randomUUID().slice(0, 12)}|0001`,
        paymentReference: `PAY-${randomUUID().slice(0, 8)}`,
        amountPaid: 780.0,
        currency: 'NGN',
        destinationAccountNumber: '6254727989',
        destinationBankCode: '50515',
        paidOn: new Date().toISOString(),
        ...over,
      },
    });
  }

  function signed(body: string, secret = CLIENT_SECRET): string {
    return createHmac('sha512', secret).update(body).digest('hex');
  }

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkwh0001');
    institutionId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Webhook fixture','PARTNER','fixture')`,
      [institutionId, `BKWH-${suffix}`, `BKWH_${suffix}`],
    );
    const registry = new BankingProviderRegistry();
    registry.register({
      descriptor: {
        key: 'MONNIFY',
        displayName: 'Monnify',
        environment: 'sandbox',
        // The registry refuses advertised-but-unimplemented capabilities, and this fixture provides
        // neither verification nor provisioning, so it advertises neither.
        capabilities: capabilitiesOf({}),
        descriptors: [],
      },
    } as BankingProvider);
    const inbound = new BankingInboundService(db, registry);
    // Attribution now resolves from the receiving account, as it does in the application. The test
    // supplies a fixed institution because this suite is about signature handling, not attribution —
    // attribution has its own dedicated cases below.
    webhooks = new BankingWebhookService(inbound, {
      providerKey: 'MONNIFY',
      clientSecret: CLIENT_SECRET,
      environment: 'sandbox',
      resolveAttribution: async () => ({ institutionId }),
    });
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  const sandbox = (body: string, signature?: string) => ({
    rawBody: body,
    ...(signature === undefined ? {} : { signature }),
    clientSecret: CLIENT_SECRET,
    environment: 'sandbox' as const,
  });

  it('accepts a correctly signed webhook and records it UNVERIFIED', async () => {
    const body = payload();
    const outcome = await webhooks.handleMonnify(sandbox(body, signed(body)));
    expect(outcome.status).toBe('ACCEPTED');
    if (outcome.status === 'ACCEPTED') {
      const [row] = await db.query<
        Array<{ verification_state: string; gross_amount_minor: string }>
      >(
        `SELECT verification_state,gross_amount_minor::text AS gross_amount_minor
           FROM banking_inbound_payments WHERE provider_transaction_reference=$1`,
        [outcome.providerTransactionReference],
      );
      // 780.00 in major units becomes 78000 minor units — never a float in the database.
      expect(row!.gross_amount_minor).toBe('78000');
      // A webhook is not verification.
      expect(row!.verification_state).toBe('UNVERIFIED');
    }
  });

  it('REJECTS a body whose signature does not match', async () => {
    const body = payload();
    const forged = signed(body + 'x');
    const outcome = await webhooks.handleMonnify(sandbox(body, forged));
    expect(outcome.status).toBe('REJECTED');
    const [row] = await db.query<Array<{ c: string }>>(
      'SELECT count(*)::text AS c FROM banking_inbound_payments WHERE institution_id=$1',
      [institutionId],
    );
    expect(row!.c).toBe('1'); // only the earlier valid one
  });

  it('REJECTS a body tampered with after signing', async () => {
    const body = payload();
    const signature = signed(body);
    const tampered = body.replace('780', '7800');
    const outcome = await webhooks.handleMonnify(sandbox(tampered, signature));
    expect(outcome.status).toBe('REJECTED');
  });

  it('REJECTS the documented-but-wrong prose formula', async () => {
    // The published prose says SHA512(secret + body). Only HMAC-over-raw-body is accepted, and this
    // test exists so nobody "fixes" the verifier to match the incorrect documentation.
    const body = payload();
    const proseSignature = createHash('sha512')
      .update(CLIENT_SECRET + body)
      .digest('hex');
    const outcome = await webhooks.handleMonnify(sandbox(body, proseSignature));
    expect(outcome.status).toBe('REJECTED');
  });

  it('REJECTS a missing signature in production', async () => {
    const body = payload();
    const outcome = await webhooks.handleMonnify({
      rawBody: body,
      clientSecret: CLIENT_SECRET,
      environment: 'production',
    });
    expect(outcome.status).toBe('REJECTED');
  });

  it('REJECTS a missing signature in sandbox unless the fixture transport vouched for it', async () => {
    const body = payload();
    const plain = await webhooks.handleMonnify(sandbox(body));
    expect(plain.status).toBe('REJECTED');

    const fixture = await webhooks.handleMonnify({
      ...sandbox(body),
      trustedFixtureTransport: true,
    });
    expect(fixture.status).toBe('ACCEPTED');
  });

  it('REJECTS an oversized body before parsing it', async () => {
    const huge = payload({ padding: 'x'.repeat(300 * 1024) });
    const outcome = await webhooks.handleMonnify(sandbox(huge, signed(huge)));
    expect(outcome.status).toBe('REJECTED');
    if (outcome.status === 'REJECTED') expect(outcome.reason).toMatch(/signature/i);
  });

  it('acknowledges and IGNORES an event type it does not handle', async () => {
    const body = payload();
    const withType = JSON.stringify({ ...JSON.parse(body), eventType: 'LOW_BALANCE_ALERT' });
    const outcome = await webhooks.handleMonnify(sandbox(withType, signed(withType)));
    // Acknowledged so the provider stops retrying, but nothing is recorded from it.
    expect(outcome.status).toBe('IGNORED');
  });

  it('IGNORES a signed payload with no provider reference rather than inventing one', async () => {
    const body = JSON.stringify({
      eventType: 'SUCCESSFUL_TRANSACTION',
      eventData: { amountPaid: 100, currency: 'NGN' },
    });
    const outcome = await webhooks.handleMonnify(sandbox(body, signed(body)));
    expect(outcome.status).toBe('IGNORED');
  });

  it('IGNORES a signed payload with no amount rather than assuming one', async () => {
    const body = JSON.stringify({
      eventType: 'SUCCESSFUL_TRANSACTION',
      eventData: { transactionReference: `MNFY|${randomUUID().slice(0, 10)}` },
    });
    const outcome = await webhooks.handleMonnify(sandbox(body, signed(body)));
    expect(outcome.status).toBe('IGNORED');
  });

  it('deduplicates a replayed signed webhook', async () => {
    const body = payload();
    const first = await webhooks.handleMonnify(sandbox(body, signed(body)));
    const second = await webhooks.handleMonnify(sandbox(body, signed(body)));
    expect(first.status).toBe('ACCEPTED');
    expect(second.status).toBe('ACCEPTED');
    if (first.status === 'ACCEPTED' && second.status === 'ACCEPTED') {
      expect(second.alreadyRecorded).toBe(true);
      expect(second.providerTransactionReference).toBe(first.providerTransactionReference);
    }
  });

  it('never reports the specific reason a signature failed', async () => {
    const body = payload();
    const outcome = await webhooks.handleMonnify(sandbox(body, 'deadbeef'));
    expect(outcome.status).toBe('REJECTED');
    if (outcome.status === 'REJECTED') {
      expect(outcome.reason).toBe('Signature verification failed');
    }
  });

  it('does not treat a valid webhook as a verified payment', async () => {
    const body = payload();
    const outcome = await webhooks.handleMonnify(sandbox(body, signed(body)));
    expect(outcome.status).toBe('ACCEPTED');
    const [row] = await db.query<
      Array<{ verification_state: string; ledger_transaction_id: string | null }>
    >(
      `SELECT verification_state,ledger_transaction_id FROM banking_inbound_payments
        WHERE provider_transaction_reference=$1`,
      [(outcome as { providerTransactionReference: string }).providerTransactionReference],
    );
    expect(row!.verification_state).toBe('UNVERIFIED');
    // And nothing was posted: webhook ingestion never touches the ledger.
    expect(row!.ledger_transaction_id).toBeNull();
  });
});
