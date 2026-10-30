import React, { useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

type RoleDomain = 'finance' | 'operational';
type RoleAction = 'assign' | 'revoke';

const FINANCE_ROLES = ['FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'FINANCE_AUDITOR'];
const OPERATIONAL_ROLES = ['OPERATIONS', 'AGENT_NETWORK_MANAGER', 'COMPLIANCE', 'RISK_FRAUD', 'CUSTOMER_SERVICE', 'TREASURY'];

export const RoleAssignmentScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const isSuperAdmin = principal?.roles.includes('SUPER_ADMIN') === true;
  const isAdministrator = principal?.roles.includes('ADMINISTRATOR') === true;
  const canAssignFinance = isSuperAdmin && hasFn('workforce.role.assign');
  const canRevokeFinance = isSuperAdmin && hasFn('workforce.role.revoke');
  const canAssignOperational = (isAdministrator || isSuperAdmin) && hasFn('workforce.role.assign_operational');
  const canRevokeOperational = (isAdministrator || isSuperAdmin) && hasFn('workforce.role.revoke_operational');
  const canManageFinanceRoles = canAssignFinance || canRevokeFinance;
  const canManageOperationalRoles = canAssignOperational || canRevokeOperational;
  const canManageAnyRoles = canManageFinanceRoles || canManageOperationalRoles;
  const initialDomain: RoleDomain = canManageFinanceRoles ? 'finance' : 'operational';
  const initialAction: RoleAction = initialDomain === 'finance'
    ? (canAssignFinance ? 'assign' : 'revoke')
    : (canAssignOperational ? 'assign' : 'revoke');

  const [domain, setDomain] = useState<RoleDomain>(initialDomain);
  const [action, setAction] = useState<RoleAction>(initialAction);
  const [targetPrincipalId, setTargetPrincipalId] = useState('');
  const [roleKey, setRoleKey] = useState(initialDomain === 'finance' ? 'FINANCE_PREPARER' : 'OPERATIONS');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [approvalIds, setApprovalIds] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const canAssign = domain === 'finance' ? canAssignFinance : canAssignOperational;
  const canRevoke = domain === 'finance' ? canRevokeFinance : canRevokeOperational;
  const roleOptions = domain === 'finance' ? FINANCE_ROLES : OPERATIONAL_ROLES;

  const changeDomain = (nextDomain: RoleDomain) => {
    setDomain(nextDomain);
    setRoleKey(nextDomain === 'finance' ? 'FINANCE_PREPARER' : 'OPERATIONS');
    setAction(nextDomain === 'finance'
      ? (canAssignFinance ? 'assign' : 'revoke')
      : (canAssignOperational ? 'assign' : 'revoke'));
    setApprovalIds('');
    setError('');
    setSuccess(false);
  };

  const handleRoleAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((action === 'assign' && !canAssign) || (action === 'revoke' && !canRevoke)) return;
    if (!targetPrincipalId.trim()) {
      setError('Target Principal ID is required');
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

    setIsLoading(true);
    setError('');
    setSuccess(false);
    const parsedApprovalIds = domain === 'finance' && approvalIds.trim()
      ? approvalIds.split(',').map((id) => id.trim()).filter(Boolean)
      : [];

    try {
      if (action === 'assign') {
        // Existing workforce role assignment endpoint; the backend enforces the selected role's policy.
        const body = {
          targetPrincipalId: targetPrincipalId.trim(),
          roleKey,
          effectiveFrom: start.toISOString(),
          effectiveTo: end.toISOString(),
          ...(domain === 'finance' ? { approvalIds: parsedApprovalIds.length > 0 ? parsedApprovalIds : undefined } : {}),
        };
        await ApiClient.post('/internal/a2/workforce/roles', body);
      } else {
        // Existing DELETE route accepts a JSON body for the effective window and approvals.
        await ApiClient.delete(`/internal/a2/workforce/roles/${encodeURIComponent(targetPrincipalId.trim())}/${roleKey}`, {
          body: {
            effectiveFrom: start.toISOString(),
            effectiveTo: end.toISOString(),
            approvalIds: domain === 'finance' ? parsedApprovalIds : [],
          },
        });
      }
      setSuccess(true);
      setTargetPrincipalId('');
      setEffectiveFrom('');
      setEffectiveTo('');
      setApprovalIds('');
    } catch (err: any) {
      setError(err?.message || `${domain === 'finance' ? 'Finance' : 'Operational'} role ${action} failed`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!canManageAnyRoles) {
    return <div style={styles.container} role="alert"><div style={styles.errorBox}>Role governance requires an applicable workforce role function and the authorized initiator role.</div></div>;
  }

  const title = canManageFinanceRoles && canManageOperationalRoles
    ? 'Workforce Role Governance'
    : canManageOperationalRoles ? 'Operational Role Assignments' : 'Finance Role Assignments';

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>{title}</h2>
        <p style={styles.subtitle}>Use the existing workforce role assignment endpoints. Current assignment listing is not available through the V1 API.</p>
      </div>

      {(canManageFinanceRoles && canManageOperationalRoles) && (
        <div style={styles.tabHeader} aria-label="Role governance domain">
          <button type="button" style={domain === 'finance' ? styles.activeTabBtn : styles.tabBtn} onClick={() => changeDomain('finance')}>Finance Roles</button>
          <button type="button" style={domain === 'operational' ? styles.activeTabBtn : styles.tabBtn} onClick={() => changeDomain('operational')}>Operational Roles</button>
        </div>
      )}

      <div style={styles.tabHeader} aria-label="Role assignment action">
        {canAssign && <button type="button" style={action === 'assign' ? styles.activeTabBtn : styles.tabBtn} onClick={() => { setAction('assign'); setError(''); setSuccess(false); }}>
          {domain === 'finance' ? 'Assign Finance Role' : 'Assign Operational Role'}
        </button>}
        {canRevoke && <button type="button" style={action === 'revoke' ? styles.activeTabBtn : styles.tabBtn} onClick={() => { setAction('revoke'); setError(''); setSuccess(false); }}>
          {domain === 'finance' ? 'Revoke Finance Role' : 'Revoke Operational Role'}
        </button>}
      </div>

      {domain === 'operational' && <div style={styles.infoBox}>
        Only the six existing operational role keys are selectable. The API and database guard reject Finance roles and <code>SUPER_ADMIN</code> on this path. Operational assignment uses its existing direct-execute policy; no finance approval IDs are sent.
      </div>}
      {domain === 'finance' && <div style={styles.infoBox}>
        Finance role changes use the existing governed workflow. Approval IDs may be required by the backend for the current assignment state; this form does not create or infer approvals.
      </div>}

      {error && <div style={styles.errorBox} role="alert">{error}</div>}
      {success && <div style={styles.successBox} role="status">
        {domain === 'finance' ? 'Finance' : 'Operational'} role {action === 'assign' ? 'assigned' : 'revoked'} successfully.
      </div>}

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>{action === 'assign' ? `Create ${domain === 'finance' ? 'Finance' : 'Operational'} Role Assignment` : `Revoke ${domain === 'finance' ? 'Finance' : 'Operational'} Role Assignment`}</h3>
        <form onSubmit={handleRoleAction} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label} htmlFor="role-target-principal">Target Principal ID (e.g. issuer:subject)</label>
            <input id="role-target-principal" type="text" style={styles.input} placeholder="e.g. https://identity.issuer:operator-sub" value={targetPrincipalId} onChange={(event) => setTargetPrincipalId(event.target.value)} disabled={isLoading} />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label} htmlFor="role-key">Select Role Entitlement</label>
            <select id="role-key" style={styles.select} value={roleKey} onChange={(event) => setRoleKey(event.target.value)} disabled={isLoading}>
              {roleOptions.map((option) => <option key={option} value={option}>{option}{domain === 'finance' ? ` (${option === 'FINANCE_PREPARER' ? 'Maker' : option === 'FINANCE_CONTROLLER' ? 'Checker' : 'Read-only'})` : ''}</option>)}
            </select>
          </div>

          <div style={styles.grid}>
            <div style={styles.inputGroup}>
              <label style={styles.label} htmlFor="role-effective-from">Effective From</label>
              <input id="role-effective-from" type="datetime-local" style={styles.input} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} disabled={isLoading} />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label} htmlFor="role-effective-to">Effective To</label>
              <input id="role-effective-to" type="datetime-local" style={styles.input} value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} disabled={isLoading} />
            </div>
          </div>

          {domain === 'finance' && <div style={styles.inputGroup}>
            <label style={styles.label} htmlFor="role-approval-ids">Related Maker-Checker Approval IDs (comma separated, when required)</label>
            <input id="role-approval-ids" type="text" style={styles.input} placeholder="e.g. UUID-1, UUID-2" value={approvalIds} onChange={(event) => setApprovalIds(event.target.value)} disabled={isLoading} />
          </div>}

          <button type="submit" disabled={isLoading || (action === 'assign' ? !canAssign : !canRevoke)} style={styles.submitBtn}>
            {isLoading ? 'Executing Request…' : action === 'assign' ? 'Commit Role Assignment' : 'Execute Revocation'}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  container: { padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { marginBottom: '24px' },
  title: { fontSize: '22px', fontWeight: 'bold', color: '#0A3D25', margin: '0 0 6px 0' },
  subtitle: { fontSize: '14px', color: '#64748B', margin: 0 },
  tabHeader: { display: 'flex', borderBottom: '1px solid #E2E8F0', marginBottom: '24px', maxWidth: '620px' },
  tabBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: '500', color: '#64748B', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' },
  activeTabBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: '600', color: '#0A3D25', border: 'none', borderBottom: '2px solid #0A3D25', backgroundColor: 'transparent', cursor: 'pointer' },
  infoBox: { backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '12px', marginBottom: '16px', maxWidth: '700px', color: '#475569', fontSize: '12px', lineHeight: '18px' },
  errorBox: { backgroundColor: '#FEE2E2', color: '#991B1B', fontSize: '13px', fontWeight: '500', padding: '12px', borderRadius: '6px', marginBottom: '20px', border: '1px solid #EF4444', maxWidth: '700px' },
  successBox: { backgroundColor: '#D1FAE5', color: '#065F46', fontSize: '13px', fontWeight: '500', padding: '12px', borderRadius: '6px', marginBottom: '20px', border: '1px solid #10B981', maxWidth: '700px' },
  card: { backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '24px', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)', maxWidth: '700px' },
  cardTitle: { fontSize: '16px', fontWeight: 'bold', color: '#1E293B', margin: '0 0 20px 0', borderBottom: '1px solid #F1F5F9', paddingBottom: '10px' },
  form: { display: 'flex', flexDirection: 'column' as const },
  inputGroup: { display: 'flex', flexDirection: 'column' as const, marginBottom: '16px' },
  label: { fontSize: '13px', fontWeight: '500', color: '#334155', marginBottom: '6px' },
  input: { height: '40px', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '0 12px', fontSize: '14px', color: '#1E293B' },
  select: { height: '40px', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '0 12px', fontSize: '14px', color: '#1E293B', backgroundColor: '#FFFFFF' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  submitBtn: { backgroundColor: '#0A3D25', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', alignSelf: 'flex-start', minWidth: '220px' },
};
