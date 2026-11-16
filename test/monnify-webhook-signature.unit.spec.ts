/**
 * Webhook authentication.
 *
 * These tests are written against the **provider's actual contract**, not the prose. Monnify's docs
 * describe the header as `SHA-512(client secret + request body)`; its own published example digest
 * only reproduces as a keyed HMAC. A verifier built from the prose rejects every genuine webhook,
 * and the real-world "fix" for that is to disable verification — so the distinction is pinned here.
 */
import { createHash } from 'node:crypto';

import {
  computeSignatureHeader,
  computeTransactionHash,
  transactionHashMatches,
  verifyWebhook,
} from '../src/banking/monnify/monnify-webhook.signature';

// The example body and secret published in Monnify's "Computing Request Validation Hash" guide,
// reformatted to valid JSON without changing any value.
const DOCUMENTED_SECRET = '91MUDL9N6U3BQRXBQ2PJ9M0PW4J22M1Y';
const DOCUMENTED_BODY = JSON.stringify({
  eventData: {
    product: { reference: '111222333', type: 'OFFLINE_PAYMENT_AGENT' },
    transactionReference: 'MNFY|76|20211117154810|000001',
    paymentReference: '0.01462001097368737',
    paidOn: '17/11/2021 3:48:10 PM',
    paymentDescription: 'Mockaroo Jesse',
    metaData: {},
    destinationAccountInformation: {},
    paymentSourceInformation: {},
    amountPaid: 78000,
    totalPayable: 78000,
    offlineProductInformation: { code: '41470', type: 'DYNAMIC' },
    cardDetails: {},
    paymentMethod: 'CASH',
    currency: 'NGN',
    settlementAmount: 77600,
    paymentStatus: 'PAID',
    customer: { name: 'Mockaroo Jesse', email: '111222333@ZZAMZ4WT4Y3E.monnify' },
  },
  eventType: 'SUCCESSFUL_TRANSACTION',
});

describe('Monnify webhook signature (HMAC-SHA512 over raw bytes)', () => {
  it('ACCEPTS a webhook signed the way Monnify actually signs', () => {
    const signature = computeSignatureHeader(DOCUMENTED_SECRET, DOCUMENTED_BODY);
    const result = verifyWebhook({
      rawBody: DOCUMENTED_BODY,
      signature,
      clientSecret: DOCUMENTED_SECRET,
      environment: 'production',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scheme).toBe('HMAC_SHA512');
      expect((result.body as { eventType: string }).eventType).toBe('SUCCESSFUL_TRANSACTION');
    }
  });

  it('REJECTS the same payload signed with the documented prose formula', () => {
    // SHA-512(secret + body), exactly as the prose describes. This must NOT verify, because a
    // verifier that accepts it would accept a signature Monnify never sends.
    const proseSignature = createHash('sha512')
      .update(`${DOCUMENTED_SECRET}${DOCUMENTED_BODY}`)
      .digest('hex');
    const result = verifyWebhook({
      rawBody: DOCUMENTED_BODY,
      signature: proseSignature,
      clientSecret: DOCUMENTED_SECRET,
      environment: 'production',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects a tampered body even with a previously valid signature', () => {
    const signature = computeSignatureHeader(DOCUMENTED_SECRET, DOCUMENTED_BODY);
    const tampered = DOCUMENTED_BODY.replace('78000', '7800000');
    const result = verifyWebhook({
      rawBody: tampered,
      signature,
      clientSecret: DOCUMENTED_SECRET,
      environment: 'production',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects a signature made with the wrong secret', () => {
    const signature = computeSignatureHeader('some-other-secret', DOCUMENTED_BODY);
    const result = verifyWebhook({
      rawBody: DOCUMENTED_BODY,
      signature,
      clientSecret: DOCUMENTED_SECRET,
      environment: 'production',
    });
    expect(result.ok).toBe(false);
  });

  it('requires the signature header in production — sandbox behaviour is not a production licence', () => {
    const result = verifyWebhook({
      rawBody: DOCUMENTED_BODY,
      clientSecret: DOCUMENTED_SECRET,
      environment: 'production',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NOT_PERMITTED_IN_PRODUCTION');
  });

  it('does not treat a missing header as authenticated in sandbox either, absent the fixture transport', () => {
    // Sandbox genuinely omits the header, but absence still authenticates nothing by itself.
    const result = verifyWebhook({
      rawBody: DOCUMENTED_BODY,
      clientSecret: DOCUMENTED_SECRET,
      environment: 'sandbox',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MISSING_SIGNATURE');
  });

  it('accepts an unsigned sandbox event ONLY over the controlled fixture transport', () => {
    const result = verifyWebhook({
      rawBody: DOCUMENTED_BODY,
      clientSecret: DOCUMENTED_SECRET,
      environment: 'sandbox',
      trustedFixtureTransport: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scheme).toBe('SANDBOX_NO_SIGNATURE');
  });

  it('rejects a malformed signature rather than throwing', () => {
    for (const signature of ['not-hex', 'abc', ' '.repeat(3), 'g'.repeat(128)]) {
      const result = verifyWebhook({
        rawBody: DOCUMENTED_BODY,
        signature,
        clientSecret: DOCUMENTED_SECRET,
        environment: 'production',
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects an oversized payload before hashing', () => {
    const huge = 'x'.repeat(300 * 1024);
    const result = verifyWebhook({
      rawBody: huge,
      signature: computeSignatureHeader(DOCUMENTED_SECRET, huge),
      clientSecret: DOCUMENTED_SECRET,
      environment: 'production',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BODY_TOO_LARGE');
  });

  it('does not hand a correctly signed but malformed body to the parser as success', () => {
    const body = '{not json';
    const result = verifyWebhook({
      rawBody: body,
      signature: computeSignatureHeader(DOCUMENTED_SECRET, body),
      clientSecret: DOCUMENTED_SECRET,
      environment: 'production',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MALFORMED_BODY');
  });

  it('hashes a Buffer body identically to the equivalent string', () => {
    const fromString = computeSignatureHeader(DOCUMENTED_SECRET, DOCUMENTED_BODY);
    const fromBuffer = computeSignatureHeader(
      DOCUMENTED_SECRET,
      Buffer.from(DOCUMENTED_BODY, 'utf8'),
    );
    expect(fromBuffer).toBe(fromString);
  });
});

describe('Monnify payload transactionHash (a different scheme)', () => {
  it('is SHA-512 of the pipe-joined fields, NOT an HMAC and not the header scheme', () => {
    const fields = {
      paymentReference: '1568979249981',
      amountPaid: '100.00',
      paidOn: '20/09/2019 11:35:21',
      transactionReference: 'MNFY|20190920113413|000224',
    };
    const expected = createHash('sha512')
      .update(
        [
          DOCUMENTED_SECRET,
          fields.paymentReference,
          fields.amountPaid,
          fields.paidOn,
          fields.transactionReference,
        ].join('|'),
      )
      .digest('hex');
    const actual = computeTransactionHash(DOCUMENTED_SECRET, fields);
    expect(actual).toBe(expected);
    expect(transactionHashMatches(actual, actual)).toBe(true);
    // Flip the final nibble deterministically; appending '0' is a no-op when it already ends in 0.
    const flipped = actual.slice(0, -1) + (actual.endsWith('0') ? '1' : '0');
    expect(transactionHashMatches(actual, flipped)).toBe(false);
    // Crucially, it is not the header signature.
    expect(actual).not.toBe(computeSignatureHeader(DOCUMENTED_SECRET, DOCUMENTED_BODY));
  });
});
