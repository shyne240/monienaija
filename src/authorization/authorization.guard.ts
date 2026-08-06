import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthorizationService } from './authorization.service';
import type { AuthorizationPolicy, AuthorizationRequest } from './authorization.types';
import { AUTHORIZATION_POLICY_METADATA } from './authorization.decorator';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<AuthorizationPolicy>(
      AUTHORIZATION_POLICY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!policy) {
      throw new ForbiddenException('Authorization policy is not configured');
    }

    const request = context.switchToHttp().getRequest<
      AuthorizationRequest & {
        params?: Record<string, string | undefined>;
        body?: Record<string, unknown>;
      }
    >();
    const principal = request.authorizationPrincipal;
    const customerId = request.params?.customerId ?? request.params?.id;
    const resourceId = request.params?.resourceId ?? request.params?.id;
    const decision = await this.authorizationService.authorize(principal, policy, {
      type: policy.resourceType,
      id: resourceId,
      customerId,
    });
    request.authorizationDecision = decision;
    if (!decision.allowed) {
      throw new ForbiddenException(`Authorization denied: ${decision.reason}`);
    }
    return true;
  }
}
