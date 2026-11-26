import React, { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import './operational-surfaces.css';

interface CustomerClass {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  status: string;
  enabled: boolean;
  configurationStatus: string;
  isDefault: boolean;
  version: number;
}

interface SegmentLimitAssignment {
  id: string;
  limitProfileCode: string;
  subjectType: string;
  segmentCode?: string | null;
  precedence?: number;
  isActive: boolean;
  version?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

interface ClassFeeRule {
  id: string;
  productCode: string;
  currency: string;
  customerClassCode?: string | null;
  flatFeeMinor?: string | null;
  percentageBps?: number | null;
  priority?: number;
  isActive: boolean;
}

interface TierDefaultMapping {
  tier: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';
  classId: string | null;
  classCode: string | null;
  className: string | null;
  status: 'PENDING_APPROVAL' | 'APPROVED';
  approvedAt: string | null;
  approvedBy: string | null;
  approvalId: string | null;
  reason: string | null;
  globalDefaultClassCodeAtMigration: string | null;
  classUsable: boolean;
  version: number;
}

interface TierDefaultsView {
  mappings: TierDefaultMapping[];
  globalDefault: { classId: string; classCode: string; className: string } | null;
  allApproved: boolean;
  pendingApprovalCount: number;
}

/** Customer class governance catalogue surface wired into shared Admin Web navigation. */
export const CustomerClassesScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canView = Boolean(scopes.includes('customer.view'));
  const canManage = Boolean(
    scopes.includes('customer.manage_classes') && !principal?.readOnlyPrincipal,
  );
  const canViewLimits = Boolean(scopes.includes('limit.view'));
  const canModifyLimits = Boolean(scopes.includes('limit.modify') && !principal?.readOnlyPrincipal);
  const canViewFees = Boolean(scopes.includes('fee_rule.view'));
  const [classes, setClasses] = useState<CustomerClass[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [tierDefaults, setTierDefaults] = useState<TierDefaultsView | null>(null);
  const [tierDraft, setTierDraft] = useState<Record<string, string>>({
    LEVEL_1: '',
    LEVEL_2: '',
    LEVEL_3: '',
  });
  const [tierReason, setTierReason] = useState('');
  const [tierApprovalId, setTierApprovalId] = useState('');
  const [tierMessage, setTierMessage] = useState('');
  const normalizeTierDefaults = (value: unknown): TierDefaultsView | null => {
    if (!value || typeof value !== 'object') return null;
    const v = value as Partial<TierDefaultsView>;
    const mappings = Array.isArray(v.mappings) ? v.mappings : [];
    return {
      mappings,
      globalDefault: v.globalDefault && typeof v.globalDefault === 'object' ? v.globalDefault as TierDefaultsView['globalDefault'] : null,
      allApproved: Boolean(v.allApproved),
      pendingApprovalCount: typeof v.pendingApprovalCount === 'number' ? v.pendingApprovalCount : 0,
    };
  };

  const loadTierDefaults = useCallback(async () => {
    const result = await ApiClient.get<TierDefaultsView>('/internal/customer-classes/tier-defaults');
    const safe = normalizeTierDefaults(result);
    setTierDefaults(safe);
    if (safe) {
      setTierDraft((prev) => ({
        LEVEL_1: prev.LEVEL_1 || safe.mappings.find((m) => m.tier === 'LEVEL_1')?.classId || '',
        LEVEL_2: prev.LEVEL_2 || safe.mappings.find((m) => m.tier === 'LEVEL_2')?.classId || '',
        LEVEL_3: prev.LEVEL_3 || safe.mappings.find((m) => m.tier === 'LEVEL_3')?.classId || '',
      }));
    }
  }, []);
  const load = useCallback(async () => {
    const [result] = await Promise.all([
      ApiClient.get<CustomerClass[]>('/internal/customer-classes'),
      loadTierDefaults().catch(() => undefined),
    ]);
    setClasses(Array.isArray(result) ? result : []);
    setLoaded(true);
    setError('');
  }, [loadTierDefaults]);
  useEffect(() => {
    let mounted = true;
    if (canView)
      Promise.all([
        ApiClient.get<CustomerClass[]>('/internal/customer-classes').catch(() => []),
        ApiClient.get<TierDefaultsView>('/internal/customer-classes/tier-defaults').catch(() => null),
      ])
        .then(([result, defaults]) => {
          if (mounted) {
            setClasses(Array.isArray(result) ? result : []);
            const safe = normalizeTierDefaults(defaults);
            setTierDefaults(safe);
            if (safe) {
              setTierDraft({
                LEVEL_1: safe.mappings.find((m) => m.tier === 'LEVEL_1')?.classId || '',
                LEVEL_2: safe.mappings.find((m) => m.tier === 'LEVEL_2')?.classId || '',
                LEVEL_3: safe.mappings.find((m) => m.tier === 'LEVEL_3')?.classId || '',
              });
            }
            setLoaded(true);
          }
        })
        .catch(() => {
          if (mounted) {
            setClasses([]);
            setTierDefaults(null);
            setError('Customer classes are unavailable.');
          }
        });
    return () => {
      mounted = false;
    };
  }, [canView]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy) return;
    setBusy(true);
    setError('');
    try {
      await ApiClient.post('/internal/customer-classes', {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setCode('');
      setName('');
      setDescription('');
      await load();
    } catch {
      setLoaded(false);
      setError('Creation could not be confirmed. Reload before retrying.');
    } finally {
      setBusy(false);
    }
  };
  const update = async (item: CustomerClass, changes: Record<string, unknown>) => {
    if (!canManage || busy) return;
    setBusy(true);
    setError('');
    try {
      await ApiClient.patch(`/internal/customer-classes/${encodeURIComponent(item.id)}`, {
        ...changes,
        expectedVersion: item.version,
      });
      await load();
    } catch {
      setLoaded(false);
      setError('Update could not be confirmed. Reload before retrying.');
    } finally {
      setBusy(false);
    }
  };
  const proposeTierDefaults = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy) return;
    setBusy(true);
    setTierMessage('');
    setError('');
    try {
      const res = await ApiClient.post<Record<string, unknown>>(
        '/internal/customer-classes/tier-defaults/proposals',
        { tierDefaults: tierDraft, reason: tierReason.trim() },
      );
      const approvalId = typeof res.approvalId === 'string' ? res.approvalId : '';
      setTierApprovalId(approvalId);
      setTierMessage(
        approvalId
          ? `Tier default proposal submitted. Approval ID: ${approvalId}. Execute it after approval.`
          : 'Tier default proposal submitted.',
      );
      await loadTierDefaults().catch(() => undefined);
    } catch {
      setError('Tier default proposal could not be submitted. Check class usability and approval permissions.');
    } finally {
      setBusy(false);
    }
  };
  const executeTierDefaults = async () => {
    if (!canManage || busy || !tierApprovalId.trim()) return;
    setBusy(true);
    setTierMessage('');
    setError('');
    try {
      await ApiClient.post(
        `/internal/customer-classes/tier-defaults/proposals/${encodeURIComponent(tierApprovalId.trim())}/execute`,
        { tierDefaults: tierDraft, reason: tierReason.trim() },
      );
      setTierMessage('Tier default mappings approved and applied.');
      setTierApprovalId('');
      await load();
    } catch {
      setError('Tier default execution could not be confirmed. Ensure the approval is approved and payload matches.');
    } finally {
      setBusy(false);
    }
  };
  if (!canView)
    return (
      <section>
        <h1>Customer classes</h1>
        <p>Customer class information is restricted.</p>
      </section>
    );
  return (
    <section className="cm-card">
      <h1>Customer classes</h1>
      <p>
        Class of service is independent of KYC tier. New custom classes start unconfigured and
        disabled.
      </p>
      <section className="cm-card" aria-labelledby="cm-tier-defaults-title" style={{ marginBottom: 16 }}>
        <h2 id="cm-tier-defaults-title">Tier default service classes</h2>
        <p>
          Configure one effective default service class per KYC tier. Changes use existing approval and audit mechanisms.
          {tierDefaults?.globalDefault
            ? ` Current global default at migration: ${tierDefaults.globalDefault.classCode} — ${tierDefaults.globalDefault.className}.`
            : ''}
        </p>
        {!tierDefaults ? (
          <p>Tier defaults unavailable.</p>
        ) : (
          <>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Mapped class</th>
                  <th>Status</th>
                  <th>Approval</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(tierDefaults.mappings) ? tierDefaults.mappings : []).map((m) => (
                  <tr key={m.tier}>
                    <td>{m.tier}</td>
                    <td>{m.classCode ? `${m.classCode} — ${m.className ?? ''}` : '—'}{m.classUsable ? '' : ' (not usable)'}</td>
                    <td>{m.status}</td>
                    <td>{m.approvalId ?? '—'}{m.approvedAt ? ` @ ${m.approvedAt}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!tierDefaults.allApproved && (
              <p role="status">Explicit approval is required for the three tier mappings before activation can use them.</p>
            )}
            {canManage && (
              <form onSubmit={proposeTierDefaults}>
                {(['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const).map((tier) => (
                  <label key={tier} style={{ display: 'block', marginBottom: 8 }}>
                    {tier} default class
                    <select
                      value={tierDraft[tier] ?? ''}
                      onChange={(e) => setTierDraft((d) => ({ ...d, [tier]: e.target.value }))}
                      disabled={busy}
                    >
                      <option value="">Select class</option>
                      {classes
                        .filter((c) => c.enabled && c.status === 'ACTIVE' && c.configurationStatus === 'CONFIGURED')
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} — {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
                <label style={{ display: 'block', marginBottom: 8 }}>
                  Reason
                  <input
                    value={tierReason}
                    onChange={(e) => setTierReason(e.target.value)}
                    disabled={busy}
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </label>
                <button type="submit" disabled={busy}>Propose tier defaults</button>{' '}
                <button type="button" disabled={busy || !tierApprovalId.trim()} onClick={() => void executeTierDefaults()}>
                  Execute approved proposal
                </button>
                {tierApprovalId ? <p>Approval ID: <code>{tierApprovalId}</code></p> : null}
                {tierMessage ? <p role="status">{tierMessage}</p> : null}
              </form>
            )}
          </>
        )}
      </section>
      {!loaded ? (
        <p>Class information unavailable or loading.</p>
      ) : (
        <ul>
          {classes.map((item) => (
            <li key={item.id}>
              <strong>
                {item.name} ({item.code})
              </strong>{' '}
              — {item.status}, {item.enabled ? 'enabled' : 'disabled'}, {item.configurationStatus}
              {item.isDefault ? ', default' : ''} (version {item.version})
              {item.description ? ` — ${item.description}` : ''}
              {canManage && (
                <span>
                  {' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      update(item, {
                        enabled: !item.enabled,
                        configurationStatus: item.enabled ? item.configurationStatus : 'CONFIGURED',
                      })
                    }
                  >
                    {item.enabled ? 'Disable' : 'Configure and enable'}
                  </button>
                  <button
                    type="button"
                    disabled={busy || item.isDefault}
                    onClick={() => update(item, { isDefault: true })}
                  >
                    Make default
                  </button>
                  {item.status !== 'DEPRECATED' && !item.isDefault && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        update(item, {
                          status: 'DEPRECATED',
                          enabled: false,
                          configurationStatus: 'DISABLED',
                        })
                      }
                    >
                      Deprecate
                    </button>
                  )}
                </span>
              )}
              {(canViewLimits || canModifyLimits || canViewFees) && (
                <span>
                  {' '}
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedCode((current) => (current === item.code ? null : item.code))
                    }
                  >
                    {expandedCode === item.code
                      ? `Hide limits & policy for ${item.code}`
                      : `Inspect limits & policy for ${item.code}`}
                  </button>
                </span>
              )}
              {canManage && (
                <CustomerClassNameEditor
                  item={item}
                  busy={busy}
                  onSave={(name) => update(item, { name })}
                />
              )}
              {expandedCode === item.code && (
                <CustomerClassPolicyPanel
                  classCode={item.code}
                  canViewLimits={canViewLimits}
                  canModifyLimits={canModifyLimits}
                  canViewFees={canViewFees}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && loaded && (
        <form onSubmit={create}>
          <h2>Create a class</h2>
          <label>
            Code{' '}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              pattern="[A-Za-z0-9_]{3,80}"
              required
              maxLength={80}
            />
          </label>
          <label>
            Name{' '}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={160}
            />
          </label>
          <label>
            Description{' '}
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </label>
          <button type="submit" disabled={busy}>
            Create
          </button>
        </form>
      )}
    </section>
  );
};

const CustomerClassPolicyPanel: React.FC<{
  classCode: string;
  canViewLimits: boolean;
  canModifyLimits: boolean;
  canViewFees: boolean;
}> = ({ classCode, canViewLimits, canModifyLimits, canViewFees }) => {
  const [assignments, setAssignments] = useState<SegmentLimitAssignment[]>([]);
  const [feeRules, setFeeRules] = useState<ClassFeeRule[]>([]);
  const [profileCode, setProfileCode] = useState('');
  const [precedence, setPrecedence] = useState('10');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [err, setErr] = useState('');

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      if (canViewLimits) {
        const res = await ApiClient.get<
          | SegmentLimitAssignment[]
          | { data?: SegmentLimitAssignment[]; items?: SegmentLimitAssignment[] }
        >(`/internal/limit-assignments/segment/${encodeURIComponent(classCode)}`);
        const list = Array.isArray(res) ? res : (res?.data ?? res?.items ?? []);
        setAssignments(list);
      }
      if (canViewFees) {
        const feeRes = await ApiClient.get<
          ClassFeeRule[] | { data?: ClassFeeRule[]; items?: ClassFeeRule[] }
        >('/internal/fee-rules?page=1&limit=50');
        const allFees = Array.isArray(feeRes) ? feeRes : (feeRes?.data ?? feeRes?.items ?? []);
        setFeeRules(allFees.filter((r) => r.customerClassCode === classCode));
      }
    } catch {
      setErr(`Policy details for ${classCode} could not be loaded.`);
    } finally {
      setLoading(false);
    }
  }, [classCode, canViewLimits, canViewFees]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const assignLimitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canModifyLimits || busy || !profileCode.trim()) return;
    setBusy(true);
    setErr('');
    setMessage('');
    try {
      const prec = Number.parseInt(precedence, 10);
      await ApiClient.post('/internal/limit-assignments', {
        subjectType: 'SEGMENT',
        segmentCode: classCode,
        limitProfileCode: profileCode.trim().toUpperCase(),
        ...(Number.isSafeInteger(prec) ? { precedence: prec } : {}),
      });
      setMessage(
        `Assigned limit profile ${profileCode.trim().toUpperCase()} to class ${classCode}.`,
      );
      setProfileCode('');
      await loadPolicy();
    } catch {
      setErr(`Limit profile assignment for ${classCode} could not be confirmed.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-label={`Class policy for ${classCode}`}
      style={{
        marginTop: '8px',
        padding: '10px 12px',
        border: '1px solid var(--mn-border-subtle, #dde7e2)',
        borderRadius: '6px',
      }}
    >
      <p style={{ margin: '0 0 6px', fontSize: '13px' }}>
        <strong>Applicable limits &amp; class-targeted policy ({classCode})</strong> — resolved via{' '}
        <code>CustomerClassResolverService</code> into runtime limit enforcement (
        <code>SEGMENT</code>) and fee rule evaluation (<code>customerClassCode</code>).
      </p>
      {err && <p role="alert">{err}</p>}
      {message && <p role="status">{message}</p>}
      {loading && <p>Loading class policy…</p>}
      {canViewLimits && !loading && (
        <div>
          <strong>Assigned limit profiles (SEGMENT = {classCode}):</strong>
          {assignments.length === 0 ? (
            <p style={{ margin: '4px 0' }}>No segment limit profiles assigned to {classCode}.</p>
          ) : (
            <ul>
              {assignments.map((a) => (
                <li key={a.id}>
                  <code>{a.limitProfileCode}</code> — {a.isActive ? 'Active' : 'Inactive'} ·
                  precedence {a.precedence ?? 0}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {canModifyLimits && (
        <form onSubmit={assignLimitProfile} style={{ marginTop: '8px' }}>
          <label>
            Limit profile for {classCode}{' '}
            <input
              value={profileCode}
              onChange={(e) => setProfileCode(e.target.value)}
              placeholder="e.g. CUSTOMER_PREMIUM"
              required
              disabled={busy}
            />
          </label>{' '}
          <label>
            Precedence for {classCode}{' '}
            <input
              type="number"
              value={precedence}
              onChange={(e) => setPrecedence(e.target.value)}
              disabled={busy}
            />
          </label>{' '}
          <button type="submit" disabled={busy || !profileCode.trim()}>
            Assign class limit profile
          </button>
        </form>
      )}
      {canViewFees && !loading && (
        <div style={{ marginTop: '8px' }}>
          <strong>Class-targeted fee rules (customerClassCode = {classCode}):</strong>
          {feeRules.length === 0 ? (
            <p style={{ margin: '4px 0' }}>No class-targeted fee rules for {classCode}.</p>
          ) : (
            <ul>
              {feeRules.map((f) => (
                <li key={f.id}>
                  <code>{f.productCode}</code> ({f.currency}) — {f.isActive ? 'Active' : 'Inactive'}{' '}
                  · priority {f.priority ?? 0}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

const CustomerClassNameEditor: React.FC<{
  item: CustomerClass;
  busy: boolean;
  onSave: (name: string) => Promise<void>;
}> = ({ item, busy, onSave }) => {
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.id, item.name]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(name.trim());
      }}
    >
      <label>
        Edit name for {item.code}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={160}
          required
          disabled={busy}
        />
      </label>
      <button type="submit" disabled={busy || !name.trim() || name.trim() === item.name}>
        Save name
      </button>
    </form>
  );
};
