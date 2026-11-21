import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import type { AuthorizationPrincipal } from '../../src/authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../../src/authorization/privileged-action-approval.service';

// Only bearer identity is synthetic. Authorization, approval, consumption and catalogue writes
// use the production services and the suite's migrated PostgreSQL database.
const maker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: 'limit-fixture-maker',
  sessionId: '10000000-0000-4000-8000-000000000001',
  roles: ['FINANCE_PREPARER'],
  scopes: ['limit.modify'],
  assuranceLevel: 'MFA',
  customerAccess: 'NONE',
};
const checker: AuthorizationPrincipal = {
  ...maker,
  principalId: 'limit-fixture-checker',
  sessionId: '10000000-0000-4000-8000-000000000002',
  roles: ['FINANCE_CONTROLLER'],
  scopes: ['limit.modify', 'privileged:approve'],
};
export function limitSession(token: string, audience: string) {
  const identity =
    token === 'workforce-rule-maker' ? maker : token === 'workforce-rule-checker' ? checker : null;
  return identity ? { ...identity, audience } : null;
}

export async function prepareLimitWrite(
  app: NestFastifyApplication,
  method: 'post' | 'patch',
  path: string,
  fields: Record<string, unknown>,
) {
  const create = method === 'post';
  const body = {
    reason: 'Limit catalogue regression fixture',
    ...(create ? { effectiveFrom: '2026-01-01T00:00:00.000Z' } : {}),
    ...fields,
  };
  const server = app.getHttpServer();
  const proposal = await request(server)
    [method](path)
    .set('Authorization', 'Bearer workforce-rule-maker')
    .send(body);
  if (proposal.status === 400) return () => Promise.resolve(proposal); // DTO validation can reject before a proposal exists.
  expect(proposal.status).toBe(create ? 201 : 200);
  expect(proposal.body).toMatchObject({
    status: 'REQUESTED',
    actionType: create ? 'LIMIT_RULE_CREATE' : 'LIMIT_RULE_UPDATE',
  });
  const { approvalId } = proposal.body as { approvalId: string };
  const decision = await app
    .get(PrivilegedActionApprovalService)
    .approve({ principal: checker, approvalId, expectedVersion: 1 });
  expect(decision.approved).toBe(true);
  return () =>
    request(server)
      .post(`${path}/changes/${approvalId}/execute-${create ? 'create' : 'update'}`)
      .set('Authorization', 'Bearer workforce-rule-checker')
      .send(body);
}

export async function governedLimitWrite(...args: Parameters<typeof prepareLimitWrite>) {
  const execute = await prepareLimitWrite(...args);
  return execute();
}
