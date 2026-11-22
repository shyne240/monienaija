import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { NotificationOperationsService } from './notification-operations.service';

interface AuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const DELIVERY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CHANNELS = new Set(['SMS', 'PUSH', 'EMAIL']);

/**
 * ARENA 4 — administrative visibility into the notification delivery infrastructure that already
 * exists (dispatcher, delivery processor, outbox receipts, provider configuration).
 *
 * Every route is a READ. There is intentionally no POST here: the approved V1 deliveries surface
 * is read-only and the only retry mechanism is the worker's bounded automatic retry. See
 * MANUAL_RETRY_POLICY_REFERENCE and docs/ARENA4-NOTIFICATION-OPERATIONS.md.
 *
 * Provider identity follows the same two-tier projection as the existing
 * `GET /internal/notifications/provider-status`: `notification.view_deliveries` alone yields
 * availability booleans; provider identity/lifecycle/retry tuning requires
 * `notification.provider.view` as well.
 */
@Controller('internal/notifications')
export class NotificationOperationsController {
  constructor(
    private readonly operations: NotificationOperationsService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('operations/summary')
  async summary(
    @Req() req: AuthenticatedRequest,
    @Query('hours') hoursRaw?: string,
    @Query('channel') channelRaw?: string,
  ) {
    await this.authorize(req);
    const hours = this.parseHours(hoursRaw);
    const channel = this.parseChannel(channelRaw);
    return this.operations.summary({
      hours,
      ...(channel ? { channel } : {}),
      includeProviderIdentity: this.hasProviderView(req),
    });
  }

  @Get('deliveries/:id')
  async deliveryDetail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.authorize(req);
    if (!DELIVERY_ID_PATTERN.test(id)) {
      throw new BadRequestException('id must be a UUID');
    }
    return this.operations.deliveryDetail(id, this.hasProviderView(req));
  }

  private authorize(req: AuthenticatedRequest): Promise<string> {
    // Same function, principal-type allowlist and denial convention as the existing delivery
    // listing (AdminNotificationController.requireFunction).
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      'notification.view_deliveries',
      'internal-notification-operations',
      ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
  }

  private hasProviderView(req: AuthenticatedRequest): boolean {
    return Boolean(req.authorizationPrincipal?.scopes?.includes('notification.provider.view'));
  }

  private parseHours(raw?: string): number {
    if (raw === undefined || raw === null || raw === '') return 24;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > 168) {
      throw new BadRequestException('hours must be an integer between 1 and 168');
    }
    return value;
  }

  private parseChannel(raw?: string): 'SMS' | 'PUSH' | 'EMAIL' | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const normalized = raw.trim().toUpperCase();
    if (!normalized) return undefined;
    if (!VALID_CHANNELS.has(normalized)) {
      throw new BadRequestException('channel must be one of SMS, PUSH, EMAIL');
    }
    return normalized as 'SMS' | 'PUSH' | 'EMAIL';
  }
}
