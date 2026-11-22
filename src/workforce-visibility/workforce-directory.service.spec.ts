import type { DataSource } from 'typeorm';

import { WorkforceDirectoryService } from './workforce-directory.service';

function dataSourceWith(responses: unknown[][]): DataSource {
  let index = 0;
  return {
    query: jest.fn(() => Promise.resolve(responses[index++] ?? [])),
  } as unknown as DataSource;
}

const NOW = new Date();

describe('ARENA 4 workforce directory', () => {
  it('derives account status and never reports an absent assignment as platform reach', async () => {
    const dataSource = dataSourceWith([
      // candidates
      [{ principal_id: 'admin-1' }, { principal_id: 'finance-1' }, { principal_id: 'idle-1' }],
      // assignments
      [
        {
          principal_id: 'admin-1',
          role_key: 'ADMINISTRATOR',
          status: 'ACTIVE',
          effective_from: new Date(NOW.getTime() - 60_000),
          effective_to: new Date(NOW.getTime() + 60_000),
          assigned_by: 'SUPER_ADMIN',
          assigned_at: NOW,
          revoked_at: null,
          read_only: false,
        },
        {
          principal_id: 'finance-1',
          role_key: 'FINANCE_AUDITOR',
          status: 'ACTIVE',
          effective_from: new Date(NOW.getTime() - 60_000),
          effective_to: new Date(NOW.getTime() + 60_000),
          assigned_by: 'SUPER_ADMIN',
          assigned_at: NOW,
          revoked_at: null,
          read_only: true,
        },
        {
          principal_id: 'idle-1',
          role_key: 'OPERATIONS',
          status: 'REVOKED',
          effective_from: new Date(NOW.getTime() - 120_000),
          effective_to: new Date(NOW.getTime() - 60_000),
          assigned_by: 'SUPER_ADMIN',
          assigned_at: NOW,
          revoked_at: NOW,
          read_only: false,
        },
      ],
      // sessions
      [
        { principal_id: 'admin-1', status: 'ACTIVE', last_seen_at: NOW },
        { principal_id: 'idle-1', status: 'REVOKED', last_seen_at: new Date(NOW.getTime() - 1000) },
      ],
      // institution assignments
      [
        {
          principal_id: 'admin-1',
          institution_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          status: 'ACTIVE',
          granted_by: 'SUPER_ADMIN',
          granted_at: NOW,
          legal_name: 'Example Bank',
          code: 'EXB',
        },
      ],
      // support users
      [],
      // permission counts
      [
        {
          principal_id: 'admin-1',
          permission_count: 12,
          privileged_count: 4,
          platform_scope: true,
        },
        {
          principal_id: 'finance-1',
          permission_count: 6,
          privileged_count: 0,
          platform_scope: false,
        },
      ],
    ]);
    const service = new WorkforceDirectoryService(dataSource);

    const page = await service.list({ page: 1, limit: 20 });
    const byId = new Map(page.data.map((entry) => [entry.principalId, entry]));

    expect(page.accessMode).toBe('READ_ONLY');
    expect(byId.get('admin-1')?.accountStatus).toBe('ACTIVE');
    expect(byId.get('admin-1')?.institutionScope.mode).toBe('INSTITUTIONS');
    expect(byId.get('admin-1')?.institutionScope.platformFunctionGranted).toBe(true);
    expect(byId.get('admin-1')?.institutionScope.active[0]?.institutionName).toBe('Example Bank');
    expect(byId.get('finance-1')?.readOnlyPrincipal).toBe(true);
    expect(byId.get('finance-1')?.institutionScope.mode).toBe('NONE');
    expect(byId.get('finance-1')?.institutionScope.platformFunctionGranted).toBe(false);
    expect(byId.get('idle-1')?.accountStatus).toBe('NO_CURRENT_GRANT');
    expect(byId.get('idle-1')?.activeSessionCount).toBe(0);
  });

  it('filters by derived status and paginates deterministically', async () => {
    const dataSource = dataSourceWith([
      [{ principal_id: 'a' }, { principal_id: 'b' }],
      [
        {
          principal_id: 'a',
          role_key: 'SUPER_ADMIN',
          status: 'ACTIVE',
          effective_from: new Date(NOW.getTime() - 60_000),
          effective_to: new Date(NOW.getTime() + 60_000),
          assigned_by: 'ops',
          assigned_at: NOW,
          revoked_at: null,
          read_only: false,
        },
      ],
      [],
      [],
      [],
      [{ principal_id: 'a', permission_count: 1, privileged_count: 1, platform_scope: false }],
    ]);
    const service = new WorkforceDirectoryService(dataSource);
    const page = await service.list({ page: 1, limit: 1, status: 'ACTIVE' });
    expect(page.total).toBe(1);
    expect(page.data).toHaveLength(1);
    expect(page.hasNextPage).toBe(false);
  });

  it('rejects invalid filters before querying', async () => {
    const dataSource = dataSourceWith([]);
    const service = new WorkforceDirectoryService(dataSource);
    const query = (dataSource as unknown as { query: jest.Mock }).query;
    await expect(service.list({ page: 1, limit: 20, roleKey: 'lower-case' })).rejects.toThrow(
      'roleKey must be an upper-case role key',
    );
    await expect(service.list({ page: 1, limit: 20, institutionId: 'not-a-uuid' })).rejects.toThrow(
      'institutionId must be a UUID',
    );
    await expect(service.list({ page: 1, limit: 20, status: 'UNKNOWN' as never })).rejects.toThrow(
      'status must be one of',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('returns detail with effective permissions and the read-only boundary', async () => {
    const dataSource = dataSourceWith([
      [
        {
          principal_id: 'finance-1',
          role_key: 'FINANCE_AUDITOR',
          status: 'ACTIVE',
          effective_from: new Date(NOW.getTime() - 60_000),
          effective_to: new Date(NOW.getTime() + 60_000),
          assigned_by: 'SUPER_ADMIN',
          assigned_at: NOW,
          revoked_at: null,
          read_only: true,
        },
      ],
      [{ principal_id: 'finance-1', status: 'ACTIVE', last_seen_at: NOW }],
      [],
      [],
      [
        {
          principal_id: 'finance-1',
          permission_count: 2,
          privileged_count: 0,
          platform_scope: false,
        },
      ],
      // support account lookup
      [],
      // sessions detail
      [
        {
          id: 'ssssssss-ssss-4sss-8sss-ssssssssssss',
          status: 'ACTIVE',
          assurance_level: 'MFA',
          audience: 'workforce-admin',
          authenticated_at: NOW,
          issued_at: NOW,
          expires_at: new Date(NOW.getTime() + 900_000),
          last_seen_at: NOW,
          revoked_at: null,
          token_hash: 'must-not-be-projected',
        },
      ],
      // permissions
      [
        {
          function_code: 'audit.view',
          access_type: 'VIEW',
          domain: 'AUDIT',
          name: 'View audit record',
          sensitivity: 'READ',
          v1_status: 'IMPLEMENTED',
        },
        {
          function_code: 'workforce.role.view',
          access_type: 'VIEW',
          domain: 'WORKFORCE',
          name: 'View workforce role assignments',
          sensitivity: 'READ',
          v1_status: 'PARTIALLY_IMPLEMENTED',
        },
      ],
    ]);
    const service = new WorkforceDirectoryService(dataSource);
    const detail = await service.detail('finance-1');
    expect(detail.boundaries.readOnly).toBe(true);
    expect(detail.effectivePermissions.map((permission) => permission.functionCode)).toEqual([
      'audit.view',
      'workforce.role.view',
    ]);
    // Both are VIEW/READ; administrativeAuthorizations is a domain-based subset.
    expect(detail.administrativeAuthorizations.map((item) => item.functionCode)).toEqual([
      'audit.view',
      'workforce.role.view',
    ]);
    expect(JSON.stringify(detail)).not.toContain('must-not-be-projected');
    expect(detail.sessions[0]?.assuranceLevel).toBe('MFA');
  });

  it('throws not found for an unknown principal', async () => {
    const service = new WorkforceDirectoryService(dataSourceWith([[]]));
    await expect(service.detail('missing')).rejects.toThrow('Workforce principal not found');
  });
});
