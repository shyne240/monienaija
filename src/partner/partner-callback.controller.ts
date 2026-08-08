import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { PartnerCallbackHeadersV1 } from './external-callback.types';
import {
  PartnerCallbackIngestionService,
  PartnerCallbackRejectedException,
} from './partner-callback-ingestion.service';

@Controller('internal/partner-callbacks/nibss-nip')
export class PartnerCallbackController {
  constructor(private readonly callbackService: PartnerCallbackIngestionService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() payload: unknown,
  ) {
    const result = await this.callbackService.ingest(
      {
        partnerKey: headers['x-a6-partner-key'],
        callbackEventId: headers['x-a6-callback-id'],
        callbackTimestamp: headers['x-a6-callback-timestamp'],
        callbackSignature: headers['x-a6-callback-signature'],
      } satisfies PartnerCallbackHeadersV1,
      payload,
    );
    if (!result.accepted) {
      throw new PartnerCallbackRejectedException(
        result.rejectionCode ?? 'CALLBACK_MALFORMED',
        'The partner callback was rejected',
      );
    }
    return result;
  }
}
