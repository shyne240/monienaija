import React, { useState } from 'react';
import { ApiClient } from '../../services/api-client';

export const RoleAssignmentScreen: React.FC = () => {
  const [targetPrincipalId, setTargetPrincipalId] = useState('');
  const [roleKey, setRoleKey] = useState('FINANCE_PREPARER');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [approvalIds, setApprovalIds] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [action, setAction] = useState<'assign' | 'revoke'>('assign');

  const handleRoleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPrincipalId.trim()) {
      setError('Target Principal ID is required');
      return;
    }
    if (!effectiveFrom.trim() || !effectiveTo.trim()) {
      setError('Effective window dates are required');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess(false);

    const parsedApprovalIds = approvalIds.trim()
      ? approvalIds.split(',').map((id) => id.trim())
      : [];

    try {
      if (action === 'assign') {
        // POST /internal/a2/workforce/roles
        await ApiClient.post('/internal/a2/workforce/roles', {
          targetPrincipalId: targetPrincipalId.trim(),
          roleKey,
          effectiveFrom: new Date(effectiveFrom).toISOString(),
          effectiveTo: new Date(effectiveTo).toISOString(),
          approvalIds: parsedApprovalIds.length > 0 ? parsedApprovalIds : undefined,
        });
        setSuccess(true);
      } else {
        // DELETE /internal/a2/workforce/roles/:principalId/:roleKey
        await ApiClient.delete(`/internal/a2/workforce/roles/${targetPrincipalId.trim()}/${roleKey}`, {
          body: {
            effectiveFrom: new Date(effectiveFrom).toISOString(),
            effectiveTo: new Date(effectiveTo).toISOString(),
            approvalIds: parsedApprovalIds,
          },
        });
        setSuccess(true);
      }
      setTargetPrincipalId('');
      setEffectiveFrom('');
      setEffectiveTo('');
      setApprovalIds('');
    } catch (err: any) {
      setError(err?.message || 'Finance Role Action failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Finance Role Administration</h2>
        <p style={styles.subtitle}>Manage operator, preparer, controller, and auditor role entitlements</p>
      </div>

      <div style={styles.tabHeader}>
        <button
          style={action === 'assign' ? styles.activeTabBtn : styles.tabBtn}
          onClick={() => { setAction('assign'); setError(''); setSuccess(false); }}
        >
          Assign Role Entitlement
        </button>
        <button
          style={action === 'revoke' ? styles.activeTabBtn : styles.tabBtn}
          onClick={() => { setAction('revoke'); setError(''); setSuccess(false); }}
        >
          Revoke Role Entitlement
        </button>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}
      {success && (
        <div style={styles.successBox}>
          Finance Role {action === 'assign' ? 'assigned' : 'revoked'} successfully!
        </div>
      )}

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>
          {action === 'assign' ? 'Create New Role Assignment' : 'Terminate Existing Role Assignment'}
        </h3>
        <form onSubmit={handleRoleAction} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Target Principal ID (e.g. issuer:subject)</label>
            <input
              type="text"
              style={styles.input}
              placeholder="e.g. https://identity.issuer:operator-sub"
              value={targetPrincipalId}
              onChange={(e) => setTargetPrincipalId(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Select Role Entitlement</label>
            <select
              style={styles.select}
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value)}
              disabled={isLoading}
            >
              <option value="FINANCE_PREPARER">FINANCE_PREPARER (Maker)</option>
              <option value="FINANCE_CONTROLLER">FINANCE_CONTROLLER (Checker)</option>
              <option value="FINANCE_AUDITOR">FINANCE_AUDITOR (Read-only)</option>
            </select>
          </div>

          <div style={styles.grid}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Effective From</label>
              <input
                type="datetime-local"
                style={styles.input}
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Effective To</label>
              <input
                type="datetime-local"
                style={styles.input}
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Related Maker-Checker Approval IDs (Comma separated UUIDs, if required)</label>
            <input
              type="text"
              style={styles.input}
              placeholder="e.g. UUID-1, UUID-2"
              value={approvalIds}
              onChange={(e) => setApprovalIds(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={styles.submitBtn}
          >
            {isLoading ? 'Executing Request...' : action === 'assign' ? 'Commit Role Assignment' : 'Execute Revocation'}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  container: {
    padding: '24px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: 0,
  },
  tabHeader: {
    display: 'flex',
    borderBottom: '1px solid #E2E8F0',
    marginBottom: '24px',
    maxWidth: '600px',
  },
  tabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#64748B',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  activeTabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#0A3D25',
    border: 'none',
    borderBottom: '2px solid #0A3D25',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    color: '#EF4444',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#EF4444',
    maxWidth: '600px',
  },
  successBox: {
    backgroundColor: '#D1FAE5',
    color: '#10B981',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#10B981',
    maxWidth: '600px',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
    maxWidth: '600px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1E293B',
    margin: '0 0 20px 0',
    borderBottom: '1px solid #F1F5F9',
    paddingBottom: '10px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    marginBottom: '16px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#334155',
    marginBottom: '6px',
  },
  input: {
    height: '40px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '14px',
    color: '#1E293B',
  },
  select: {
    height: '40px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '14px',
    color: '#1E293B',
    backgroundColor: '#FFFFFF',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  submitBtn: {
    backgroundColor: '#0A3D25',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    alignSelf: 'flex-start',
    minWidth: '220px',
  },
};
