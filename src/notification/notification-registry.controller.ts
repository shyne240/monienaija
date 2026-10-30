import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { NotificationRegistryService } from './notification-registry.service';

interface WorkforceRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

/** Workforce-only, read/preview + maker-checker API. No endpoint sends a notification. */
@Controller('internal/notifications')
export class NotificationRegistryController {
  constructor(private readonly registry: NotificationRegistryService) {}

  @Get('events')
  async events(@Req() request: WorkforceRequest) {
    await this.registry.requireRead(request.authorizationPrincipal);
    return this.registry.listEvents();
  }

  @Get('templates')
  async templates(
    @Req() request: WorkforceRequest,
    @Query('eventType') eventType?: string,
    @Query('channel') channel?: string,
    @Query('locale') locale?: string,
    @Query('limit') limit?: string,
    @Query('beforeVersion') beforeVersion?: string,
  ) {
    await this.registry.requireRead(request.authorizationPrincipal);
    return this.registry.listTemplates(eventType, channel, locale, limit, beforeVersion);
  }

  @Get('changes')
  async changes(
    @Req() request: WorkforceRequest,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.registry.requireRead(request.authorizationPrincipal);
    return this.registry.listChanges(status, page, limit);
  }

  @Post('templates/preview')
  @HttpCode(200)
  async preview(@Req() request: WorkforceRequest, @Body() body: unknown) {
    await this.registry.requireRead(request.authorizationPrincipal);
    return this.registry.preview(body);
  }

  @Post('changes')
  async requestChange(@Req() request: WorkforceRequest, @Body() body: unknown) {
    return this.registry.requestChange(this.principal(request), body);
  }

  @Get('changes/:approvalId')
  async change(@Req() request: WorkforceRequest, @Param('approvalId') approvalId: string) {
    await this.registry.requireRead(request.authorizationPrincipal);
    return this.registry.getChange(approvalId);
  }

  @Post('changes/:approvalId/execute')
  @HttpCode(200)
  async execute(
    @Req() request: WorkforceRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: unknown,
  ) {
    if (
      body !== undefined &&
      body !== null &&
      (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
    ) {
      throw new ForbiddenException('Execution uses the stored approved proposal only');
    }
    return this.registry.executeChange(this.principal(request), approvalId);
  }

  private principal(request: WorkforceRequest): AuthorizationPrincipal {
    if (!request.authorizationPrincipal)
      throw new ForbiddenException('Workforce principal required');
    return request.authorizationPrincipal;
  }
}
