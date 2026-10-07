/**
 * DEVELOPMENT ONLY — V1-LOCAL-01 local Agent account creation helper.
 *
 * Why this exists: in real V1, standing up an Agent requires a human workforce
 * reviewer (an OPERATOR/SERVICE/PRIVILEGED principal obtained through a real OIDC
 * login or the one-time break-glass bootstrap ceremony documented in
 * docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md) to review and approve the
 * application, activate the Agent, and issue its first credential. That is the
 * correct, audited production path and this script does not replace it for a real
 * deployment.
 *
 * For local development, standing up that entire OIDC/workforce ceremony just to
 * get one test Agent is disproportionate. This script performs the exact same
 * sequence of real, validated application service calls
 * (AgentClassService.create -> AgentApplicationService.create -> markUnderReview
 * -> approve -> AgentLifecycleService.activateFromApplication ->
 * AgentAuthenticationService.issueInitialCredential) in-process, the same way
 * scripts/infra03-seed.js already does for customers in this repository. No raw
 * SQL is used against identity/credential tables, and no state-machine step is
 * skipped — only the "who is allowed to call this" authorization check (normally
 * enforced by the HTTP workforce-session guard) is bypassed, because this runs
 * as a trusted in-process script against your own local, disposable database.
 *
 * NEVER run this against a production database.
 *
 * Usage:
 *   node scripts/local-dev-create-agent.js <businessName>
 *
 * Output: the Agent's id and a ONE-TIME plaintext temporary password. The Agent
 * must then call POST /api/v1/agents/credentials/rotate once (see the guide) to
 * set a permanent password before it can log in normally, exactly like a real
 * Agent would on first use of a workforce-issued credential.
 */
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');

async function main() {
  const businessName = process.argv[2] || `Local Test Agent ${randomUUID().slice(0, 6)}`;
  const actor = 'local-dev-create-agent-script';

  const { AppModule } = require('../dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const { AgentClassService } = require('../dist/agent/agent-class.service');
    const { AgentApplicationService } = require('../dist/agent/agent-application.service');
    const { AgentLifecycleService } = require('../dist/agent/agent-lifecycle.service');
    const { AgentAuthenticationService } = require('../dist/agent-authentication/agent-authentication.service');
    const { AgentPasswordHashAlgorithm } = require('../dist/agent-authentication/agent-authentication.enums');

    const classService = app.get(AgentClassService);
    const applicationService = app.get(AgentApplicationService);
    const lifecycleService = app.get(AgentLifecycleService);
    const authService = app.get(AgentAuthenticationService);

    const agentClass = await classService.create({
      name: 'Local Dev Agent Class',
      isActive: true,
      // All five V1 Agent services permitted, so this local test Agent can exercise
      // Cash-In, Cash-Out, Cash-to-Cash, and admin funding/defunding end to end.
      applicableServices: ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING', 'AGENT_DEFUNDING'],
      actor,
    });

    const application = await applicationService.create({
      agentClassId: agentClass.id,
      applicantReference: `local-dev-${randomUUID().slice(0, 8)}`,
      businessName,
      actor,
    });

    await applicationService.submit(application.id, actor);
    await applicationService.markUnderReview(application.id, actor);
    await applicationService.approve(application.id, actor);
    const agent = await lifecycleService.activateFromApplication(application.id, actor);

    const { pbkdf2Sync, randomBytes } = require('node:crypto');
    const plaintext = randomBytes(12).toString('base64url');
    const salt = randomBytes(16);
    const iterations = 10_000;
    const derived = pbkdf2Sync(plaintext, salt, iterations, 32, 'sha256');
    const passwordHash = `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;

    await authService.issueInitialCredential(agent.id, {
      passwordHash,
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      passwordExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      actor,
    });

    console.log(
      JSON.stringify(
        {
          status: 'DEVELOPMENT ONLY — local database only, never run against production',
          agentId: agent.id,
          businessName,
          temporaryPassword: plaintext,
          nextStep:
            'POST /api/v1/agents/credentials/rotate with this agentId + temporaryPassword + a new permanent password to finish setup (see the guide).',
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('LOCAL DEV AGENT CREATION FAILED:', e.message || e);
  process.exit(1);
});
