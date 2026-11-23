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
  const load = useCallback(async () => {
    const result = await ApiClient.get<CustomerClass[]>('/internal/customer-classes');
    setClasses(result);
    setLoaded(true);
    setError('');
  }, []);
  useEffect(() => {
    let mounted = true;
    if (canView)
      ApiClient.get<CustomerClass[]>('/internal/customer-classes')
        .then((result) => {
          if (mounted) {
            setClasses(result);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (mounted) setError('Customer classes are unavailable.');
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
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => load().catch(() => setError('Customer classes are unavailable.'))}
          >
            Reload
          </button>
        </p>
      )}
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
