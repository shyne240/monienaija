import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader, ScrollRegion } from '../../design-system/primitives';
import './operational-surfaces.css';
import './dashboard-settings-workspace.css';
import { ApiClient, ApiError } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
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
 * The UI gates actions by session scopes and read-only context; the backend remains authoritative
 * and applies its own checks. A failed or unconfirmed write is not displayed as successful.
 */
export const DashboardSettingsScreen: React.FC<{onDashboardGuardChange?: (guarded: boolean, busy: boolean) => void}> = ({onDashboardGuardChange}) => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <DashboardSettingsWorkspace key={key} onDashboardGuardChange={onDashboardGuardChange} />;
};

const DashboardSettingsWorkspace: React.FC<{onDashboardGuardChange?: (guarded: boolean, busy: boolean) => void}> = ({onDashboardGuardChange}) => {
  const { principal } = useAuthStore();
  const generation = useRef(0);
  const savingRef = useRef(false);
  useEffect(() => () => { generation.current += 1; }, []);
  const canView = principal?.scopes.includes('workforce.dashboard.view') ?? false;
  const canAssign = Boolean(principal?.scopes.includes('workforce.dashboard.assign') && !principal?.readOnlyPrincipal);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [templates, setTemplates] = useState<DashboardTemplateSummary[]>([]);
  const [assignments, setAssignments] = useState<RoleDashboardAssignmentSummary[]>([]);
  const [registry, setRegistry] = useState<WidgetRegistryEntry[]>([]);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');

  // Per-role in-flight edit state
  const [pendingTemplateByRole, setPendingTemplateByRole] = useState<Record<string, string>>({});
  const [reasonByRole, setReasonByRole] = useState<Record<string, string>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [needsReview, setNeedsReview] = useState<Record<string, 'refresh' | 'ack'>>({});
  const [uncertainRoles, setUncertainRoles] = useState<Record<string, true>>({});
  const drafts = useRef({templates: pendingTemplateByRole, reasons: reasonByRole});
  drafts.current = {templates: pendingTemplateByRole, reasons: reasonByRole};
  const [confirmRole, setConfirmRole] = useState<string | null>(null);
  const guard = Boolean(savingRole || confirmRole || Object.keys(needsReview).length || Object.keys(uncertainRoles).length || Object.keys(pendingTemplateByRole).length || Object.values(reasonByRole).some(value => value.trim()));
  useEffect(() => { onDashboardGuardChange?.(guard, Boolean(savingRole)); }, [onDashboardGuardChange, guard, savingRole]);
  useEffect(() => () => onDashboardGuardChange?.(false, false), [onDashboardGuardChange]);
  useEffect(() => {
    if (!guard) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [guard]);

  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const saveButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const returnToRole = useRef<string | null>(null);
  useEffect(() => {
    if (confirmRole) confirmCancelRef.current?.focus();
    else if (returnToRole.current) { saveButtons.current[returnToRole.current]?.focus(); returnToRole.current = null; }
  }, [confirmRole]);
  const [feedbackByRole, setFeedbackByRole] = useState<Record<string, { kind: 'success' | 'error'; message: string }>>({});

  const load = useCallback(async () => {
    if (savingRef.current) return;
    const request = ++generation.current;
    setState('loading');
    setErrorMessage('');
    try {
      const [templatesRes, assignmentsRes, registryRes] = await Promise.all([
        ApiClient.get<DashboardTemplateSummary[]>(`${DASH}/templates`),
        ApiClient.get<RoleDashboardAssignmentSummary[]>(`${DASH}/assignments`),
        ApiClient.get<WidgetRegistryEntry[]>(`${DASH}/widget-registry`),
      ]);
      if (!Array.isArray(templatesRes) || templatesRes.some(t => !t || typeof t.templateKey !== 'string' || !t.templateKey.trim() || typeof t.displayName !== 'string' || typeof t.isActive !== 'boolean' || !t.layout || !Array.isArray(t.layout.widgets) || t.layout.widgets.some(w => !w || typeof w.widgetKey !== 'string' || typeof w.order !== 'number')) ||
          !Array.isArray(assignmentsRes) || assignmentsRes.some(a => !a || typeof a.id !== 'string' || !a.id.trim() || typeof a.roleKey !== 'string' || !a.roleKey.trim() || typeof a.templateKey !== 'string' || !a.templateKey.trim()) ||
          !Array.isArray(registryRes) || registryRes.some(w => !w || typeof w.widgetKey !== 'string' || typeof w.displayName !== 'string') ||
          new Set(assignmentsRes.map(a => a.roleKey)).size !== assignmentsRes.length || new Set(templatesRes.map(t => t.templateKey)).size !== templatesRes.length) {
        throw new Error('Invalid dashboard configuration response.');
      }
      if (request !== generation.current) return;
      setTemplates(templatesRes);
      setAssignments(assignmentsRes);
      setRegistry(registryRes);
      setNeedsReview(prev => {
        const next: Record<string, 'ack'> = {};
        for (const role of new Set([...Object.keys(prev), ...Object.keys(drafts.current.templates), ...Object.keys(drafts.current.reasons)])) next[role] = 'ack';
        return next;
      });
      setFeedbackByRole({});
      setState('ready');
    } catch (err: any) {
      if (request !== generation.current) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setState('forbidden');
      } else {
        setState('error');
        setErrorMessage(err?.message || 'Failed to load dashboard configuration.');
      }
    }
  }, []);

  useEffect(() => {
    if (canView) load();
    else setState('forbidden');
  }, [load, canView]);

  const widgetName = (widgetKey: string) => registry.find((w) => w.widgetKey === widgetKey)?.displayName || widgetKey;
  const activeTemplates = templates.filter((t) => t.isActive);
  const templateQuery = templateSearch.trim().toLowerCase();
  const visibleTemplates = templates.filter(t => !templateQuery || [t.templateKey, t.displayName, t.description ?? ''].some(value => value.toLowerCase().includes(templateQuery))); 

  const handleSave = async (roleKey: string) => {
    if (!canView || !canAssign || savingRef.current || needsReview[roleKey] || confirmRole !== roleKey) return;
    const current = assignments.find(a => a.roleKey === roleKey);
    const templateKey = pendingTemplateByRole[roleKey];
    if (!current || !templateKey || !activeTemplates.some(t => t.templateKey === templateKey)) {
      setFeedbackByRole((prev) => ({ ...prev, [roleKey]: { kind: 'error', message: 'Choose a template first.' } }));
      return;
    }
    setConfirmRole(null);
    const request = ++generation.current;
    savingRef.current = true;
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
      if (request !== generation.current) return;
      if (!saved || saved.id !== current.id || saved.roleKey !== roleKey || saved.templateKey !== templateKey || saved.assignedBy !== principal?.principalId || typeof saved.assignedAt !== 'string' || !Number.isFinite(Date.parse(saved.assignedAt))) throw new Error('Unconfirmed assignment receipt.');
      setPendingTemplateByRole(prev => { const next = { ...prev }; delete next[roleKey]; return next; });
      setReasonByRole(prev => { const next = { ...prev }; delete next[roleKey]; return next; });
      setAssignments((prev) => {
        const withoutRole = prev.filter((a) => a.roleKey !== roleKey);
        return [...withoutRole, saved].sort((a, b) => a.roleKey.localeCompare(b.roleKey));
      });
      setFeedbackByRole((prev) => ({ ...prev, [roleKey]: { kind: 'success', message: `Dashboard for ${roleKey} is now ${templateKey}.` } }));
    } catch (err: any) {
      if (request !== generation.current) return;
      const rejected = err instanceof ApiError && [400, 401, 403, 404, 422].includes(err.status);
      const message = rejected ? err.message : 'The assignment outcome could not be confirmed. Reload configuration and review the current assignment before retrying.';
      if (!rejected) { setNeedsReview(prev => ({ ...prev, [roleKey]: 'refresh' })); setUncertainRoles(prev => ({...prev, [roleKey]: true})); }
      setFeedbackByRole((prev) => ({ ...prev, [roleKey]: { kind: 'error', message } }));
    } finally {
      if (request === generation.current) { savingRef.current = false; setSavingRole(null); }
    }
  };

  if (state === 'loading') {
    return (
      <div className="mn-operational" style={styles.container}>
        <div style={styles.stateBox} role="status">
          <div style={styles.spinner} />
          <span>Loading dashboard configuration…</span>
        </div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="mn-operational" style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Dashboard Settings</h2>
        </div>
        <div style={styles.forbiddenBox} role="alert">
          🔒 You do not have permission to view dashboard configuration. This requires the{' '}
          <code style={styles.code}>workforce.dashboard.view</code> function.
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="mn-operational" style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Dashboard Settings</h2>
        </div>
        <div style={styles.errorBox} role="alert">⚠️ {errorMessage}</div>
        <button type="button" style={styles.retryBtn} onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mn-operational mn-dashboard-settings" style={styles.container}>
      <div style={styles.header}>
        <PageHeader eyebrow="WORKFORCE CONFIGURATION" title="Dashboard Settings" description="Review templates and role assignments." />
        <p style={styles.subtitle}>
          Assign which dashboard template each role displays. Assigning a template never grants or changes any permission — it only
          changes which widgets that role's dashboard shows.
        </p>
        <p style={styles.note}>Changes and outcome safeguards are local to this workspace and are lost on navigation, browser refresh or session change. Assignments do not use an optimistic version. Reload and independently review the current assignment and audit history before making changes; another operator may change it concurrently, and a fresh read cannot exclude a late commit.</p>
        <button type="button" style={styles.retryBtn} disabled={savingRole !== null || confirmRole !== null} onClick={() => void load()}>Reload configuration</button>
      </div>

      <nav className="mn-dashboard-settings__nav" aria-label="Dashboard settings sections"><a href="#dashboard-template-catalogue">Template catalogue</a><a href="#dashboard-role-assignments">Role assignments</a></nav>
      <section id="dashboard-template-catalogue" tabIndex={-1} className="mn-dashboard-settings__panel" aria-label="Dashboard templates">
      <p className="mn-dashboard-settings__eyebrow">TEMPLATE CATALOGUE</p>
      <h2 style={styles.sectionHeader}>Dashboard Templates ({templates.length})</h2>
      <p style={styles.note}>
        Templates are read-only in this release — only the role → template assignment below can be changed. Creating or editing a
        template's widget list requires a source change (see the task report).
      </p>
      <div className="mn-dashboard-settings__filter"><label>Search loaded templates<input type="search" value={templateSearch} onChange={event => setTemplateSearch(event.target.value)} placeholder="Name or template key" /></label><button type="button" disabled={!templateSearch} onClick={() => setTemplateSearch('')}>Clear search</button></div>
      <p className="mn-dashboard-settings__count" role="status">Showing {visibleTemplates.length} of {templates.length} loaded templates. Assignment choices are not filtered.</p>
      <div style={styles.templateList}>
        {visibleTemplates.length === 0 && <p className="mn-dashboard-settings__empty">{templates.length ? 'No loaded templates match this search.' : 'No dashboard templates were returned.'}</p>}
        {visibleTemplates.map((t) => (
          <div key={t.templateKey} style={styles.templateRow}>
            <button type="button" className="mn-dashboard-settings__template-header" style={styles.templateHeaderRow} aria-expanded={expandedTemplate === t.templateKey} onClick={() => setExpandedTemplate(expandedTemplate === t.templateKey ? null : t.templateKey)}>
              <div>
                <span style={styles.templateKey}>{t.templateKey}</span>{' '}
                <span style={styles.templateDisplayName}>{t.displayName}</span>
              </div>
              <div style={styles.templateMeta}>
                <span style={t.isActive ? styles.activeBadge : styles.inactiveBadge}>{t.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
                <span style={styles.widgetCount}>{t.layout.widgets.length} {t.layout.widgets.length === 1 ? 'widget' : 'widgets'}</span>
                <span aria-hidden="true" style={styles.expandIcon}>{expandedTemplate === t.templateKey ? '▲' : '▼'}</span>
              </div>
            </button>
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

      </section>
      <section id="dashboard-role-assignments" tabIndex={-1} className="mn-dashboard-settings__panel" aria-label="Role dashboard assignments">
      <p className="mn-dashboard-settings__eyebrow">ROLE CONFIGURATION</p>
      <h2 style={styles.sectionHeader}>Role → Dashboard Assignment ({assignments.length})</h2>
      {!canAssign && <p role="note">Assignment controls are unavailable for this session.</p>}
      {Object.keys(needsReview).filter(role => !assignments.some(a => a.roleKey === role)).map(role => <div role="alert" key={role}>The refreshed configuration does not contain {role}; its local draft cannot be submitted. {uncertainRoles[role] && 'A missing role does not prove the action failed or exclude a late commit. Independently inspect assignment and audit history before clearing this local review.'} <button type="button" onClick={() => { if (uncertainRoles[role] && !window.confirm(`Acknowledge independent ${role} assignment and audit review and discard this local draft? The action may have occurred.`)) return; setPendingTemplateByRole(prev => {const next={...prev}; delete next[role]; return next;}); setReasonByRole(prev => {const next={...prev}; delete next[role]; return next;}); setNeedsReview(prev => {const next={...prev}; delete next[role]; return next;}); setUncertainRoles(prev => {const next={...prev}; delete next[role]; return next;}); }}>{uncertainRoles[role] ? `I reviewed ${role} and discard draft` : `Discard ${role} draft`}</button></div>)}
      <ScrollRegion label="Role dashboard assignments" hint="Scroll horizontally to view all assignment controls.">
        <div style={styles.assignmentTableWrap}><table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Current Template</th>
              {canAssign && <>
                <th style={styles.th}>Change To</th>
                <th style={styles.th}>Reason</th>
                <th style={styles.th} />
              </>}
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
                  {canAssign && <>
                    <td style={styles.td}>
                      <select
                        style={styles.select}
                        aria-label={`Dashboard template for ${a.roleKey}`}
                        disabled={savingRole !== null || confirmRole !== null || !!needsReview[a.roleKey]}
                        value={pendingTemplateByRole[a.roleKey] ?? a.templateKey}
                        onChange={(e) => setPendingTemplateByRole((prev) => ({ ...prev, [a.roleKey]: e.target.value }))}
                      >
                        {!activeTemplates.some(t => t.templateKey === a.templateKey) && <option value={a.templateKey} disabled>{a.templateKey} (not active)</option>}
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
                        aria-label={`Reason for ${a.roleKey} dashboard change`}
                        type="text"
                        disabled={savingRole !== null || confirmRole !== null || !!needsReview[a.roleKey]}
                        maxLength={500}
                        placeholder="Reason for this change (optional)"
                        value={reasonByRole[a.roleKey] ?? ''}
                        onChange={(e) => setReasonByRole((prev) => ({ ...prev, [a.roleKey]: e.target.value }))}
                      />
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        aria-label={`Save dashboard assignment for ${a.roleKey}`}
                        ref={element => { saveButtons.current[a.roleKey] = element; }}
                        style={styles.saveBtn}
                        disabled={savingRole !== null || confirmRole !== null || !!needsReview[a.roleKey] || (pendingTemplateByRole[a.roleKey] ?? a.templateKey) === a.templateKey}
                        onClick={() => setConfirmRole(a.roleKey)}
                      >
                        {savingRole === a.roleKey ? 'Saving…' : 'Save'}
                      </button>
                      {needsReview[a.roleKey] && <div role="status" className="mn-dashboard-settings__review">{needsReview[a.roleKey] === 'refresh' ? 'Reload configuration before reviewing this unconfirmed outcome.' : 'Independently review the current assignment, audit history and your retained draft. A fresh read does not exclude a late commit or prevent concurrent changes.'}{needsReview[a.roleKey] === 'ack' && <div><button type="button" onClick={() => { setNeedsReview(prev => {const next={...prev}; delete next[a.roleKey]; return next;}); setUncertainRoles(prev => {const next={...prev}; delete next[a.roleKey]; return next;}); }}>I reviewed {a.roleKey}</button></div>}</div>}
                      {feedback && (
                        <div role={feedback.kind === 'success' ? 'status' : 'alert'} style={feedback.kind === 'success' ? styles.rowSuccess : styles.rowError}>{feedback.message}</div>
                      )}
                    </td>
                  </>}
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </ScrollRegion>
      {confirmRole && <div role="group" aria-label={`Confirm assignment for ${confirmRole}`} className="mn-dashboard-settings__review">
        <p>Change {confirmRole} from {assignments.find(a => a.roleKey === confirmRole)?.templateKey} to {pendingTemplateByRole[confirmRole]}.</p>
        <p>Reason: {reasonByRole[confirmRole]?.trim() || 'Not provided'}</p>
        <button ref={confirmCancelRef} type="button" onClick={() => { returnToRole.current = confirmRole; setConfirmRole(null); }}>Keep editing</button>{' '}
        <button type="button" onClick={() => void handleSave(confirmRole)}>Confirm assignment</button>
      </div>}
      </section>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 'clamp(16px, 3vw, 32px)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'var(--mn-action-primary, #0b624a)',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--mn-text-secondary, #52655f)',
    margin: 0,
    maxWidth: 720,
  },
  note: {
    fontSize: 12,
    color: 'var(--mn-text-muted, #5b6b66)',
    marginBottom: 16,
    maxWidth: 720,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'var(--mn-action-primary, #0b624a)',
    margin: '24px 0 12px 0',
  },
  templateList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  templateRow: {
    backgroundColor: 'var(--mn-surface-raised, #ffffff)',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 8,
  },
  templateHeaderRow: {
    width: '100%',
    border: 0,
    background: 'transparent',
    textAlign: 'left',
    font: 'inherit',
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
    color: 'var(--mn-action-primary, #0b624a)',
    marginRight: 10,
  },
  templateDisplayName: {
    fontSize: 13,
    color: 'var(--mn-text-primary, #132b25)',
  },
  templateMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  activeBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--mn-status-success, #146348)',
    backgroundColor: 'var(--mn-status-success-bg, #e4f4ec)',
    padding: '2px 8px',
    borderRadius: 10,
  },
  inactiveBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--mn-text-muted, #5b6b66)',
    backgroundColor: 'var(--mn-surface-sunken, #eef3f0)',
    padding: '2px 8px',
    borderRadius: 10,
  },
  widgetCount: {
    fontSize: 11,
    color: 'var(--mn-text-secondary, #52655f)',
  },
  expandIcon: {
    fontSize: 10,
    color: 'var(--mn-text-muted, #5b6b66)',
  },
  templateDetail: {
    borderTop: '1px solid var(--mn-surface-sunken, #eef3f0)',
    padding: '12px 16px',
  },
  templateDescription: {
    fontSize: 12,
    color: 'var(--mn-text-secondary, #52655f)',
    margin: '0 0 10px 0',
  },
  widgetList: {
    listStyle: 'disc',
    margin: 0,
    paddingLeft: 18,
    fontSize: 12,
    color: 'var(--mn-text-primary, #132b25)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  widgetListItem: {},
  widgetKeyLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: 'var(--mn-text-muted, #5b6b66)',
  },
  assignmentTableWrap: {
    backgroundColor: 'var(--mn-surface-raised, #ffffff)',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 8,
    padding: 12,
    width: 'max-content',
    minWidth: '100%',
    boxSizing: 'border-box',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '2px solid var(--mn-border-subtle, #dde7e2)',
    color: 'var(--mn-text-secondary, #52655f)',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  td: {
    padding: '10px',
    borderBottom: '1px solid var(--mn-surface-sunken, #eef3f0)',
    verticalAlign: 'top',
  },
  select: {
    height: 32,
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 6,
    padding: '0 8px',
    fontSize: 12,
    minWidth: 220,
  },
  reasonInput: {
    height: 32,
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 6,
    padding: '0 8px',
    fontSize: 12,
    minWidth: 220,
  },
  saveBtn: {
    backgroundColor: 'var(--mn-action-primary, #0b624a)',
    color: 'var(--mn-surface-raised, #ffffff)',
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
    color: 'var(--mn-status-success, #146348)',
    maxWidth: 220,
  },
  rowError: {
    marginTop: 6,
    fontSize: 11,
    color: 'var(--mn-status-danger, #b3261e)',
    maxWidth: 220,
  },
  stateBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: 13,
  },
  spinner: {
    width: 16,
    height: 16,
    border: '2px solid var(--mn-border-subtle, #dde7e2)',
    borderTop: '2px solid var(--mn-action-primary, #0b624a)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  forbiddenBox: {
    backgroundColor: 'var(--mn-surface-sunken, #eef3f0)',
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: 13,
    padding: 16,
    borderRadius: 8,
    maxWidth: 640,
  },
  errorBox: {
    backgroundColor: 'var(--mn-status-danger-bg, #fdebe9)',
    color: 'var(--mn-status-danger, #b3261e)',
    fontSize: 13,
    fontWeight: 500,
    padding: 12,
    borderRadius: 6,
    border: '1px solid var(--mn-status-danger, #b3261e)',
    maxWidth: 640,
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: 'var(--mn-action-primary, #0b624a)',
    color: 'var(--mn-surface-raised, #ffffff)',
    border: 'none',
    borderRadius: 6,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  code: {
    fontFamily: 'monospace',
    backgroundColor: 'var(--mn-border-subtle, #dde7e2)',
    padding: '1px 5px',
    borderRadius: 4,
  },
};
