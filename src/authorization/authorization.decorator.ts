import { SetMetadata } from '@nestjs/common';

import type { AuthorizationPolicy } from './authorization.types';

export const AUTHORIZATION_POLICY_METADATA = 'authorization:policy';

export const RequireAuthorization = (policy: AuthorizationPolicy) =>
  SetMetadata(AUTHORIZATION_POLICY_METADATA, policy);
