import './operational-surfaces.css';
import { Button, PageHeader } from '../../design-system/primitives';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './workforce-workspace.css';
import './role-governance-redesign.css';
import { useDialogFocus } from '../../utils/use-dialog-focus';
import { ApiClient } from '../../services/api-client';
import {
  Arena4OperationsApi,
  describeHttpError,
  type WorkforcePrincipalDetail,
} from '../../services/arena4-operations-api';
import { useAuthStore } from '../../store/auth-store';

type RoleDomain = 'finance' | 'operational';
type RoleAction = 'assign' | 'revoke';
type RoleReview = {
  domain: RoleDomain;
  action: RoleAction;
  target: string;
  role: string;
  from: string;
  to: string;
  approvals: string[];
};

const FINANCE_ROLES = ['FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'FINANCE_AUDITOR'];
const OPERATIONAL_ROLES = [
  'OPERATIONS',
  'AGENT_NETWORK_MANAGER',
  'COMPLIANCE',
  'RISK_FRAUD',
  'CUSTOMER_SERVICE',
  'TREASURY',
];

export const RoleAssignmentScreen: React.FC<{
  onRoleGuardChange?: (guarded: boolean, busy: boolean) => void;
  /**
   * Set when an authorized operator picks an identity in the Workforce Directory and chooses
   * "Govern access". The directory row is real server data, so the governance form opens with the
   * exact principal the operator inspected instead of asking them to retype an identifier.
   */
  initialTargetPrincipalId?: string;
}> = ({ onRoleGuardChange, initialTargetPrincipalId }) => {
  const { principal, sessionId } = useAuthStore();
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const isSuperAdmin = principal?.roles.includes('SUPER_ADMIN') === true;
  const isAdministrator = principal?.roles.includes('ADMINISTRATOR') === true;
  const canWrite = !principal?.readOnlyPrincipal;
  const canViewDirectory = principal?.scopes.includes('workforce.role.view') ?? false;
  const canAssignFinance = canWrite && isSuperAdmin && hasFn('workforce.role.assign');
  const canRevokeFinance = canWrite && isSuperAdmin && hasFn('workforce.role.revoke');
  const canAssignOperational =
    canWrite && (isAdministrator || isSuperAdmin) && hasFn('workforce.role.assign_operational');
  const canRevokeOperational =
    canWrite && (isAdministrator || isSuperAdmin) && hasFn('workforce.role.revoke_operational');
  const principalId = principal?.principalId ?? '';
  const hasMfa = principal?.assuranceLevel === 'MFA';
  const key = JSON.stringify([
    sessionId,
    principalId,
    principal?.sessionId,
    principal?.type,
    principal?.roles,
    principal?.scopes,
    principal?.customerAccess,
    principal?.assuranceLevel,
    principal?.readOnlyPrincipal,
    canAssignFinance,
    canRevokeFinance,
    canAssignOperational,
    canRevokeOperational,
  ]);
  return (
    <RoleWorkspace
      key={key}
      principalId={principalId}
      hasMfa={hasMfa}
      canAssignFinance={canAssignFinance}
      canRevokeFinance={canRevokeFinance}
      canAssignOperational={canAssignOperational}
      canRevokeOperational={canRevokeOperational}
      canViewDirectory={canViewDirectory}
      initialTargetPrincipalId={initialTargetPrincipalId}
      onRoleGuardChange={onRoleGuardChange}
    />
  );
};

const RoleWorkspace: React.FC<{
  principalId: string;
  hasMfa: boolean;
  canAssignFinance: boolean;
  canRevokeFinance: boolean;
  canAssignOperational: boolean;
  canRevokeOperational: boolean;
  canViewDirectory: boolean;
  initialTargetPrincipalId?: string;
  onRoleGuardChange?: (guarded: boolean, busy: boolean) => void;
}> = ({
  principalId,
  hasMfa,
  canAssignFinance,
  canRevokeFinance,
  canAssignOperational,
  canRevokeOperational,
  canViewDirectory,
  initialTargetPrincipalId,
  onRoleGuardChange,
}) => {
  const requestGeneration = useRef(0);
  useEffect(
    () => () => {
      requestGeneration.current += 1;
    },
    [],
  );
  const canManageFinanceRoles = canAssignFinance || canRevokeFinance;
  const canManageOperationalRoles = canAssignOperational || canRevokeOperational;
  const canManageAnyRoles = canManageFinanceRoles || canManageOperationalRoles;
  const initialDomain: RoleDomain = canManageFinanceRoles ? 'finance' : 'operational';
  const initialAction: RoleAction =
    initialDomain === 'finance'
      ? canAssignFinance
        ? 'assign'
        : 'revoke'
      : canAssignOperational
        ? 'assign'
        : 'revoke';

  const [domain, setDomain] = useState<RoleDomain>(initialDomain);
  const [action, setAction] = useState<RoleAction>(initialAction);
  const [targetPrincipalId, setTargetPrincipalId] = useState(
    (initialTargetPrincipalId ?? '').trim(),
  );
  /**
   * Current-role view of the target, read from the authorized workforce directory
   * (`GET /internal/workforce/directory/:principalId`). Read-only: this never grants anything, it
   * only prevents an operator from approving a change against an identity whose actual current
   * roles they have not seen.
   */
  const [identity, setIdentity] = useState<{
    id: string;
    loading: boolean;
    detail: WorkforcePrincipalDetail | null;
    problem: string;
  }>({ id: '', loading: false, detail: null, problem: '' });
  const [roleKey, setRoleKey] = useState(
    initialDomain === 'finance' ? 'FINANCE_PREPARER' : 'OPERATIONS',
  );
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [approvalIds, setApprovalIds] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successDetails, setSuccessDetails] = useState<RoleReview | null>(null);
  const [pendingReview, setPendingReview] = useState<RoleReview | null>(null);
  const [uncertainRole, setUncertainRole] = useState<RoleReview | null>(null);
  const roleGuard =
    isLoading ||
    Boolean(pendingReview) ||
    Boolean(uncertainRole) ||
    Boolean(targetPrincipalId.trim() || effectiveFrom || effectiveTo || approvalIds.trim());
  useEffect(() => {
    onRoleGuardChange?.(roleGuard, isLoading);
  }, [onRoleGuardChange, roleGuard, isLoading]);
  useEffect(() => () => onRoleGuardChange?.(false, false), [onRoleGuardChange]);
  useEffect(() => {
    if (!roleGuard) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [roleGuard]);

  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  useDialogFocus(
    dialogRef,
    Boolean(pendingReview),
    () => {
      if (!inFlight.current) setPendingReview(null);
    },
    triggerRef,
  );
  useEffect(() => {
    if (isLoading) dialogRef.current?.focus();
  }, [isLoading]);

  const canAssign = domain === 'finance' ? canAssignFinance : canAssignOperational;
  const canRevoke = domain === 'finance' ? canRevokeFinance : canRevokeOperational;
  const roleOptions = domain === 'finance' ? FINANCE_ROLES : OPERATIONAL_ROLES;

  const loadIdentity = useCallback(
    async (id: string) => {
      if (!id) {
        setIdentity({
          id: '',
          loading: false,
          detail: null,
          problem: 'Enter a principal id before looking it up.',
        });
        return;
      }
      if (!canViewDirectory) {
        setIdentity({
          id,
          loading: false,
          detail: null,
          problem:
            'Identity lookup requires the workforce.role.view function. Enter the principal id from an authorized record; this form cannot show its current roles.',
        });
        return;
      }
      setIdentity({ id, loading: true, detail: null, problem: '' });
      try {
        const detail = await Arena4OperationsApi.workforcePrincipal(id);
        setIdentity({ id, loading: false, detail, problem: '' });
      } catch (lookupFailure: any) {
        setIdentity({
          id,
          loading: false,
          detail: null,
          problem:
            lookupFailure?.status === 404
              ? 'No workforce identity in the authoritatively scoped directory matches that principal id. Confirm the identifier from an authorized record before acting.'
              : describeHttpError(
                  lookupFailure,
                  'The target identity could not be read. Submit only after verifying the principal in an authorized record.',
                ),
        });
      }
    },
    [canViewDirectory],
  );

  // A directory hand-off opens this workspace with a principal already chosen. Read that identity
  // immediately so the operator sees current roles before entering an entitlement.
  useEffect(() => {
    const prefill = (initialTargetPrincipalId ?? '').trim();
    if (prefill) void loadIdentity(prefill);
  }, [initialTargetPrincipalId, loadIdentity]);

  const verifiedIdentity =
    identity.detail && identity.id === targetPrincipalId.trim() ? identity.detail : null;
  const activeRoleKeys =
    verifiedIdentity?.roles
      .filter((role) => role.status === 'ACTIVE')
      .map((role) => role.roleKey) ?? [];
  /** Explains why the chosen action contradicts the target's verified current roles. */
  const identityConflict = verifiedIdentity
    ? action === 'assign'
      ? activeRoleKeys.includes(roleKey)
        ? `The target already holds an active ${roleKey} assignment. Revoke that assignment instead of assigning it again.`
        : ''
      : activeRoleKeys.includes(roleKey)
        ? ''
        : `The target holds no active ${roleKey} assignment, so there is nothing to revoke.`
    : '';

  const changeDomain = (nextDomain: RoleDomain) => {
    if (
      uncertainRole ||
      (nextDomain !== domain &&
        approvalIds.trim() &&
        !window.confirm('Switch role domain and discard the entered finance approval IDs?'))
    )
      return;
    setDomain(nextDomain);
    setRoleKey(nextDomain === 'finance' ? 'FINANCE_PREPARER' : 'OPERATIONS');
    setAction(
      nextDomain === 'finance'
        ? canAssignFinance
          ? 'assign'
          : 'revoke'
        : canAssignOperational
          ? 'assign'
          : 'revoke',
    );
    setApprovalIds('');
    setError('');
    setSuccess(false);
  };

  const handleRoleAction = (event: React.FormEvent) => {
    event.preventDefault();
    if (
      uncertainRole ||
      pendingReview ||
      isLoading ||
      inFlight.current ||
      (action === 'assign' && (!canAssign || !hasMfa)) ||
      (action === 'revoke' && !canRevoke)
    )
      return;
    setError('');
    setSuccess(false);
    setSuccessDetails(null);
    if (!targetPrincipalId.trim()) {
      setError('Target Principal ID is required');
      return;
    }
    if (targetPrincipalId.trim() === principalId) {
      setError('Self assignment or revocation is prohibited.');
      return;
    }
    if (identityConflict) {
      setError(identityConflict);
      return;
    }
    if (!effectiveFrom.trim() || !effectiveTo.trim()) {
      setError('Effective window dates are required');
      return;
    }
    const start = new Date(effectiveFrom);
    const end = new Date(effectiveTo);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      setError('Enter a valid effective window where Effective To is later than Effective From.');
      return;
    }
    setPendingReview({
      domain,
      action,
      target: targetPrincipalId.trim(),
      role: roleKey,
      from: start.toISOString(),
      to: end.toISOString(),
      approvals:
        domain === 'finance' && approvalIds.trim()
          ? approvalIds
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
    });
  };

  const confirmRoleAction = async () => {
    if (uncertainRole || !pendingReview || isLoading || inFlight.current) return;
    const review = pendingReview;
    if (
      (review.action === 'assign' &&
        (!(review.domain === 'finance' ? canAssignFinance : canAssignOperational) || !hasMfa)) ||
      (review.action === 'revoke' &&
        !(review.domain === 'finance' ? canRevokeFinance : canRevokeOperational))
    )
      return;
    const request = ++requestGeneration.current;
    inFlight.current = true;
    setIsLoading(true);
    setError('');
    setSuccess(false);
    try {
      let receipt: any;
      if (review.action === 'assign') {
        receipt = await ApiClient.post('/internal/a2/workforce/roles', {
          targetPrincipalId: review.target,
          roleKey: review.role,
          effectiveFrom: review.from,
          effectiveTo: review.to,
          ...(review.domain === 'finance'
            ? { approvalIds: review.approvals.length > 0 ? review.approvals : undefined }
            : {}),
        });
      } else {
        receipt = await ApiClient.delete(
          `/internal/a2/workforce/roles/${encodeURIComponent(review.target)}/${review.role}`,
          {
            body: {
              effectiveFrom: review.from,
              effectiveTo: review.to,
              approvalIds: review.domain === 'finance' ? review.approvals : [],
            },
          },
        );
      }
      if (request !== requestGeneration.current) return;
      const validDate = (value: unknown) =>
        typeof value === 'string' && Number.isFinite(Date.parse(value));
      const matches =
        receipt &&
        typeof receipt.assignmentReference === 'string' &&
        Boolean(receipt.assignmentReference.trim()) &&
        Number.isSafeInteger(receipt.assignmentVersion) &&
        receipt.assignmentVersion > 0 &&
        receipt.status === (review.action === 'assign' ? 'ACTIVE' : 'REVOKED') &&
        receipt.principalId === review.target &&
        receipt.roleKey === review.role &&
        (review.action === 'assign'
          ? receipt.assignedBy === principalId &&
            validDate(receipt.assignedAt) &&
            validDate(receipt.effectiveFrom) &&
            validDate(receipt.effectiveTo) &&
            Date.parse(receipt.effectiveFrom) === Date.parse(review.from) &&
            Date.parse(receipt.effectiveTo) === Date.parse(review.to)
          : receipt.revokedBy === principalId && validDate(receipt.revokedAt));
      if (!matches) {
        setUncertainRole(review);
        setError(
          'Role change outcome is unconfirmed. Check an authorized workforce record and audit trail before retrying.',
        );
        return;
      }
      setSuccess(true);
      setSuccessDetails(review);
      setTargetPrincipalId('');
      setEffectiveFrom('');
      setEffectiveTo('');
      setApprovalIds('');
    } catch (err: any) {
      if (request === requestGeneration.current) {
        setUncertainRole(review);
        setError(
          `Role change outcome is unconfirmed. Check an authorized workforce record or audit trail before retrying. ${err?.message || 'Service unavailable.'}`,
        );
      }
    } finally {
      inFlight.current = false;
      if (request === requestGeneration.current) {
        setIsLoading(false);
        setPendingReview(null);
      }
    }
  };

  if (!canManageAnyRoles) {
    return (
      <div className="mn-operational" style={styles.container} role="alert">
        <div style={styles.errorBox}>
          Role governance requires an applicable workforce role function, the authorized initiator
          role, and a session that is not read-only.
        </div>
      </div>
    );
  }

  const title =
    canManageFinanceRoles && canManageOperationalRoles
      ? 'Workforce Role Governance'
      : canManageOperationalRoles
        ? 'Operational Role Assignments'
        : 'Finance Role Assignments';

  return (
    <div className="mn-operational mn-role-workspace role-redesign" style={styles.container}>
      <PageHeader
        eyebrow="Workforce and governance"
        title={title}
        description="Prepare a governed role change. The target's current roles, effective permissions and institution scope are read from the authorized workforce directory before the change is sent."
      />

      {uncertainRole && (
        <div className="role-redesign__boundary" role="status">
          <strong>Independent role review required</strong>
          <span>
            The {uncertainRole.action} for {uncertainRole.target}, role {uncertainRole.role}, may
            have occurred. This screen cannot list current assignments. Independently inspect
            authorized workforce records, approvals and audit history. A missing record or fresh
            read cannot exclude a late commit. This local lock is lost on confirmed exit or session
            change.
          </span>
          <button
            type="button"
            onClick={() => {
              setUncertainRole(null);
              setError('');
            }}
          >
            I reviewed the role, approvals and audit history
          </button>
        </div>
      )}
      <div className="role-redesign__boundary" role="note">
        <strong>Governed access change</strong>
        <span>
          Look up the target first: its current roles, effective permissions and institution scope
          come from the authorized workforce directory. Self changes are prohibited and the server
          remains the authority on every grant or revocation.
        </span>
      </div>
      <div className="role-redesign__workspace">
        <section className="role-redesign__selectors" aria-label="Role change context">
          <p className="role-redesign__eyebrow">SELECT CONTEXT</p>
          <h2>Role and action</h2>
          <p>Choose an available role domain and action before entering the effective window.</p>
          {canManageFinanceRoles && canManageOperationalRoles && (
            <div style={styles.tabHeader} aria-label="Role governance domain">
              <button
                type="button"
                disabled={isLoading || Boolean(pendingReview) || Boolean(uncertainRole)}
                aria-pressed={domain === 'finance'}
                style={domain === 'finance' ? styles.activeTabBtn : styles.tabBtn}
                onClick={() => changeDomain('finance')}
              >
                Finance Roles
              </button>
              <button
                type="button"
                disabled={isLoading || Boolean(pendingReview) || Boolean(uncertainRole)}
                aria-pressed={domain === 'operational'}
                style={domain === 'operational' ? styles.activeTabBtn : styles.tabBtn}
                onClick={() => changeDomain('operational')}
              >
                Operational Roles
              </button>
            </div>
          )}

          <div style={styles.tabHeader} aria-label="Role assignment action">
            {canAssign && (
              <button
                type="button"
                disabled={isLoading || Boolean(pendingReview) || Boolean(uncertainRole)}
                aria-pressed={action === 'assign'}
                style={action === 'assign' ? styles.activeTabBtn : styles.tabBtn}
                onClick={() => {
                  setAction('assign');
                  setError('');
                  setSuccess(false);
                }}
              >
                {domain === 'finance' ? 'Assign Finance Role' : 'Assign Operational Role'}
              </button>
            )}
            {canRevoke && (
              <button
                type="button"
                disabled={isLoading || Boolean(pendingReview) || Boolean(uncertainRole)}
                aria-pressed={action === 'revoke'}
                style={action === 'revoke' ? styles.activeTabBtn : styles.tabBtn}
                onClick={() => {
                  setAction('revoke');
                  setError('');
                  setSuccess(false);
                }}
              >
                {domain === 'finance' ? 'Revoke Finance Role' : 'Revoke Operational Role'}
              </button>
            )}
          </div>

          <div className="role-redesign__draft-summary" aria-label="Local role change draft">
            <p className="role-redesign__eyebrow">
              {uncertainRole
                ? 'OUTCOME UNCONFIRMED · REVIEW REQUIRED'
                : isLoading
                  ? 'SUBMISSION IN PROGRESS'
                  : 'LOCAL DRAFT · NOT SUBMITTED'}
            </p>
            <h3>Change at a glance</h3>
            <dl>
              <div>
                <dt>Domain</dt>
                <dd>{domain === 'finance' ? 'Finance' : 'Operational'}</dd>
              </div>
              <div>
                <dt>Action</dt>
                <dd>{action === 'assign' ? 'Assign' : 'Revoke'}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>
                  <code>{roleKey}</code>
                </dd>
              </div>
              <div>
                <dt>Target principal</dt>
                <dd>
                  {targetPrincipalId.trim() ? (
                    <code>{targetPrincipalId.trim()}</code>
                  ) : (
                    'Not entered'
                  )}
                </dd>
              </div>
              <div>
                <dt>Effective window</dt>
                <dd>
                  {effectiveFrom && effectiveTo
                    ? 'Entered · review UTC before sending'
                    : 'Not complete'}
                </dd>
              </div>
            </dl>
            <p>
              This is your draft, not a current assignment or an approval. Verify the target
              independently.
            </p>
          </div>
        </section>
        <section className="role-redesign__form-panel" aria-label="Role change details">
          {domain === 'operational' && (
            <div style={styles.infoBox}>
              Only the six existing operational role keys are selectable. The API and database guard
              reject Finance roles and <code>SUPER_ADMIN</code> on this path. Operational assignment
              uses its existing direct-execute policy; no finance approval IDs are sent.
            </div>
          )}
          {domain === 'finance' && (
            <div style={styles.infoBox}>
              Finance role changes use the existing governed workflow: an independent{' '}
              <code>FINANCE_CONTROLLER</code> checks the request in Approvals, and the backend
              requires the resulting approval IDs for the current assignment state. This form does
              not create or infer approvals.
            </div>
          )}

          {action === 'assign' && !hasMfa && (
            <div style={styles.infoBox} role="note">
              MFA session assurance is required before submitting a role assignment.
            </div>
          )}
          {error && (
            <div style={styles.errorBox} role="alert">
              {error}
            </div>
          )}
          {success && (
            <div style={styles.successBox} role="status">
              <span>
                {domain === 'finance' ? 'Finance' : 'Operational'} role{' '}
                {action === 'assign' ? 'assigned' : 'revoked'} successfully.
              </span>
              {successDetails && (
                <div className="role-redesign__receipt">
                  Target: <code>{successDetails.target}</code> · Role:{' '}
                  <code>{successDetails.role}</code>
                </div>
              )}
            </div>
          )}

          <div style={styles.card}>
            <p className="role-redesign__eyebrow">CHANGE DETAILS</p>
            <h2 style={styles.cardTitle}>
              {action === 'assign'
                ? `Create ${domain === 'finance' ? 'Finance' : 'Operational'} Role Assignment`
                : `Revoke ${domain === 'finance' ? 'Finance' : 'Operational'} Role Assignment`}
            </h2>
            <p className="role-redesign__form-help">
              Enter the effective window in your local time; the review shows the UTC values sent to
              the service.
            </p>
            <form onSubmit={handleRoleAction} style={styles.form}>
              <div className="role-redesign__form-section">
                <div className="role-redesign__section-title">
                  <span>01</span>
                  <div>
                    <h3>Principal and entitlement</h3>
                    <p>Select the role and identify the principal from an authorized record.</p>
                  </div>
                </div>
                <div style={styles.inputGroup}>
                  <label style={styles.label} htmlFor="role-target-principal">
                    Target Principal ID (e.g. issuer:subject)
                  </label>
                  <input
                    id="role-target-principal"
                    type="text"
                    style={styles.input}
                    placeholder="e.g. https://identity.issuer:operator-sub"
                    value={targetPrincipalId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setTargetPrincipalId(value);
                      if (value.trim() !== identity.id) {
                        setIdentity({ id: '', loading: false, detail: null, problem: '' });
                      }
                    }}
                    disabled={isLoading || Boolean(pendingReview) || Boolean(uncertainRole)}
                  />
                  <div style={styles.lookupRow}>
                    <button
                      type="button"
                      style={styles.lookupButton}
                      disabled={isLoading || Boolean(pendingReview) || identity.loading}
                      onClick={() => void loadIdentity(targetPrincipalId.trim())}
                    >
                      {identity.loading ? 'Reading identity…' : 'Look up current access'}
                    </button>
                    {initialTargetPrincipalId?.trim() === targetPrincipalId.trim() &&
                    targetPrincipalId.trim() ? (
                      <span style={styles.lookupHint}>Prefilled from the workforce directory.</span>
                    ) : null}
                  </div>
                  {identity.loading ? (
                    <p style={styles.lookupMuted} data-testid="role-target-identity-loading">
                      Reading roles, effective permissions, institution restrictions and sessions
                      from the workforce directory…
                    </p>
                  ) : null}
                  {identity.problem ? (
                    <p
                      style={styles.lookupProblem}
                      role="note"
                      data-testid="role-target-identity-problem"
                    >
                      {identity.problem}
                    </p>
                  ) : null}
                  {verifiedIdentity ? (
                    <div style={styles.identityCard} data-testid="role-target-identity">
                      <p style={styles.identityTitle}>
                        Verified target · {verifiedIdentity.accountStatus}
                        {verifiedIdentity.readOnlyPrincipal ? ' · read-only principal' : ''}
                      </p>
                      <dl style={styles.identityGrid}>
                        <div>
                          <dt style={styles.identityDt}>Current roles</dt>
                          <dd style={styles.identityDd}>
                            {verifiedIdentity.roles.length === 0
                              ? 'No catalogue role assignment'
                              : verifiedIdentity.roles
                                  .map((role) => `${role.roleKey} (${role.status})`)
                                  .join(', ')}
                          </dd>
                        </div>
                        <div>
                          <dt style={styles.identityDt}>Effective permissions</dt>
                          <dd style={styles.identityDd}>
                            {verifiedIdentity.effectivePermissions.length} total ·{' '}
                            {verifiedIdentity.administrativeAuthorizations.length} administrative
                          </dd>
                        </div>
                        <div>
                          <dt style={styles.identityDt}>Institution restrictions</dt>
                          <dd style={styles.identityDd}>
                            {verifiedIdentity.institutionScope.mode === 'INSTITUTIONS'
                              ? verifiedIdentity.institutionScope.active
                                  .map(
                                    (institution) =>
                                      institution.institutionName ?? institution.institutionId,
                                  )
                                  .join(', ')
                              : 'Not scoped to any institution'}
                            {verifiedIdentity.institutionScope.revokedCount > 0
                              ? ` · ${verifiedIdentity.institutionScope.revokedCount} revoked in history`
                              : ''}
                          </dd>
                        </div>
                        <div>
                          <dt style={styles.identityDt}>Active sessions</dt>
                          <dd style={styles.identityDd}>
                            {
                              verifiedIdentity.sessions.filter(
                                (session) => session.status === 'ACTIVE',
                              ).length
                            }
                          </dd>
                        </div>
                      </dl>
                      {identityConflict ? (
                        <p style={styles.lookupProblem} role="alert">
                          {identityConflict}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div style={styles.inputGroup}>
                  <label style={styles.label} htmlFor="role-key">
                    Select Role Entitlement
                  </label>
                  <select
                    id="role-key"
                    style={styles.select}
                    value={roleKey}
                    onChange={(event) => setRoleKey(event.target.value)}
                    disabled={isLoading || Boolean(pendingReview) || Boolean(uncertainRole)}
                  >
                    {roleOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                        {domain === 'finance'
                          ? ` (${option === 'FINANCE_PREPARER' ? 'Maker' : option === 'FINANCE_CONTROLLER' ? 'Checker' : 'Read-only'})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="role-redesign__form-section">
                <div className="role-redesign__section-title">
                  <span>02</span>
                  <div>
                    <h3>Effective window</h3>
                    <p>Enter both dates in local time. The confirmation uses UTC.</p>
                  </div>
                </div>
                <div style={styles.grid}>
                  <div style={styles.inputGroup}>
                    <label style={styles.label} htmlFor="role-effective-from">
                      Effective From
                    </label>
                    <input
                      id="role-effective-from"
                      type="datetime-local"
                      style={styles.input}
                      value={effectiveFrom}
                      onChange={(event) => setEffectiveFrom(event.target.value)}
                      disabled={isLoading || Boolean(pendingReview) || Boolean(uncertainRole)}
                    />
                  </div>
                  <div style={styles.inputGroup}>
                    <label style={styles.label} htmlFor="role-effective-to">
                      Effective To
                    </label>
                    <input
                      id="role-effective-to"
                      type="datetime-local"
                      style={styles.input}
                      value={effectiveTo}
                      onChange={(event) => setEffectiveTo(event.target.value)}
                      disabled={isLoading || Boolean(pendingReview) || Boolean(uncertainRole)}
                    />
                  </div>
                </div>
              </div>
              {domain === 'finance' && (
                <div className="role-redesign__form-section">
                  <div className="role-redesign__section-title">
                    <span>03</span>
                    <div>
                      <h3>Related approvals</h3>
                      <p>
                        Provide existing approval identifiers when required by the governed
                        workflow.
                      </p>
                    </div>
                  </div>
                  <div style={styles.inputGroup}>
                    <label style={styles.label} htmlFor="role-approval-ids">
                      Related Maker-Checker Approval IDs (comma separated, when required)
                    </label>
                    <input
                      id="role-approval-ids"
                      type="text"
                      style={styles.input}
                      placeholder="e.g. UUID-1, UUID-2"
                      value={approvalIds}
                      onChange={(event) => setApprovalIds(event.target.value)}
                      disabled={isLoading || Boolean(pendingReview) || Boolean(uncertainRole)}
                    />
                  </div>
                </div>
              )}

              <button
                ref={triggerRef}
                type="submit"
                disabled={
                  isLoading ||
                  Boolean(pendingReview) ||
                  Boolean(uncertainRole) ||
                  Boolean(identityConflict) ||
                  identity.loading ||
                  (action === 'assign' ? !canAssign || !hasMfa : !canRevoke)
                }
                style={styles.submitBtn}
              >
                {isLoading
                  ? 'Executing Request…'
                  : action === 'assign'
                    ? 'Commit Role Assignment'
                    : 'Execute Revocation'}
              </button>
            </form>
          </div>
        </section>
      </div>
      {pendingReview && (
        <div className="role-redesign__overlay">
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-review-title"
            aria-describedby="role-review-description"
            tabIndex={-1}
            className="role-redesign__dialog"
          >
            <p className="role-redesign__eyebrow">REVIEW ACCESS CHANGE</p>
            <h2 id="role-review-title">
              Confirm role {pendingReview.action === 'assign' ? 'assignment' : 'revocation'}
            </h2>
            <p id="role-review-description">
              Review the principal, entitlement and effective window before sending this{' '}
              {pendingReview.domain} role change.
            </p>
            <dl>
              <div>
                <dt>Target principal</dt>
                <dd>
                  <code>{pendingReview.target}</code>
                </dd>
              </div>
              <div>
                <dt>Role entitlement</dt>
                <dd>
                  <code>{pendingReview.role}</code>
                </dd>
              </div>
              <div>
                <dt>Target&apos;s current roles (verified)</dt>
                <dd>
                  {verifiedIdentity
                    ? verifiedIdentity.roles.length
                      ? verifiedIdentity.roles
                          .map((role) => `${role.roleKey} (${role.status})`)
                          .join(', ')
                      : 'No catalogue role assignment'
                    : 'Not verified in this form'}
                </dd>
              </div>
              <div>
                <dt>Effective from (UTC)</dt>
                <dd>{pendingReview.from}</dd>
              </div>
              <div>
                <dt>Effective to (UTC)</dt>
                <dd>{pendingReview.to}</dd>
              </div>
              {pendingReview.domain === 'finance' && (
                <div>
                  <dt>Approval IDs</dt>
                  <dd>
                    {pendingReview.approvals.length
                      ? pendingReview.approvals.join(', ')
                      : 'Not provided'}
                  </dd>
                </div>
              )}
            </dl>
            <div className="role-redesign__dialog-actions">
              <Button disabled={isLoading} onClick={() => setPendingReview(null)}>
                Cancel
              </Button>
              <Button
                variant={pendingReview.action === 'revoke' ? 'danger' : 'primary'}
                disabled={isLoading}
                onClick={() => void confirmRoleAction()}
              >
                {isLoading ? 'Executing Request…' : 'Confirm role change'}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 'clamp(16px, 3vw, 32px)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: { marginBottom: '24px' },
  title: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: 'var(--mn-action-primary, #0b624a)',
    margin: '0 0 6px 0',
  },
  subtitle: { fontSize: '14px', color: 'var(--mn-text-secondary, #52655f)', margin: 0 },
  lookupRow: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' },
  lookupButton: {
    border: '1px solid #BFDBFE',
    background: '#EFF6FF',
    color: '#1E3A8A',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  lookupHint: { fontSize: 12, color: '#52655F' },
  lookupMuted: { fontSize: 12, color: '#52655F', margin: '8px 0 0' },
  lookupProblem: { fontSize: 12, color: '#8C5600', margin: '8px 0 0' },
  identityCard: {
    marginTop: 10,
    border: '1px solid #DDE7E2',
    borderRadius: 8,
    padding: 10,
    background: '#F7FAF8',
  },
  identityTitle: { margin: 0, fontSize: 12, fontWeight: 700, color: '#132B25' },
  identityGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 8,
    margin: '8px 0 0',
  },
  identityDt: {
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    color: '#52655F',
  },
  identityDd: { margin: '2px 0 0', fontSize: 12, color: '#132B25' },
  tabHeader: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
    marginBottom: '24px',
    maxWidth: '620px',
  },
  tabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--mn-text-secondary, #52655f)',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  activeTabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--mn-action-primary, #0b624a)',
    border: 'none',
    borderBottom: '2px solid var(--mn-action-primary, #0b624a)',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  infoBox: {
    backgroundColor: 'var(--mn-surface-canvas, #f5f8f6)',
    border: '1px solid #CBD5E1',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '16px',
    maxWidth: '700px',
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: '12px',
    lineHeight: '18px',
  },
  errorBox: {
    backgroundColor: 'var(--mn-status-danger-bg, #fdebe9)',
    color: '#991B1B',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    border: '1px solid var(--mn-status-danger, #b3261e)',
    maxWidth: '700px',
  },
  successBox: {
    backgroundColor: 'var(--mn-status-success-bg, #e4f4ec)',
    color: '#065F46',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    border: '1px solid var(--mn-status-success, #146348)',
    maxWidth: '700px',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
    maxWidth: '700px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
    margin: '0 0 20px 0',
    borderBottom: '1px solid var(--mn-surface-sunken, #eef3f0)',
    paddingBottom: '10px',
  },
  form: { display: 'flex', flexDirection: 'column' as const },
  inputGroup: { display: 'flex', flexDirection: 'column' as const, marginBottom: '16px' },
  label: {
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--mn-text-primary, #132b25)',
    marginBottom: '6px',
  },
  input: {
    height: '40px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '14px',
    color: 'var(--mn-text-primary, #132b25)',
  },
  select: {
    height: '40px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '14px',
    color: 'var(--mn-text-primary, #132b25)',
    backgroundColor: '#FFFFFF',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: '16px',
  },
  submitBtn: {
    backgroundColor: 'var(--mn-action-primary, #0b624a)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    alignSelf: 'flex-start',
    minWidth: 'min(100%, 220px)',
  },
};
