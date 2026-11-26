import { computeSignatureHeader } from '../src/banking/monnify/monnify-webhook.signature';
import { BankingWebhookService } from '../src/banking/banking-webhook.service';

/**
 * Disbursement notification recovery: the notification is only a pointer to an operation. The
 * provider status enquiry is authoritative, so delayed, repeated and out-of-order notifications
 * cannot post a second financial effect or override a confirmed status with stale payload data.
 */
describe('Banking webhook — outbound disbursement recovery', () => {
  const secret = 'controlled-test-client-secret';

  function harness(enquiryStates: string[]) {
    const enquiries: string[] = [];
    const submissions: string[] = [];
    const outbound = {
      findByOperationReference: (reference: string) =>
        Promise.resolve(reference === 'OP-KNOWN-0001' ? 'outbound-row-id' : null),
      enquire: (id: string, correlationId: string) => {
        enquiries.push(`${id}:${correlationId}`);
        return Promise.resolve({
          id,
          operationReference: 'OP-KNOWN-0001',
          providerKey: 'MONNIFY',
          state: enquiryStates.shift() ?? 'SUCCESSFUL',
        });
      },
      submitOutboundTransfer: (request: { operationReference: string }) => {
        submissions.push(request.operationReference);
        return Promise.resolve({ ok: false });
      },
    };
    const service = new BankingWebhookService(
      {} as never,
      {
        providerKey: 'MONNIFY',
        clientSecret: secret,
        environment: 'production',
        resolveAttribution: () => Promise.resolve(null),
      },
      undefined,
      outbound as never,
    );
    return { service, enquiries, submissions };
  }

  function request(eventType: string, eventData: Record<string, unknown>, reference = 'OP-KNOWN-0001') {
    const rawBody = JSON.stringify({
      eventType,
      eventData: {
        reference,
        transactionReference: 'MNFY|PROVIDER|0001',
        amount: 10,
        status: 'SUCCESS',
        ...eventData,
      },
    });
    return {
      rawBody,
      signature: computeSignatureHeader(secret, rawBody),
      environment: 'production' as const,
    };
  }

  it('turns a successful disbursement notification into a status enquiry, never a resubmission', async () => {
    const { service, enquiries, submissions } = harness(['SUCCESSFUL']);
    const outcome = await service.handleMonnify(request('SUCCESSFUL_DISBURSEMENT', {}));
    expect(outcome.status).toBe('ACCEPTED');
    expect(enquiries).toEqual(['outbound-row-id:webhook:SUCCESSFUL_DISBURSEMENT']);
    expect(submissions).toEqual([]);
  });

  it('repeated and out-of-order notifications never override authoritative status', async () => {
    // The payload says SUCCESS, but authoritative enquiry says REVERSED for the first event and
    // FAILED for the out-of-order later event. No payload field can settle or release funds here.
    const { service, enquiries, submissions } = harness(['REVERSED', 'FAILED', 'FAILED']);
    const late = request('SUCCESSFUL_DISBURSEMENT', { status: 'SUCCESS' });
    expect((await service.handleMonnify(late)).status).toBe('ACCEPTED');
    expect((await service.handleMonnify(late)).status).toBe('ACCEPTED');
    expect((await service.handleMonnify(request('FAILED_DISBURSEMENT', { status: 'FAILED' }))).status).toBe(
      'ACCEPTED',
    );
    expect(enquiries).toHaveLength(3);
    expect(submissions).toEqual([]);
  });

  it('ignores a notification with no matching dispatched operation', async () => {
    const { service, enquiries, submissions } = harness([]);
    const outcome = await service.handleMonnify(
      request('REVERSED_DISBURSEMENT', {}, 'OP-UNKNOWN-9999'),
    );
    expect(outcome).toEqual({ status: 'IGNORED', reason: 'Outbound operation not found' });
    expect(enquiries).toEqual([]);
    expect(submissions).toEqual([]);
  });
});
