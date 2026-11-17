import {
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { BankingWebhookService } from './banking-webhook.service';

/**
 * Provider webhook ingress.
 *
 * Three properties, each of which is a correctness requirement rather than a preference:
 *
 * 1. **The signature is verified over the exact received bytes.** Fastify's JSON parser discards the
 *    original encoding, and re-serializing a parsed body produces different bytes — different key
 *    order, different whitespace, different unicode escaping — which would make a valid signature fail
 *    and, worse, tempt a "fix" that stops checking the signature. The raw buffer is therefore
 *    preserved and handed to the verifier verbatim.
 * 2. **Nothing is acknowledged before it is durable.** The service verifies, deduplicates and records
 *    inside its own transaction, and only then does this handler answer 200. A 200 for a webhook we
 *    failed to persist is a payment the provider will never resend.
 * 3. **An unverifiable webhook is a 401, never a 200.** Acknowledging an unauthenticated request
 *    would let an attacker suppress a real payment by racing a forged one to the same reference.
 *
 * The response carries no financial detail. The provider is told "accepted"; nobody learns an amount.
 */
@Controller('webhooks')
export class BankingWebhookController {
  constructor(private readonly webhooks: BankingWebhookService) {}

  @Post('monnify')
  @HttpCode(200)
  async monnify(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // The raw body must exist. If the server is misconfigured to parse without preserving it, refuse
    // rather than verifying a re-serialized approximation.
    const raw = request.rawBody;
    if (!raw) {
      // `rawBody` is enabled in `main.ts`; if that option is ever dropped, or an embedded boot forgets
      // it, this must fail closed rather than verify a re-serialized approximation of the payload.
      // Answering 503 would tell the provider to retry a request that cannot succeed until we
      // redeploy; 401 is the accurate answer for "this request is not authenticated".
      throw new UnauthorizedException('Webhook authentication is not available');
    }
    const signatureHeader = request.headers['monnify-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    const outcome = await this.webhooks.handleMonnify({
      rawBody: raw,
      signature,
    });

    switch (outcome.status) {
      case 'ACCEPTED':
        // Recorded durably. Idempotent replays also land here so the provider stops retrying.
        return { received: true };
      case 'UNRESOLVED':
        // Signature was valid but the receiving account is not ours. Acknowledged so the provider
        // stops retrying, and recorded for an operator: see BankingWebhookService.
        return { received: true, attributed: false };
      case 'IGNORED':
        return { received: true, processed: false };
      case 'REJECTED':
        // Never acknowledged. 401 is the only honest answer to a webhook we cannot authenticate.
        reply.code(401);
        return { received: false };
    }
  }
}
