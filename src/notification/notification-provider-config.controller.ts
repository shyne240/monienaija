import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  NotificationProviderConfigService,
  type CredentialAction,
  type ProposeProviderConfigInput,
} from './notification-provider-config.service';
import type { ManagedNotificationChannel } from './notification-secret-encryption.service';

interface WorkforceRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
  requestContext?: { correlationId?: string };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROPOSE_ALLOWED_KEYS = new Set([
  'channel',
  'expectedVersion',
  'provider',
  'enabled',
  'baseUrl',
  'requestTimeoutMs',
  'senderId',
  'fromEmail',
  'fromName',
  'replyToEmail',
  'credentialAction',
  'apiKey',
  'spfConfigured',
  'dkimConfigured',
  'dmarcConfigured',
  'reason',
]);

const DECISION_ALLOWED_KEYS = new Set(['comment']);

function assertUuid(raw: string, label: string): string {
  const trimmed = (raw ?? '').trim();
  if (!UUID_PATTERN.test(trimmed)) {
    throw new BadRequestException(`${label} must be a valid UUID.`);
  }
  return trimmed;
}

function readRequiredString(obj: Record<string, unknown>, field: string): string {
  const val = obj[field];
  if (typeof val !== 'string') {
    throw new BadRequestException(`${field} must be a string.`);
  }
  return val;
}

function readOptionalNullableString(
  obj: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const val = obj[field];
  if (val === undefined || val === null) {
    return val;
  }
  if (typeof val !== 'string') {
    throw new BadRequestException(`${field} must be a string or null.`);
  }
  return val;
}

function parseProposeBody(body: unknown): ProposeProviderConfigInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Request body must be a JSON object.');
  }
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!PROPOSE_ALLOWED_KEYS.has(key)) {
      throw new BadRequestException(`Unknown field "${key}" in provider configuration proposal.`);
    }
  }
  return {
    channel: obj['channel'] as ManagedNotificationChannel,
    expectedVersion: obj['expectedVersion'] as number,
    provider: readRequiredString(obj, 'provider'),
    enabled: Boolean(obj['enabled']),
    baseUrl: readOptionalNullableString(obj, 'baseUrl'),
    requestTimeoutMs:
      obj['requestTimeoutMs'] === undefined
        ? undefined
        : Number(obj['requestTimeoutMs']),
    senderId: readOptionalNullableString(obj, 'senderId'),
    fromEmail: readOptionalNullableString(obj, 'fromEmail'),
    fromName: readOptionalNullableString(obj, 'fromName'),
    replyToEmail: readOptionalNullableString(obj, 'replyToEmail'),
    credentialAction: readRequiredString(obj, 'credentialAction') as CredentialAction,
    apiKey: obj['apiKey'] === undefined ? undefined : readRequiredString(obj, 'apiKey'),
    spfConfigured:
      obj['spfConfigured'] === undefined ? undefined : Boolean(obj['spfConfigured']),
    dkimConfigured:
      obj['dkimConfigured'] === undefined ? undefined : Boolean(obj['dkimConfigured']),
    dmarcConfigured:
      obj['dmarcConfigured'] === undefined ? undefined : Boolean(obj['dmarcConfigured']),
    reason: readRequiredString(obj, 'reason'),
  };
}

function parseDecisionComment(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Decision body must be a JSON object.');
  }
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!DECISION_ALLOWED_KEYS.has(key)) {
      throw new BadRequestException(`Unknown field "${key}" in decision body.`);
    }
  }
  if (obj['comment'] === undefined || obj['comment'] === null) return undefined;
  if (typeof obj['comment'] !== 'string') {
    throw new BadRequestException('comment must be a string.');
  }
  return obj['comment'];
}

@Controller('internal/notifications/provider-config')
export class NotificationProviderConfigController {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly providerConfigService: NotificationProviderConfigService,
  ) {}

  @Get()
  async getOverview(@Req() request: WorkforceRequest) {
    await this.authorizationService.requireFunction(
      request.authorizationPrincipal,
      'notification.provider.view',
      'NOTIFICATION_PROVIDER_CONFIG',
      ['OPERATOR', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
    return this.providerConfigService.getOverview();
  }

  @Get('proposals')
  async listProposals(
    @Req() request: WorkforceRequest,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    await this.authorizationService.requireFunction(
      request.authorizationPrincipal,
      'notification.provider.view',
      'NOTIFICATION_PROVIDER_CONFIG',
      ['OPERATOR', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
    let parsedChannel: ManagedNotificationChannel | undefined;
    if (channel !== undefined && channel !== '') {
      if (channel !== 'SMS' && channel !== 'EMAIL') {
        throw new BadRequestException('channel filter must be SMS or EMAIL.');
      }
      parsedChannel = channel;
    }
    const parsedLimit = limit ? Number(limit) : 25;
    return this.providerConfigService.listProposals(parsedChannel, status, parsedLimit);
  }

  @Get('proposals/:id')
  async getProposal(@Req() request: WorkforceRequest, @Param('id') id: string) {
    await this.authorizationService.requireFunction(
      request.authorizationPrincipal,
      'notification.provider.view',
      'NOTIFICATION_PROVIDER_CONFIG',
      ['OPERATOR', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
    return this.providerConfigService.getProposal(assertUuid(id, 'proposal id'));
  }

  @Post('proposals')
  async proposeChange(@Req() request: WorkforceRequest, @Body() body: unknown) {
    await this.authorizationService.requireFunction(
      request.authorizationPrincipal,
      'notification.provider.configure',
      'NOTIFICATION_PROVIDER_CONFIG',
      ['OPERATOR', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
    const input = parseProposeBody(body);
    return this.providerConfigService.proposeChange(
      request.authorizationPrincipal!,
      input,
      request.requestContext?.correlationId,
    );
  }

  @Post('proposals/:id/approve')
  @HttpCode(200)
  async approveProposal(
    @Req() request: WorkforceRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.authorizationService.requireFunction(
      request.authorizationPrincipal,
      'notification.provider.configure',
      'NOTIFICATION_PROVIDER_CONFIG',
      ['OPERATOR', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
    const comment = parseDecisionComment(body);
    return this.providerConfigService.approveProposal(
      request.authorizationPrincipal!,
      assertUuid(id, 'proposal id'),
      comment,
      request.requestContext?.correlationId,
    );
  }

  @Post('proposals/:id/reject')
  @HttpCode(200)
  async rejectProposal(
    @Req() request: WorkforceRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.authorizationService.requireFunction(
      request.authorizationPrincipal,
      'notification.provider.configure',
      'NOTIFICATION_PROVIDER_CONFIG',
      ['OPERATOR', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
    const comment = parseDecisionComment(body);
    return this.providerConfigService.rejectProposal(
      request.authorizationPrincipal!,
      assertUuid(id, 'proposal id'),
      comment,
      request.requestContext?.correlationId,
    );
  }

  @Post('proposals/:id/activate')
  @HttpCode(200)
  async activateProposal(@Req() request: WorkforceRequest, @Param('id') id: string) {
    await this.authorizationService.requireFunction(
      request.authorizationPrincipal,
      'notification.provider.configure',
      'NOTIFICATION_PROVIDER_CONFIG',
      ['OPERATOR', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
    return this.providerConfigService.activateProposal(
      request.authorizationPrincipal!,
      assertUuid(id, 'proposal id'),
      request.requestContext?.correlationId,
    );
  }

  @Post(':channel/verify')
  @HttpCode(200)
  async verifyChannel(
    @Req() request: WorkforceRequest,
    @Param('channel') channel: string,
  ) {
    await this.authorizationService.requireFunction(
      request.authorizationPrincipal,
      'notification.test_send',
      'NOTIFICATION_PROVIDER_CONFIG',
      ['OPERATOR', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
    const upper = (channel ?? '').trim().toUpperCase();
    if (upper !== 'SMS' && upper !== 'EMAIL') {
      throw new BadRequestException('channel must be SMS or EMAIL.');
    }
    return this.providerConfigService.verifyChannelConfiguration(
      request.authorizationPrincipal!,
      upper,
      request.requestContext?.correlationId,
    );
  }
}
