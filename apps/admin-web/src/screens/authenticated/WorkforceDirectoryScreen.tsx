import React, { useCallback, useEffect, useState } from 'react';

import { Alert, Button, Field, PageHeader } from '../../design-system/primitives';
import {
  StructuredColumn,
  StructuredKeyValueList,
  StructuredRecordTable,
} from '../../components/StructuredData';
import {
  Arena4OperationsApi,
  describeHttpError,
  type WorkforceDirectoryPage,
  type WorkforcePrincipalDetail,
} from '../../services/arena4-operations-api';
import { useAuthStore } from '../../store/auth-store';
import './arena4-operations.css';

/**
 * ARENA 4 — Workforce Administration visibility (read-only).
 *
 * Shows workforce users, role assignments, effective catalogue permissions, institution
 * restrictions, session/account status and the administrative authorizations already granted.
 * It offers no grant, revoke or elevation control: those stay on the maker/checker and
 * ADMINISTRATOR direct-execute routes in the existing Workforce and Role Governance workspaces.
 */

const DIRECTORY_COLUMNS: StructuredColumn[] = [
  { key: 'principalId', label: 'Principal' },
  { key: 'principalType', label: 'Type' },
  { key: 'accountStatus', label: 'Account status' },
  {
    key: 'roles',
    label: 'Roles',
    render: (value) =>
      Array.isArray(value) && value.length > 0
        ? value.map((role) => (role as { roleKey?: string }).roleKey ?? '—').join(', ')
        : '—',
  },
  {
    key: 'institutionScope',
    label: 'Institution scope',
    render: (value) => {
      const scope = value as WorkforceDirectoryPage['data'][number]['institutionScope'] | undefined;
      if (!scope) return '—';
      return scope.mode === 'INSTITUTIONS'
        ? `${scope.active.length} institution${scope.active.length === 1 ? '' : 's'}`
        : 'No active assignment';
    },
  },
  { key: 'permissionCount', label: 'Permissions' },
  { key: 'privilegedPermissionCount', label: 'Privileged' },
  { key: 'activeSessionCount', label: 'Active sessions' },
  { key: 'lastSeenAt', label: 'Last seen' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All account states' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DISABLED', label: 'Disabled' },
  { value: 'NO_CURRENT_GRANT', label: 'No current grant' },
  { value: 'NO_CATALOGUE_GRANT', label: 'No catalogue grant' },
];

export const WorkforceDirectoryScreen: React.FC = () => {
  const scopes = useAuthStore((state) => state.principal?.scopes);
  const canView = scopes?.includes('workforce.role.view') ?? false;
  return canView ? (
    <WorkforceDirectoryWorkspace />
  ) : (
    <Alert tone="danger" title="Workforce directory unavailable">
      This workspace requires the <code>workforce.role.view</code> authorization function.
    </Alert>
  );
};

const WorkforceDirectoryWorkspace: React.FC = () => {
  const [page, setPage] = useState<WorkforceDirectoryPage | null>(null);
  const [detail, setDetail] = useState<WorkforcePrincipalDetail | null>(null);
  const [search, setSearch] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ search: '', roleKey: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async (criteria: typeof applied) => {
    setLoading(true);
    setError('');
    try {
      setPage(
        await Arena4OperationsApi.workforceDirectory({
          search: criteria.search,
          roleKey: criteria.roleKey,
          status: criteria.status,
          page: 1,
          limit: 20,
        }),
      );
    } catch (loadError) {
      setError(describeHttpError(loadError, 'The workforce directory could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  const openDetail = async (row: Record<string, unknown>) => {
    const principalId = typeof row.principalId === 'string' ? row.principalId : '';
    if (!principalId) return;
    setDetailError('');
    try {
      setDetail(await Arena4OperationsApi.workforcePrincipal(principalId));
    } catch (detailFailure) {
      setDetail(null);
      setDetailError(describeHttpError(detailFailure, 'Principal detail could not be loaded.'));
    }
  };

  return (
    <section className="a4-ops" aria-label="Workforce directory">
      <PageHeader
        title="Workforce directory"
        description="Read-only visibility of workforce users, roles, effective permissions, institution restrictions and account status."
      />

      <p className="a4-ops__notice" data-testid="a4-workforce-readonly-notice">
        Read-only. This workspace cannot grant, revoke or elevate any role or function. Grants
        remain subject to the existing maker/checker and ADMINISTRATOR direct-execute controls.
      </p>

      {error ? (
        <Alert tone="danger" title="Unable to load the workforce directory">
          {error}
        </Alert>
      ) : null}

      <form
        className="a4-ops__filters"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ search, roleKey, status });
        }}
      >
        <Field label="Search principal" htmlFor="a4-workforce-search">
          <input
            id="a4-workforce-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label="Role key" htmlFor="a4-workforce-role">
          <input
            id="a4-workforce-role"
            value={roleKey}
            placeholder="e.g. FINANCE_AUDITOR"
            onChange={(event) => setRoleKey(event.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Account status" htmlFor="a4-workforce-status">
          <select
            id="a4-workforce-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'ALL'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" variant="primary" disabled={loading}>
          Apply filters
        </Button>
      </form>

      {loading ? (
        <p role="status">Loading workforce directory…</p>
      ) : page ? (
        <>
          <StructuredRecordTable
            rows={page?.data ?? []}
            columns={DIRECTORY_COLUMNS}
            emptyMessage="No workforce principals match these filters."
            onViewDetails={(row) => {
              void openDetail(row);
            }}
          />
          <p className="a4-ops__muted">
            {page.total} principal{page.total === 1 ? '' : 's'} · page {page.page} of{' '}
            {page.totalPages || 1} · access mode {page.accessMode}
          </p>
        </>
      ) : null}

      {detailError ? (
        <Alert tone="danger" title="Principal detail unavailable">
          {detailError}
        </Alert>
      ) : null}

      {detail ? (
        <section className="a4-ops__detail" aria-label="Workforce principal detail">
          <h3>
            {detail.principalId} <span className="a4-ops__pill">{detail.accountStatus}</span>
          </h3>
          <div className="a4-ops__grid">
            <div className="a4-ops__card">
              <h3>Roles</h3>
              {detail.roles.length === 0 ? (
                <p className="a4-ops__muted">No catalogue role assignments.</p>
              ) : (
                <ul>
                  {detail.roles.map((role) => (
                    <li key={`${role.roleKey}-${role.status}`}>
                      {role.roleKey} — {role.status}
                      {role.readOnly ? ' (read-only role)' : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="a4-ops__card">
              <h3>Institution restrictions</h3>
              <p className="a4-ops__muted">
                {detail.institutionScope.mode === 'INSTITUTIONS'
                  ? 'Scoped to assigned institutions'
                  : 'No active institution assignment'}
                {detail.institutionScope.platformFunctionGranted
                  ? ' · holds the platform attribution function'
                  : ''}
              </p>
              <ul>
                {detail.institutionScope.active.map((assignment) => (
                  <li key={assignment.institutionId}>
                    {assignment.institutionName ?? assignment.institutionId}
                  </li>
                ))}
              </ul>
              {detail.institutionScope.revokedCount > 0 ? (
                <p className="a4-ops__muted">
                  {detail.institutionScope.revokedCount} revoked assignment
                  {detail.institutionScope.revokedCount === 1 ? '' : 's'} in history.
                </p>
              ) : null}
            </div>
            <div className="a4-ops__card">
              <h3>Sessions</h3>
              {detail.sessions.length === 0 ? (
                <p className="a4-ops__muted">No recorded sessions.</p>
              ) : (
                <ul>
                  {detail.sessions.map((session) => (
                    <li key={session.id}>
                      {session.status} · {session.assuranceLevel ?? 'assurance unknown'} · last seen{' '}
                      {session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString() : '—'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <h4>Effective permissions ({detail.effectivePermissions.length})</h4>
            <table className="a4-ops__table">
              <thead>
                <tr>
                  <th scope="col">Function</th>
                  <th scope="col">Access</th>
                  <th scope="col">Domain</th>
                  <th scope="col">Sensitivity</th>
                </tr>
              </thead>
              <tbody>
                {detail.effectivePermissions.map((permission) => (
                  <tr key={`${permission.functionCode}-${permission.accessType}`}>
                    <td>{permission.functionCode}</td>
                    <td>{permission.accessType}</td>
                    <td>{permission.domain}</td>
                    <td>{permission.sensitivity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h4>Administrative authorizations</h4>
            <StructuredKeyValueList
              data={{
                count: detail.administrativeAuthorizations.length,
                functions: detail.administrativeAuthorizations.map((item) => item.functionCode),
                boundary: detail.boundaries.note,
              }}
            />
          </div>
        </section>
      ) : null}
    </section>
  );
};
