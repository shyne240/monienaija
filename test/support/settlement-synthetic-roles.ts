import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { A2FinanceRoleAssignment } from '../../src/authorization/workforce-authentication.entity';

// These throwaway credentials are created only in a separately confirmed disposable test database.
// Never seed or change the project's canonical local accounts.
export const ROLES = [
  'SUPER_ADMIN',
  'FINANCE_PREPARER',
  'FINANCE_CONTROLLER',
  'FINANCE_AUDITOR',
  'ADMINISTRATOR',
  'OPERATIONS',
  'AGENT_NETWORK_MANAGER',
  'COMPLIANCE',
  'RISK_FRAUD',
  'CUSTOMER_SERVICE',
  'TREASURY',
] as const;
const nonce = randomBytes(8).toString('hex');
const password = randomBytes(24).toString('base64url');
export const emailFor = (role: string): string =>
  `sr-${nonce}-${role.toLowerCase().replace(/_/g, '-')}@example.invalid`;
export const passwordFor = (role: string): string => {
  void role;
  return password;
};

export async function seedLocalRoles(
  ds: DataSource,
  config: { enabled: boolean; oidcIssuer: string },
): Promise<void> {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER !== 'yes' ||
    !['localhost', '127.0.0.1', '::1'].includes(
      String('host' in ds.options ? ds.options.host : ''),
    ) ||
    !config.enabled
  ) {
    throw new Error('Synthetic settlement roles require a confirmed disposable test database');
  }
  for (const roleKey of ROLES) {
    const email = emailFor(roleKey);
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
    const encoded = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${hash.toString('base64url')}`;
    await ds.query(
      `INSERT INTO local_admin_credentials(id,email,password_hash,hash_algorithm) VALUES ($1,$2,$3,'PBKDF2')`,
      [randomUUID(), email, encoded],
    );
    const principalId = `${config.oidcIssuer || 'https://identity.issuer.invalid'}:local-admin-credential:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
    const now = new Date();
    await ds.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `sr-synthetic-${randomUUID()}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 86400_000),
      assignedBy: 'sr-synthetic-fixture',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    });
  }
}
