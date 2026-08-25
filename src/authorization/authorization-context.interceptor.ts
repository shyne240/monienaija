import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

import {
  runWithAuthorizationContext,
  type AuthorizationContext,
} from './authorization-context';
import type { AuthorizationPrincipal } from './authorization.types';

/**
 * Interceptor that establishes authorization context from the HTTP request.
 * This must be applied globally or to specific controllers that need authorization context.
 *
 * The RuntimeAccessGuard sets request.authorizationPrincipal after validating the session.
 * This interceptor reads that principal and establishes it in AsyncLocalStorage so that
 * services can access it via requirePrincipal() without it being passed explicitly.
 */
@Injectable()
export class AuthorizationContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const principal: AuthorizationPrincipal | undefined = request.authorizationPrincipal;

    if (!principal) {
      // No principal set (e.g., public route or guard didn't run)
      // Let the request proceed without authorization context
      return next.handle();
    }

    const authContext: AuthorizationContext = {
      principal,
      source: 'http-request',
    };

    // Run the rest of the request with the authorization context established
    return new Observable((subscriber) => {
      runWithAuthorizationContext(authContext, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
