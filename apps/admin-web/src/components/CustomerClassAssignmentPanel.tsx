import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient } from '../services/api-client';

interface ClassOption {
  code: string;
  name: string;
  status: string;
  enabled: boolean;
  configurationStatus: string;
}
interface Assignment {
  classCode: string;
  assignmentVersion: number;
  isActive: boolean;
  reason: string | null;
  createdAt: string;
}
interface Effective {
  classCode: string;
  className: string;
  version: number;
}

export const CustomerClassAssignmentPanel: React.FC<{ customerId: string; canManage: boolean }> = ({
  customerId,
  canManage,
}) => {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [effective, setEffective] = useState<Effective | null>(null);
  const [history, setHistory] = useState<Assignment[]>([]);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(
    async (request: number) => {
      const base = `/internal/customers/${encodeURIComponent(customerId)}/class`;
      const [c, e, h] = await Promise.all([
        ApiClient.get<ClassOption[]>('/internal/customer-classes'),
        ApiClient.get<Effective | null>(base),
        ApiClient.get<Assignment[]>(`${base}/history`),
      ]);
      if (request !== generation.current) return;
      setClasses(c);
      setEffective(e);
      setHistory(h);
      setState('ready');
    },
    [customerId],
  );
  useEffect(() => {
    const request = ++generation.current;
    setState('loading');
    setTarget('');
    setReason('');
    setError('');
    load(request).catch(() => {
      if (request === generation.current) {
        setError('Class information is unavailable.');
        setState('error');
      }
    });
    return () => {
      generation.current += 1;
    };
  }, [load, canManage]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || state !== 'ready' || !target || reason.trim().length < 3) return;
    const request = generation.current;
    setState('saving');
    setError('');
    try {
      const current = history.find((item) => item.isActive);
      await ApiClient.post(`/internal/customers/${encodeURIComponent(customerId)}/class`, {
        classCode: target,
        reason: reason.trim(),
        ...(current ? { expectedVersion: current.assignmentVersion } : {}),
      });
      if (request !== generation.current) return;
      setReason('');
      setTarget('');
      await load(request);
    } catch {
      if (request !== generation.current) return;
      setError('Update could not be confirmed. Reload class information before retrying.');
      setState('error');
    }
  };
  return (
    <article className="cm-card cm-card-wide" aria-label="Customer class">
      <h2>Class of service</h2>
      <p className="cm-muted">Customer class is independent of KYC tier.</p>
      {state === 'loading' ? (
        <p>Loading class…</p>
      ) : state === 'error' ? (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            onClick={() => {
              setState('loading');
              const request = generation.current;
              load(request).catch(() => {
                if (request === generation.current) {
                  setState('error');
                  setError('Class information is unavailable.');
                }
              });
            }}
          >
            Reload
          </button>
        </>
      ) : (
        <>
          <p>
            {effective ? `${effective.className} (${effective.classCode})` : 'Unresolved class'}
          </p>
          {canManage && (
            <form onSubmit={submit}>
              <label>
                Target class{' '}
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={state === 'saving'}
                >
                  <option value="">Select class</option>
                  {classes
                    .filter(
                      (c) =>
                        c.enabled &&
                        c.status === 'ACTIVE' &&
                        c.configurationStatus === 'CONFIGURED',
                    )
                    .map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Reason{' '}
                <input
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={state === 'saving'}
                />
              </label>
              <button
                type="submit"
                disabled={state === 'saving' || !target || reason.trim().length < 3}
              >
                {state === 'saving' ? 'Updating…' : 'Assign class'}
              </button>
            </form>
          )}
          <details>
            <summary>Assignment history</summary>
            {history.length ? (
              <ul>
                {history.map((item, i) => (
                  <li key={`${item.createdAt}-${i}`}>
                    {item.classCode} — {item.isActive ? 'Current' : 'Closed'} —{' '}
                    {item.reason || 'No reason recorded'}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No assignments recorded.</p>
            )}
          </details>
        </>
      )}
    </article>
  );
};
