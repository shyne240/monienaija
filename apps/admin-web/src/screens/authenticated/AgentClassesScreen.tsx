import React, { useCallback, useEffect, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import {
  CANONICAL_AGENT_SERVICES,
  normalizeApplicableServicesInput,
  type CanonicalAgentServiceCode,
} from '../../services/ordinary-agent-admin-api';
import { useAuthStore } from '../../store/auth-store';

interface AgentClassRecord {
  id: string;
  reference: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  requirements: unknown | null;
  requiredInformation: unknown | null;
  requiredDocumentCategories: unknown | null;
  applicableServices: unknown | null;
  applicableLimits: unknown | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ClassLimitAssignmentRecord {
  id: string;
  limitProfileCode: string;
  subjectType: string;
  subjectId: string | null;
  precedence?: number;
  isActive: boolean;
  version?: number;
  effectiveFrom?: string | null;
}

interface AgentClassForm {
  reference: string;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  applicableServices: CanonicalAgentServiceCode[];
  legacyAliasesMapped: Array<{ from: string; to: CanonicalAgentServiceCode }>;
  unknownServiceTokens: string[];
  nonArrayServicesConfigured: boolean;
  discardNonCanonicalServices: boolean;
  requirements: string;
  requiredInformation: string;
  requiredDocumentCategories: string;
  applicableLimits: string;
}

const EMPTY_FORM: AgentClassForm = {
  reference: '',
  code: '',
  name: '',
  description: '',
  isActive: false,
  applicableServices: [],
  legacyAliasesMapped: [],
  unknownServiceTokens: [],
  nonArrayServicesConfigured: false,
  discardNonCanonicalServices: false,
  requirements: '',
  requiredInformation: '',
  requiredDocumentCategories: '',
  applicableLimits: '',
};

const JSON_FIELDS: Array<{
  key: 'requirements' | 'requiredInformation' | 'requiredDocumentCategories' | 'applicableLimits';
  label: string;
}> = [
  { key: 'requirements', label: 'Requirements JSON' },
  { key: 'requiredInformation', label: 'Required information JSON' },
  { key: 'requiredDocumentCategories', label: 'Required document categories JSON' },
  { key: 'applicableLimits', label: 'Applicable limits JSON' },
];

function formatJson(value: unknown | null): string {
  return value === null || value === undefined ? '' : JSON.stringify(value, null, 2);
}

function summarizeConfiguredServices(value: unknown | null): string {
  if (value === null || value === undefined) return 'Not configured';
  if (Array.isArray(value)) {
    const names = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    );
    return names.length > 0 ? `Configured (${names.join(', ')})` : 'Configured ([])';
  }
  if (typeof value === 'object') {
    const keys = Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([k]) => k);
    return keys.length > 0 ? `Configured (${keys.join(', ')})` : 'Configured';
  }
  return 'Configured';
}

function toForm(agentClass: AgentClassRecord): AgentClassForm {
  const normalizedServices = normalizeApplicableServicesInput(agentClass.applicableServices);
  return {
    reference: agentClass.reference ?? '',
    code: agentClass.code ?? '',
    name: agentClass.name ?? '',
    description: agentClass.description ?? '',
    isActive: Boolean(agentClass.isActive),
    applicableServices: normalizedServices.canonical,
    legacyAliasesMapped: normalizedServices.legacyAliasesMapped,
    unknownServiceTokens: normalizedServices.unknownTokens,
    nonArrayServicesConfigured: normalizedServices.nonArrayConfigured,
    discardNonCanonicalServices: false,
    requirements: formatJson(agentClass.requirements),
    requiredInformation: formatJson(agentClass.requiredInformation),
    requiredDocumentCategories: formatJson(agentClass.requiredDocumentCategories),
    applicableLimits: formatJson(agentClass.applicableLimits),
  };
}

function parseJsonField(raw: string, label: string): unknown | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} must contain valid JSON, or be left blank for null.`);
  }
}

export const AgentClassesScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFunction = (functionCode: string) => principal?.scopes.includes(functionCode) ?? false;
  const canView = hasFunction('agent.view');
  const canManage = hasFunction('agent.manage_classes');
  const canViewLimits = hasFunction('limit.view');
  const canModifyLimits = hasFunction('limit.modify');

  const [items, setItems] = useState<AgentClassRecord[]>([]);
  const [selected, setSelected] = useState<AgentClassRecord | null>(null);
  const [form, setForm] = useState<AgentClassForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Agent class limit assignments state (limit.view read / limit.modify write)
  const [classLimitsLoaded, setClassLimitsLoaded] = useState(false);
  const [classLimitsLoading, setClassLimitsLoading] = useState(false);
  const [classLimitsBusy, setClassLimitsBusy] = useState(false);
  const [classLimitsError, setClassLimitsError] = useState('');
  const [classLimitsMsg, setClassLimitsMsg] = useState('');
  const [classLimits, setClassLimits] = useState<ClassLimitAssignmentRecord[]>([]);
  const [classLimitProfileCode, setClassLimitProfileCode] = useState('');

  const resetClassLimitsState = () => {
    setClassLimitsLoaded(false);
    setClassLimits([]);
    setClassLimitsError('');
    setClassLimitsMsg('');
    setClassLimitProfileCode('');
  };

  const loadClasses = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const response: unknown = await ApiClient.get('/internal/agents/classes');
      const rows = Array.isArray(response)
        ? response
        : (response as { data?: unknown[] } | null)?.data ?? [];
      setItems(rows as AgentClassRecord[]);
      if (selected) {
        const refreshed =
          (rows as AgentClassRecord[]).find((item) => item.id === selected.id) ?? null;
        setSelected(refreshed);
        if (refreshed && !creating) setForm(toForm(refreshed));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Agent classes.');
    } finally {
      setLoading(false);
    }
  }, [canView, creating, selected]);

  useEffect(() => {
    if (canView) void loadClasses();
  }, [canView]);

  const chooseClass = (agentClass: AgentClassRecord) => {
    setSelected(agentClass);
    setCreating(false);
    setForm(toForm(agentClass));
    setError('');
    setMessage('');
    resetClassLimitsState();
  };

  const startCreate = () => {
    setSelected(null);
    setCreating(true);
    setForm(EMPTY_FORM);
    setError('');
    setMessage('');
    resetClassLimitsState();
  };

  const changeField = <K extends keyof AgentClassForm>(key: K, value: AgentClassForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleCanonicalService = (code: CanonicalAgentServiceCode, checked: boolean) => {
    setForm((current) => {
      const nextSet = new Set(current.applicableServices);
      if (checked) nextSet.add(code);
      else nextSet.delete(code);
      const ordered = CANONICAL_AGENT_SERVICES
        .map((service) => service.code)
        .filter((serviceCode) => nextSet.has(serviceCode));
      return { ...current, applicableServices: ordered };
    });
  };

  const loadClassLimitAssignments = async (agentClassId: string) => {
    if (!canViewLimits || classLimitsLoading) return;
    setClassLimitsLoading(true);
    setClassLimitsError('');
    try {
      const res: any = await ApiClient.get(
        `/internal/limit-assignments/agent-class/${encodeURIComponent(agentClassId)}`,
      );
      const rows = res?.data || res?.items || (Array.isArray(res) ? res : []);
      setClassLimits(rows);
      setClassLimitsLoaded(true);
    } catch (err: any) {
      setClassLimitsError(err?.message || 'Failed to load Agent class limit assignments.');
    } finally {
      setClassLimitsLoading(false);
    }
  };

  const assignClassLimitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !canModifyLimits || classLimitsBusy) return;
    const code = classLimitProfileCode.trim().toUpperCase();
    if (!/^[A-Z0-9_]{3,80}$/.test(code)) {
      setClassLimitsError(
        'Limit profile code must be 3–80 uppercase letters, digits, or underscores (e.g. AGENT_CLASS_STANDARD).',
      );
      return;
    }
    setClassLimitsBusy(true);
    setClassLimitsError('');
    setClassLimitsMsg('');
    try {
      await ApiClient.post('/internal/limit-assignments', {
        subjectType: 'AGENT_CLASS',
        subjectId: selected.id,
        limitProfileCode: code,
      });
      setClassLimitProfileCode('');
      setClassLimitsMsg(
        canViewLimits
          ? `Assigned limit profile ${code} to class ${selected.reference}.`
          : `Assigned limit profile ${code} to class ${selected.reference}. Viewing assignments requires limit.view.`,
      );
      if (canViewLimits) {
        await loadClassLimitAssignments(selected.id);
      }
    } catch (err: any) {
      setClassLimitsError(err?.message || 'Failed to assign limit profile to Agent class.');
    } finally {
      setClassLimitsBusy(false);
    }
  };

  const toggleClassLimitAssignment = async (assignment: ClassLimitAssignmentRecord) => {
    if (!selected || !canModifyLimits || classLimitsBusy) return;
    setClassLimitsBusy(true);
    setClassLimitsError('');
    setClassLimitsMsg('');
    try {
      await ApiClient.patch(`/internal/limit-assignments/${encodeURIComponent(assignment.id)}`, {
        subjectType: 'AGENT_CLASS',
        isActive: !assignment.isActive,
        version: assignment.version ?? 1,
      });
      setClassLimitsMsg(
        `Class limit ${assignment.limitProfileCode} ${assignment.isActive ? 'deactivated' : 'activated'}.`,
      );
      if (canViewLimits) {
        await loadClassLimitAssignments(selected.id);
      }
    } catch (err: any) {
      setClassLimitsError(err?.message || 'Failed to update Agent class limit assignment.');
    } finally {
      setClassLimitsBusy(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || saving) return;
    setError('');
    setMessage('');

    const hasUnresolvedNonCanonical =
      (form.unknownServiceTokens.length > 0 || form.nonArrayServicesConfigured) &&
      !form.discardNonCanonicalServices;
    if (hasUnresolvedNonCanonical) {
      setError(
        'This class contains non-canonical service configuration from an older record. Acknowledge discarding non-canonical service tokens before saving.',
      );
      return;
    }

    if (!form.name.trim()) {
      setError('Class name is required.');
      return;
    }

    try {
      const config = {
        requirements: parseJsonField(form.requirements, 'Requirements'),
        requiredInformation: parseJsonField(form.requiredInformation, 'Required information'),
        requiredDocumentCategories: parseJsonField(
          form.requiredDocumentCategories,
          'Required document categories',
        ),
        applicableServices: form.applicableServices.length > 0 ? form.applicableServices : null,
        applicableLimits: parseJsonField(form.applicableLimits, 'Applicable limits'),
      };
      setSaving(true);

      if (creating) {
        const body: Record<string, unknown> = {
          name: form.name.trim(),
          isActive: form.isActive,
          ...config,
        };
        if (form.reference.trim()) body.reference = form.reference.trim();
        if (form.code.trim()) body.code = form.code.trim();
        if (form.description.trim()) body.description = form.description.trim();
        const created = await ApiClient.post<AgentClassRecord>('/internal/agents/classes', body);
        setMessage(
          `Agent class ${created.reference} created. New classes start inactive unless explicitly activated.`,
        );
        setSelected(created);
        setCreating(false);
        setForm(toForm(created));
        await loadClasses();
      } else if (selected) {
        const updated = await ApiClient.patch<AgentClassRecord>(
          `/internal/agents/classes/${encodeURIComponent(selected.id)}`,
          {
            name: form.name.trim(),
            description: form.description.trim() || null,
            isActive: form.isActive,
            ...config,
            expectedVersion: selected.version,
          },
        );
        setMessage(`Agent class ${updated.reference} saved at version ${updated.version}.`);
        setSelected(updated);
        setForm(toForm(updated));
        await loadClasses();
      }
    } catch (saveError) {
      setError(
        `${saveError instanceof Error ? saveError.message : 'Unable to save Agent class.'} ` +
          'If the response was lost, refresh the list and inspect the class before retrying.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <div style={styles.wrap} role="alert">
        <div style={styles.error}>
          Agent class listing requires <code>agent.view</code>. Editing also requires{' '}
          <code>agent.manage_classes</code>.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <div>
          <h2 style={styles.title}>Agent Classes &amp; Service Eligibility</h2>
          <p style={styles.subtitle}>
            Review class configuration and manage it only with the dedicated authorization function.
          </p>
        </div>
        <div style={styles.headerActions}>
          <button
            type="button"
            onClick={() => void loadClasses()}
            style={styles.secondaryButton}
            disabled={loading}
          >
            Refresh
          </button>
          {canManage && (
            <button type="button" onClick={startCreate} style={styles.primaryButton}>
              Create class
            </button>
          )}
        </div>
      </header>

      <div style={styles.notice} role="note">
        Class fields are policy-bearing configuration. Applicable services are restricted to validated canonical Ordinary Agent V1 service identifiers; leaving all services unchecked saves <code>null</code>. Blank JSON fields are saved as <code>null</code>; no capability or regulatory defaults are supplied. New classes begin inactive.
      </div>
      {!canManage && (
        <div
          style={styles.governanceBanner}
          role="note"
          data-testid="agent-classes-readonly-governance"
        >
          <strong>Read-Only Governance Mode:</strong> Your principal holds <code>agent.view</code>{' '}
          without <code>agent.manage_classes</code>. Class catalogue creation and editing require{' '}
          <code>agent.manage_classes</code> (granted to <code>AGENT_NETWORK_MANAGER</code> and{' '}
          <code>SUPER_ADMIN</code>).
        </div>
      )}
      {error && (
        <div style={styles.error} role="alert">
          {error}
        </div>
      )}
      {message && (
        <div style={styles.success} role="status">
          {message}
        </div>
      )}

      {loading ? (
        <div style={styles.loading}>Loading Agent classes…</div>
      ) : items.length === 0 ? (
        <div style={styles.empty}>No Agent classes returned by the authorized API.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Reference / code</th>
                <th>Name</th>
                <th>State</th>
                <th>Services</th>
                <th>Limits</th>
                <th>Version</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.reference}</strong>
                    <br />
                    <code>{item.code}</code>
                  </td>
                  <td>{item.name}</td>
                  <td>
                    <span style={item.isActive ? styles.active : styles.inactive}>
                      {item.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td>{summarizeConfiguredServices(item.applicableServices)}</td>
                  <td>{item.applicableLimits == null ? 'Not configured' : 'Configured'}</td>
                  <td>{item.version}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => chooseClass(item)}
                      style={styles.smallButton}
                    >
                      {canManage ? 'Review / edit' : 'Review'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || selected) && (
        <section
          style={styles.editor}
          aria-label={creating ? 'Create Agent class' : 'Agent class details'}
        >
          <div style={styles.editorHeader}>
            <h3 style={styles.sectionTitle}>
              {creating ? 'Create Agent class' : `${selected?.reference} — configuration`}
            </h3>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => {
                setCreating(false);
                setSelected(null);
                setForm(EMPTY_FORM);
                resetClassLimitsState();
              }}
            >
              Close
            </button>
          </div>
          {canManage ? (
            <form onSubmit={save} style={styles.form}>
              {creating && (
                <>
                  <label style={styles.label}>
                    Reference (optional; generated when blank)
                    <input
                      value={form.reference}
                      onChange={(event) => changeField('reference', event.target.value)}
                      style={styles.input}
                      maxLength={80}
                    />
                  </label>
                  <label style={styles.label}>
                    Code (optional; uses reference when blank)
                    <input
                      value={form.code}
                      onChange={(event) => changeField('code', event.target.value)}
                      style={styles.input}
                      maxLength={80}
                    />
                  </label>
                </>
              )}
              <label style={styles.label}>
                Name
                <input
                  aria-label="Class name"
                  required
                  value={form.name}
                  onChange={(event) => changeField('name', event.target.value)}
                  style={styles.input}
                  maxLength={160}
                />
              </label>
              <label style={styles.label}>
                Description
                <textarea
                  aria-label="Class description"
                  value={form.description}
                  onChange={(event) => changeField('description', event.target.value)}
                  style={styles.textarea}
                  maxLength={500}
                />
              </label>
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => changeField('isActive', event.target.checked)}
                />
                Class active
              </label>

              <fieldset style={styles.serviceFieldset} aria-label="Canonical applicable services">
                <legend style={styles.serviceLegend}>
                  Applicable services (validated canonical Ordinary Agent V1 set)
                </legend>
                <div style={styles.serviceActions}>
                  <button
                    type="button"
                    style={styles.smallButton}
                    onClick={() =>
                      changeField(
                        'applicableServices',
                        CANONICAL_AGENT_SERVICES.map((service) => service.code),
                      )
                    }
                  >
                    Select all canonical services
                  </button>
                  <button
                    type="button"
                    style={styles.smallButton}
                    onClick={() => changeField('applicableServices', [])}
                  >
                    Clear services (null)
                  </button>
                </div>

                {form.legacyAliasesMapped.length > 0 && (
                  <div style={styles.governanceBanner} role="note">
                    Legacy service alias mapped to canonical identifier:{' '}
                    {form.legacyAliasesMapped
                      .map((entry) => `${entry.from} → ${entry.to}`)
                      .join(', ')}
                    .
                  </div>
                )}

                {(form.unknownServiceTokens.length > 0 || form.nonArrayServicesConfigured) && (
                  <div style={styles.warningBox} role="note">
                    <div>
                      <strong>Non-canonical service data detected on existing class:</strong>{' '}
                      {form.nonArrayServicesConfigured
                        ? 'non-array service object'
                        : form.unknownServiceTokens.join(', ')}
                      . Only canonical service identifiers can be saved.
                    </div>
                    <label style={{ ...styles.checkboxLabel, marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={form.discardNonCanonicalServices}
                        onChange={(event) =>
                          changeField('discardNonCanonicalServices', event.target.checked)
                        }
                      />
                      Discard non-canonical service tokens on save
                    </label>
                  </div>
                )}

                <div style={styles.serviceGrid}>
                  {CANONICAL_AGENT_SERVICES.map((service) => {
                    const checked = form.applicableServices.includes(service.code);
                    return (
                      <label key={service.code} style={styles.serviceOption}>
                        <input
                          type="checkbox"
                          aria-label={`Service ${service.code}`}
                          checked={checked}
                          onChange={(event) =>
                            toggleCanonicalService(service.code, event.target.checked)
                          }
                        />
                        <span>
                          <strong>{service.label}</strong> <code>({service.code})</code>
                          <span style={styles.serviceDesc}>{service.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div style={styles.configGrid}>
                {JSON_FIELDS.map(({ key, label }) => (
                  <label key={key} style={styles.label}>
                    {label}
                    <textarea
                      aria-label={label}
                      value={form[key]}
                      onChange={(event) => changeField(key, event.target.value)}
                      style={styles.jsonArea}
                      spellCheck={false}
                    />
                  </label>
                ))}
              </div>
              {!creating && (
                <p style={styles.versionNote}>
                  Update uses expected version {selected?.version}. A stale edit is rejected; refresh
                  before applying it again.
                </p>
              )}
              <button type="submit" style={styles.primaryButton} disabled={saving}>
                {saving ? 'Saving…' : creating ? 'Create inactive class' : 'Save class'}
              </button>
            </form>
          ) : (
            <div style={styles.readOnlyDetails}>
              <div>
                <strong>Name:</strong> {selected?.name}
              </div>
              <div>
                <strong>Description:</strong> {selected?.description || '—'}
              </div>
              <div>
                <strong>State:</strong> {selected?.isActive ? 'ACTIVE' : 'INACTIVE'} ·{' '}
                <strong>Version:</strong> {selected?.version}
              </div>
              <div>
                <strong>Applicable services:</strong>{' '}
                {summarizeConfiguredServices(selected?.applicableServices ?? null)}
              </div>
              {JSON_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <strong>{label}:</strong>
                  <pre style={styles.pre}>{formatJson(selected?.[key]) || 'null'}</pre>
                </div>
              ))}
              <p>
                Editing requires <code>agent.manage_classes</code>.
              </p>
            </div>
          )}

          {!creating && selected && (
            <div style={styles.classLimitsSection} aria-label="Agent class limit assignments">
              <div style={styles.editorHeader}>
                <div>
                  <h4 style={styles.subSectionTitle}>
                    Agent Class Limit Assignments (<code>AGENT_CLASS</code>)
                  </h4>
                  <p style={styles.versionNote}>
                    Class-level limit profiles apply across Agents in <code>{selected.code}</code>{' '}
                    unless overridden by a higher-precedence per-Agent assignment.
                  </p>
                </div>
                {canViewLimits && (
                  <button
                    type="button"
                    style={styles.smallButton}
                    disabled={classLimitsLoading}
                    onClick={() => void loadClassLimitAssignments(selected.id)}
                  >
                    {classLimitsLoading
                      ? 'Loading…'
                      : classLimitsLoaded
                        ? 'Refresh class limits'
                        : 'Load class limit assignments'}
                  </button>
                )}
              </div>

              {!canViewLimits && !canModifyLimits && (
                <div style={styles.versionNote}>
                  Viewing class limit assignments requires <code>limit.view</code>; creating or
                  toggling class limit assignments requires <code>limit.modify</code>.
                </div>
              )}

              {!canViewLimits && canModifyLimits && (
                <div style={styles.governanceBanner} role="note">
                  Your principal holds <code>limit.modify</code> without <code>limit.view</code>.
                  You can assign a limit profile below, while reading existing assignments requires{' '}
                  <code>limit.view</code>.
                </div>
              )}

              {classLimitsError && (
                <div style={styles.error} role="alert">
                  {classLimitsError}
                </div>
              )}
              {classLimitsMsg && (
                <div style={styles.success} role="status">
                  {classLimitsMsg}
                </div>
              )}

              {canViewLimits && classLimitsLoaded && (
                <div style={{ marginTop: 8 }}>
                  {classLimits.length === 0 ? (
                    <div style={styles.versionNote}>
                      No <code>AGENT_CLASS</code> limit assignments configured for{' '}
                      <code>{selected.reference}</code>.
                    </div>
                  ) : (
                    <ul style={styles.limitList}>
                      {classLimits.map((assignment) => (
                        <li key={assignment.id} style={styles.limitItem}>
                          <span>
                            <code>{assignment.limitProfileCode}</code> ·{' '}
                            <span style={assignment.isActive ? styles.active : styles.inactive}>
                              {assignment.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>{' '}
                            · v{assignment.version ?? 1}
                          </span>
                          {canModifyLimits && (
                            <button
                              type="button"
                              style={styles.smallButton}
                              disabled={classLimitsBusy}
                              onClick={() => void toggleClassLimitAssignment(assignment)}
                            >
                              {assignment.isActive
                                ? 'Deactivate class limit'
                                : 'Activate class limit'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {canModifyLimits && (
                <form
                  onSubmit={assignClassLimitProfile}
                  style={styles.inlineLimitForm}
                  aria-label="Assign limit profile to Agent class"
                >
                  <input
                    aria-label="Class limit profile code"
                    placeholder="Profile code (e.g. AGENT_CLASS_STANDARD)"
                    value={classLimitProfileCode}
                    onChange={(event) => setClassLimitProfileCode(event.target.value)}
                    style={styles.inlineInput}
                    disabled={classLimitsBusy}
                  />
                  <button
                    type="submit"
                    style={styles.smallButton}
                    disabled={classLimitsBusy}
                  >
                    Assign class limit
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  wrap: { padding: 24, maxWidth: 1250, color: '#0F172A', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  title: { margin: '0 0 6px', color: '#032B14', fontSize: 22 },
  subtitle: { margin: 0, color: '#64748B', fontSize: 13 },
  headerActions: { display: 'flex', gap: 8 },
  notice: { margin: '18px 0', padding: 12, border: '1px solid #FCD34D', borderRadius: 8, background: '#FFFBEB', color: '#78350F', fontSize: 13, lineHeight: 1.5 },
  governanceBanner: { margin: '0 0 12px', padding: 11, border: '1px solid #BFDBFE', borderRadius: 8, background: '#EFF6FF', color: '#1E3A8A', fontSize: 12, lineHeight: 1.5 },
  warningBox: { margin: '0 0 12px', padding: 11, border: '1px solid #FDBA74', borderRadius: 8, background: '#FFF7ED', color: '#9A3412', fontSize: 12, lineHeight: 1.5 },
  primaryButton: { padding: '9px 14px', border: '1px solid #0A3D25', borderRadius: 6, color: '#fff', background: '#0A3D25', cursor: 'pointer', fontWeight: 700 },
  secondaryButton: { padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#1E293B', cursor: 'pointer' },
  smallButton: { padding: '5px 9px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 12 },
  error: { padding: 11, marginBottom: 12, border: '1px solid #FCA5A5', borderRadius: 6, background: '#FEF2F2', color: '#991B1B', fontSize: 13 },
  success: { padding: 11, marginBottom: 12, border: '1px solid #6EE7B7', borderRadius: 6, background: '#ECFDF5', color: '#065F46', fontSize: 13 },
  loading: { padding: 24, textAlign: 'center', color: '#64748B' },
  empty: { padding: 24, color: '#64748B', textAlign: 'center', background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 8 },
  tableWrap: { width: '100%', overflowX: 'auto', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 750, fontSize: 13 },
  active: { padding: '3px 8px', borderRadius: 12, background: '#ECFDF5', color: '#065F46', fontSize: 11, fontWeight: 700 },
  inactive: { padding: '3px 8px', borderRadius: 12, background: '#F1F5F9', color: '#475569', fontSize: 11, fontWeight: 700 },
  editor: { marginTop: 20, padding: 16, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8 },
  editorHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  sectionTitle: { margin: 0, color: '#032B14', fontSize: 16 },
  subSectionTitle: { margin: '0 0 4px', color: '#032B14', fontSize: 14 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, color: '#334155', fontSize: 12, fontWeight: 600 },
  input: { width: '100%', boxSizing: 'border-box', padding: 9, border: '1px solid #CBD5E1', borderRadius: 5, font: 'inherit', fontWeight: 400 },
  inlineInput: { padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 5, font: 'inherit', fontSize: 12, minWidth: 240 },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: 68, padding: 9, border: '1px solid #CBD5E1', borderRadius: 5, font: 'inherit', fontWeight: 400, resize: 'vertical' },
  jsonArea: { width: '100%', boxSizing: 'border-box', minHeight: 112, padding: 9, border: '1px solid #CBD5E1', borderRadius: 5, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, fontWeight: 400, resize: 'vertical' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#334155', fontSize: 13 },
  serviceFieldset: { margin: 0, padding: 12, border: '1px solid #E2E8F0', borderRadius: 8, background: '#F8FAFC' },
  serviceLegend: { padding: '0 6px', fontSize: 12, fontWeight: 700, color: '#032B14' },
  serviceActions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  serviceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 },
  serviceOption: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: 8, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12, color: '#1E293B', cursor: 'pointer' },
  serviceDesc: { display: 'block', marginTop: 2, color: '#64748B', fontSize: 11 },
  configGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 },
  versionNote: { margin: 0, color: '#64748B', fontSize: 12 },
  readOnlyDetails: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 },
  pre: { padding: 10, margin: '6px 0 0', maxHeight: 240, overflow: 'auto', background: '#F8FAFC', borderRadius: 5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  classLimitsSection: { marginTop: 18, paddingTop: 14, borderTop: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 8 },
  limitList: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  limitItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 8px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 },
  inlineLimitForm: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 },
};
