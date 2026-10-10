import React, { useCallback, useEffect, useState } from 'react';
import { ApiClient, ApiError } from '../../services/api-client';
import type {
  DashboardTemplateSummary,
  RoleDashboardAssignmentSummary,
  WidgetRegistryEntry,
} from '../../components/dashboard/types';

const DASH = '/internal/a2/workforce/dashboard';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02
 *
 * The real dashboard-configuration surface for authorized administrators. Backed entirely by the
 * three real, already-authorized backend endpoints:
 *   - `GET  /internal/a2/workforce/dashboard/templates`     (requires workforce.dashboard.view)
 *   - `GET  /internal/a2/workforce/dashboard/assignments`   (requires workforce.dashboard.view)
 *   - `PUT  /internal/a2/workforce/dashboard/assignments/:roleKey` (requires workforce.dashboard.assign)
 *
 * This screen intentionally does NOT expose template creation, widget editing, or widget-layout
 * reordering — the backend has no endpoint for any of those (see
 * docs/V1/V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01-REPORT.md "Known limitations"), and adding
 * a control that implied otherwise would misrepresent what this release actually persists.
 * Templates are shown read-only (including their widget list, cross-referenced against the
 * widget registry for human-readable names); the only mutation offered is the one the backend
 * genuinely supports — changing which existing, active template a role is assigned to. This is
 * also the concrete proof, in the UI, that a brand-new role could be pointed at any existing
 * template with zero source-code change: the dropdown below lists every existing template, for
 * every role returned by the backend.
 *
 * No authorization rule is re-implemented or weakened here: every request goes through the same
 * backend checks as any other caller, and a 401/403 is shown exactly as returned — this screen
 * never decides on its own that a user may or may not configure dashboards.
 */
export const DashboardSettingsScreen: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [templates, setTemplates] = useState<DashboardTemplateSummary[]>([]);
  const [assignments, setAssignments] = useState<RoleDashboardAssignmentSummary[]>([]);
  const [registry, setRegistry] = useState<WidgetRegistryEntry[]>([]);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  // Per-role in-flight edit state
  const [pendingTemplateByRole, setPendingTemplateByRole] = useState<Record<string, string>>({});
  const [reasonByRole, setReasonByRole] = useState<Record<string, string>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [feedbackByRole, setFeedbackByRole] = useState<Record<string, { kind: 'success' | 'error'; message: string }>>({});

  const load = useCallback(async () => {
    setState('loading');
    setErrorMessage('');
    try {
      const [templatesRes, assignmentsRes, registryRes] = await Promise.all([
        ApiClient.get<DashboardTemplateSummary[]>(`${DASH}/templates`),
        ApiClient.get<RoleDashboardAssignmentSummary[]>(`${DASH}/assignments`),
        ApiClient.get<WidgetRegistryEntry[]>(`${DASH}/widget-registry`),
      ]);
      setTemplates(Array.isArray(templatesRes) ? templatesRes : []);
      setAssignments(Array.isArray(assignmentsRes) ? assignmentsRes : []);
      setRegistry(Array.isArray(registryRes) ? registryRes : []);
      setState('ready');
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setState('forbidden');
      } else {
        setState('error');
        setErrorMessage(err?.message || 'Failed to load dashboard configuration.');
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const widgetName = (widgetKey: string) => registry.find((w) => w.widgetKey === widgetKey)?.displayName || widgetKey;
  const activeTemplates = templates.filter((t) => t.isActive);

  const handleSave = async (roleKey: string) => {
    const templateKey = pendingTemplateByRole[roleKey];
    if (!templateKey) {
      setFeedbackByRole((prev) => ({ ...prev, [roleKey]: { kind: 'error', message: 'Choose a template first.' } }));
      return;
    }
    setSavingRole(roleKey);
    setFeedbackByRole((prev) => {
      const next = { ...prev };
      delete next[roleKey];
      return next;
    });
    try {
      const saved = await ApiClient.put<RoleDashboardAssignmentSummary>(`${DASH}/assignments/${encodeURIComponent(roleKey)}`, {
        templateKey,
        reason: reasonByRole[roleKey]?.trim() || undefined,
      });
      setAssignments((prev) => {
        const withoutRole = prev.filter((a) => a.roleKey !== roleKey);
        return [...withoutRole, saved].sort((a, b) => a.roleKey.localeCompare(b.roleKey));
      });
      setFeedbackByRole((prev) => ({ ...prev, [roleKey]: { kind: 'success', message: `Dashboard for ${roleKey} is now ${templateKey}.` } }));
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : err?.message || 'Failed to save assignment.';
      setFeedbackByRole((prev) => ({ ...prev, [roleKey]: { kind: 'error', message } }));
    } finally {
      setSavingRole(null);
    }
  };

  if (state === 'loading') {
    return (
      <div style={styles.container}>
        <div style={styles.stateBox}>
          <div style={styles.spinner} />
          <span>Loading dashboard configuration…</span>
        </div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Dashboard Settings</h2>
        </div>
        <div style={styles.forbiddenBox}>
          🔒 You do not have permission to view or change dashboard configuration. This requires the{' '}
          <code style={styles.code}>workforce.dashboard.view</code> function (SUPER_ADMIN/ADMINISTRATOR by default).
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Dashboard Settings</h2>
        </div>
        <div style={styles.errorBox}>⚠️ {errorMessage}</div>
        <button style={styles.retryBtn} onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Dashboard Settings</h2>
        <p style={styles.subtitle}>
          Assign which dashboard template each role displays. Assigning a template never grants or changes any permission — it only
          changes which widgets that role's dashboard shows.
        </p>
      </div>

      <h3 style={styles.sectionHeader}>Dashboard Templates ({templates.length})</h3>
      <p style={styles.note}>
        Templates are read-only in this release — only the role → template assignment below can be changed. Creating or editing a
        template's widget list requires a source change (see the task report).
      </p>
      <div style={styles.templateList}>
        {templates.map((t) => (
          <div key={t.templateKey} style={styles.templateRow}>
            <div style={styles.templateHeaderRow} onClick={() => setExpandedTemplate(expandedTemplate === t.templateKey ? null : t.templateKey)}>
              <div>
                <span style={styles.templateKey}>{t.templateKey}</span>
                <span style={styles.templateDisplayName}>{t.displayName}</span>
              </div>
              <div style={styles.templateMeta}>
                <span style={t.isActive ? styles.activeBadge : styles.inactiveBadge}>{t.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
                <span style={styles.widgetCount}>{t.layout?.widgets?.length ?? 0} widgets</span>
                <span style={styles.expandIcon}>{expandedTemplate === t.templateKey ? '▲' : '▼'}</span>
              </div>
            </div>
            {expandedTemplate === t.templateKey && (
              <div style={styles.templateDetail}>
                <p style={styles.templateDescription}>{t.description}</p>
                <ul style={styles.widgetList}>
                  {(t.layout?.widgets ?? [])
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((w) => (
                      <li key={w.widgetKey} style={styles.widgetListItem}>
                        {w.title || widgetName(w.widgetKey)} <span style={styles.widgetKeyLabel}>({w.widgetKey})</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      <h3 style={styles.sectionHeader}>Role → Dashboard Assignment ({assignments.length})</h3>
      <div style={styles.assignmentTableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Current Template</th>
              <th style={styles.th}>Change To</th>
              <th style={styles.th}>Reason</th>
              <th style={styles.th} />
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => {
              const feedback = feedbackByRole[a.roleKey];
              return (
                <tr key={a.roleKey}>
                  <td style={styles.td}>
                    <strong>{a.roleKey}</strong>
                  </td>
                  <td style={styles.td}>{a.templateKey}</td>
                  <td style={styles.td}>
                    <select
                      style={styles.select}
                      value={pendingTemplateByRole[a.roleKey] ?? a.templateKey}
                      onChange={(e) => setPendingTemplateByRole((prev) => ({ ...prev, [a.roleKey]: e.target.value }))}
                    >
                      {activeTemplates.map((t) => (
                        <option key={t.templateKey} value={t.templateKey}>
                          {t.templateKey}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <input
                      style={styles.reasonInput}
                      type="text"
                      placeholder="Reason for this change (optional)"
                      value={reasonByRole[a.roleKey] ?? ''}
                      onChange={(e) => setReasonByRole((prev) => ({ ...prev, [a.roleKey]: e.target.value }))}
                    />
                  </td>
                  <td style={styles.td}>
                    <button
                      style={styles.saveBtn}
                      disabled={savingRole === a.roleKey || (pendingTemplateByRole[a.roleKey] ?? a.templateKey) === a.templateKey}
                      onClick={() => handleSave(a.roleKey)}
                    >
                      {savingRole === a.roleKey ? 'Saving…' : 'Save'}
                    </button>
                    {feedback && (
                      <div style={feedback.kind === 'success' ? styles.rowSuccess : styles.rowError}>{feedback.message}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    margin: 0,
    maxWidth: 720,
  },
  note: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 16,
    maxWidth: 720,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '24px 0 12px 0',
  },
  templateList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  templateRow: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 8,
  },
  templateHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    cursor: 'pointer',
  },
  templateKey: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: 700,
    color: '#0A3D25',
    marginRight: 10,
  },
  templateDisplayName: {
    fontSize: 13,
    color: '#334155',
  },
  templateMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  activeBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#10B981',
    backgroundColor: '#D1FAE5',
    padding: '2px 8px',
    borderRadius: 10,
  },
  inactiveBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#94A3B8',
    backgroundColor: '#F1F5F9',
    padding: '2px 8px',
    borderRadius: 10,
  },
  widgetCount: {
    fontSize: 11,
    color: '#64748B',
  },
  expandIcon: {
    fontSize: 10,
    color: '#94A3B8',
  },
  templateDetail: {
    borderTop: '1px solid #F1F5F9',
    padding: '12px 16px',
  },
  templateDescription: {
    fontSize: 12,
    color: '#64748B',
    margin: '0 0 10px 0',
  },
  widgetList: {
    listStyle: 'disc',
    margin: 0,
    paddingLeft: 18,
    fontSize: 12,
    color: '#334155',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  widgetListItem: {},
  widgetKeyLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#94A3B8',
  },
  assignmentTableWrap: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 8,
    padding: 12,
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '2px solid #E2E8F0',
    color: '#64748B',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  td: {
    padding: '10px',
    borderBottom: '1px solid #F1F5F9',
    verticalAlign: 'top',
  },
  select: {
    height: 32,
    border: '1px solid #E2E8F0',
    borderRadius: 6,
    padding: '0 8px',
    fontSize: 12,
    minWidth: 220,
  },
  reasonInput: {
    height: 32,
    border: '1px solid #E2E8F0',
    borderRadius: 6,
    padding: '0 8px',
    fontSize: 12,
    minWidth: 220,
  },
  saveBtn: {
    backgroundColor: '#0A3D25',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 6,
    padding: '8px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    minWidth: 80,
  },
  rowSuccess: {
    marginTop: 6,
    fontSize: 11,
    color: '#10B981',
    maxWidth: 220,
  },
  rowError: {
    marginTop: 6,
    fontSize: 11,
    color: '#EF4444',
    maxWidth: 220,
  },
  stateBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: '#64748B',
    fontSize: 13,
  },
  spinner: {
    width: 16,
    height: 16,
    border: '2px solid #E2E8F0',
    borderTop: '2px solid #0A3D25',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  forbiddenBox: {
    backgroundColor: '#F1F5F9',
    color: '#64748B',
    fontSize: 13,
    padding: 16,
    borderRadius: 8,
    maxWidth: 640,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    color: '#EF4444',
    fontSize: 13,
    fontWeight: 500,
    padding: 12,
    borderRadius: 6,
    border: '1px solid #EF4444',
    maxWidth: 640,
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: '#0A3D25',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 6,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  code: {
    fontFamily: 'monospace',
    backgroundColor: '#E2E8F0',
    padding: '1px 5px',
    borderRadius: 4,
  },
};
