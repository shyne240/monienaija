import React, { useEffect, useRef, useState } from 'react';

import { Button, StatusBadge } from '../../design-system/primitives';
import { WorkspaceDrawer } from '../../design-system/WorkspaceDrawer';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import {
  AUTHORING_CONTRACTS,
  AUTHORING_FIELDS,
  IMMUTABLE_ON_MODIFY,
  authoringActions,
  authoringPath,
  buildAuthoringPayload,
  buildModifyPayload,
  explainChangeState,
  historyActionFor,
  historyQuery,
  type AuthoringDomain,
  type AuthoringFieldSpec,
} from './commercial-authoring-contract';

/** Shape the backend returns from a maker phase. */
interface ChangeRequestReceipt {
  approvalId?: string;
  id?: string;
  status: string;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  expiresAt?: string;
}

interface HistoryEntry {
  approvalId: string;
  actionType: string;
  status: string;
  reason: string;
  requestedAt: string;
  approvedAt: string | null;
  consumedAt: string | null;
  executed: boolean;
}

/**
 * Governed authoring surface for one commercial resource.
 *
 * The drawer performs the MAKER phase and shows the recorded lifecycle. It deliberately has no
 * "save" button that writes a rule directly, because no such governed route exists — and using a
 * direct write would bypass maker/checker separation.
 *
 * Approval and execution stay in the existing approvals screen, which already renders the shared
 * approval inbox and enforces FINANCE_CONTROLLER + MFA. That keeps exactly one implementation of
 * the decision flow.
 */
export const CommercialAuthoringDrawer: React.FC<{
  domain: AuthoringDomain;
  mode: 'create' | 'modify';
  /** Existing row for a modify; omitted for create. */
  record?: Record<string, unknown> | null;
  onClose: () => void;
  onRequested: (receipt: ChangeRequestReceipt) => void;
  onOpenApprovals?: () => void;
}> = ({ domain, mode, record, onClose, onRequested, onOpenApprovals }) => {
  const contract = AUTHORING_CONTRACTS[domain];
  const principal = useAuthStore((state) => state.principal);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    seedValues(domain, mode, record),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [validation, setValidation] = useState('');
  const [receipt, setReceipt] = useState<ChangeRequestReceipt | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const requestId = useRef(0);

  const fields = AUTHORING_FIELDS[domain];
  const immutable = IMMUTABLE_ON_MODIFY[domain];
  const actions = authoringActions({
    domain,
    mode,
    scopes: principal?.scopes ?? [],
    readOnlyPrincipal: principal?.readOnlyPrincipal === true,
  });
  const blocked = contract.capability !== 'GOVERNED_AUTHORING';
  const recordId =
    typeof record?.id === 'string'
      ? record.id
      : typeof record?.code === 'string'
        ? record.code
        : null;
  const version = typeof record?.version === 'number' ? record.version : null;

  const loadHistory = async () => {
    if (!recordId) return;
    const id = ++requestId.current;
    setHistoryError('');
    try {
      const action = historyActionFor(domain, mode);
      const result = await ApiClient.get<{ entries: HistoryEntry[] }>(
        historyQuery(action, recordId),
      );
      if (id === requestId.current) setHistory(result.entries ?? []);
    } catch (err) {
      if (id === requestId.current)
        setHistoryError(
          err && typeof err === 'object' && 'status' in err && err.status === 403
            ? 'The API denied read access to this change history for this session.'
            : `Change history could not be loaded: ${messageOf(err)}`,
        );
    }
  };

  useEffect(() => {
    void loadHistory();
    return () => {
      requestId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, domain, mode]);

  const submit = async () => {
    setError('');
    setValidation('');
    setBusy(true);
    try {
      if (blocked || !contract.createPathTemplate)
        throw new Error(contract.reason ?? 'Authoring is not available for this resource.');
      if (mode === 'modify' && version === null)
        throw new Error(
          'This rule has no readable version, so a governed change cannot be bound to it.',
        );
      const payload =
        mode === 'create'
          ? buildAuthoringPayload(domain, values)
          : buildModifyPayload(domain, values, version as number);
      const path = authoringPath(domain, mode, record, values);
      const result =
        mode === 'create'
          ? await ApiClient.post<ChangeRequestReceipt>(path, payload)
          : await ApiClient.patch<ChangeRequestReceipt>(path, payload);
      const approvalId = result?.approvalId ?? result?.id;
      if (!approvalId || result.status !== 'REQUESTED')
        throw new Error('The API did not return a governed change request.');
      const normalized = { ...result, approvalId };
      setReceipt(normalized);
      onRequested(normalized);
      await loadHistory();
    } catch (err) {
      const text = messageOf(err);
      // Format problems the operator can fix are separated from backend refusals.
      if (/must be|is required|reason of|requires a value/i.test(text)) setValidation(text);
      else setError(text);
    } finally {
      setBusy(false);
    }
  };

  const state = explainChangeState({
    approvalStatus: receipt?.status ?? null,
    effectiveFrom: typeof values.effectiveFrom === 'string' ? values.effectiveFrom : null,
    effectiveTo: typeof values.effectiveTo === 'string' ? values.effectiveTo : null,
    isActive: values.isActive === undefined ? null : values.isActive === true,
  });
  const requestAction = actions.find((action) => action.phase === 'request');

  return (
    <WorkspaceDrawer label={`${contract.resource} authoring`} onDismiss={onClose}>
      <header className="commercial-detail__header">
        <div>
          <p className="commercial-kicker">
            {blocked ? 'READ-ONLY RESOURCE' : 'GOVERNED AUTHORING'}
          </p>
          <h2>
            {mode === 'create' ? 'Propose a new' : 'Propose a change to this'}{' '}
            {contract.resource.toLowerCase()}
          </h2>
        </div>
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      <div className="commercial-detail__body commercial-authoring">
        <div className="commercial-authoring__boundary" role="note">
          <strong>Nothing is written until two people agree</strong>
          <ol>
            <li>
              You submit a <b>proposal</b>. It is fingerprinted with the exact fields below and does
              not change any configuration.
            </li>
            <li>
              A <b>different</b> FINANCE_CONTROLLER approves it in the approvals screen. The maker
              cannot approve their own request, and the decision requires MFA.
            </li>
            <li>
              An authorized executor applies the approved request. Any change to the payload, a
              replay, or a stale version is refused by the API.
            </li>
          </ol>
          <p>{contract.note}</p>
        </div>

        {blocked && (
          <div className="commercial-state commercial-state--error" role="alert">
            <strong>Authoring is unavailable here.</strong>
            <p>{contract.reason}</p>
          </div>
        )}

        {!blocked && requestAction && !requestAction.entitled && (
          <div className="commercial-state commercial-state--error" role="alert">
            {requestAction.unavailableReason}
          </div>
        )}

        {receipt ? (
          <section className="commercial-authoring__receipt" aria-live="polite">
            <h3>Proposal recorded</h3>
            <p>
              Approval <code>{receipt.approvalId}</code> is <b>{state.headline.toLowerCase()}</b>.
            </p>
            <p>{state.detail}</p>
            <dl>
              <div>
                <dt>Governed action</dt>
                <dd>{receipt.actionType}</dd>
              </div>
              <div>
                <dt>Resource</dt>
                <dd>
                  {receipt.resourceType}
                  {receipt.resourceId ? ` · ${receipt.resourceId}` : ' · new'}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge tone="warning" shape="hollow">
                    {receipt.status}
                  </StatusBadge>
                </dd>
              </div>
            </dl>
            {onOpenApprovals && (
              <Button size="sm" onClick={onOpenApprovals}>
                Open the approvals screen
              </Button>
            )}
          </section>
        ) : (
          <form
            className="commercial-authoring__form"
            aria-label={`${contract.resource} ${mode} form`}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {fields.map((field) => {
              const disabled =
                blocked || requestAction?.entitled === false || busy || (mode === 'modify' && immutable.includes(field.key));
              return (
                <AuthoringField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  disabled={disabled}
                  suffix={
                    mode === 'modify' && immutable.includes(field.key)
                      ? 'Immutable after creation — create a new rule instead.'
                      : undefined
                  }
                  onChange={(value) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.key]:
                        field.uppercase && typeof value === 'string' ? value.toUpperCase() : value,
                    }))
                  }
                />
              );
            })}
            {validation && (
              <p className="commercial-authoring__validation" role="alert">
                {validation}
              </p>
            )}
            {error && (
              <p className="commercial-authoring__error" role="alert">
                {error}
              </p>
            )}
            <div className="commercial-authoring__actions">
              <Button
                type="submit"
                size="sm"
                disabled={blocked || busy || requestAction?.entitled === false}
              >
                {busy ? 'Submitting…' : 'Submit for approval'}
              </Button>
              <Button size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {recordId && (
          <section className="commercial-authoring__history" aria-label="Change history">
            <h3>Change history</h3>
            {historyError && (
              <p className="commercial-authoring__error" role="alert">
                {historyError}
              </p>
            )}
            {history === null ? (
              <p>Loading recorded changes…</p>
            ) : history.length === 0 ? (
              <p>
                No governed change has been recorded for this {contract.resource.toLowerCase()} yet.
                Existing configuration may predate governance.
              </p>
            ) : (
              <ol>
                {history.map((entry) => {
                  const explanation = explainChangeState({
                    approvalStatus: entry.status,
                    effectiveFrom: null,
                    effectiveTo: null,
                    isActive: true,
                  });
                  return (
                    <li key={entry.approvalId}>
                      <StatusBadge tone={entry.executed ? 'success' : 'neutral'} shape="square">
                        {explanation.headline}
                      </StatusBadge>{' '}
                      <strong>{entry.actionType}</strong>
                      <p>{entry.reason}</p>
                      <p className="commercial-authoring__meta">
                        Requested <time>{entry.requestedAt}</time>
                        {entry.approvedAt ? ` · approved ${entry.approvedAt}` : ''}
                        {entry.consumedAt ? ` · applied ${entry.consumedAt}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </div>
    </WorkspaceDrawer>
  );
};

const AuthoringField: React.FC<{
  field: AuthoringFieldSpec;
  value: unknown;
  disabled: boolean;
  suffix?: string;
  onChange: (value: unknown) => void;
}> = ({ field, value, disabled, suffix, onChange }) => {
  const id = `authoring-${field.key}`;
  const hint = [field.hint, suffix].filter(Boolean).join(' ');
  const common = {
    id,
    name: field.key,
    disabled,
    'aria-describedby': hint ? `${id}-hint` : undefined,
    required: field.required,
  };
  return (
    <div className="commercial-authoring__field">
      <label htmlFor={id}>
        {field.label}
        {field.required ? ' *' : ''}
      </label>
      {field.type === 'select' ? (
        <select
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Not set</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          {...common}
          rows={3}
          maxLength={500}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.type === 'boolean' ? (
        <input
          {...common}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : (
        <input
          {...common}
          type={
            field.type === 'number'
              ? 'number'
              : field.type === 'date-time'
                ? 'datetime-local'
                : 'text'
          }
          inputMode={field.type === 'number' ? 'numeric' : undefined}
          pattern={field.pattern}
          value={toInputValue(field, value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint && (
        <p id={`${id}-hint`} className="commercial-authoring__hint">
          {hint}
        </p>
      )}
    </div>
  );
};

function toInputValue(field: AuthoringFieldSpec, value: unknown): string {
  if (typeof value !== 'string') return '';
  if (field.type !== 'date-time') return value;
  // datetime-local wants `YYYY-MM-DDTHH:mm`; the payload builder converts back to an ISO instant.
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}`;
}

function seedValues(
  domain: AuthoringDomain,
  mode: 'create' | 'modify',
  record?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (mode === 'create' || !record) return { isActive: true };
  const values: Record<string, unknown> = {};
  for (const field of AUTHORING_FIELDS[domain]) {
    const current = record[field.key];
    if (current !== undefined && current !== null) values[field.key] = current;
  }
  values.isActive = record.isActive === true;
  return values;
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const status = 'status' in error ? (error as { status?: number }).status : undefined;
    const message = 'message' in error ? String((error as { message?: unknown }).message) : '';
    if (status === 401)
      return 'Your session expired or is not authorized. Sign in again; nothing was submitted.';
    if (status === 403)
      return message || 'The API refused this action for your session. Nothing was submitted.';
    if (status === 409)
      return `${message || 'Conflict'} — the record changed since it was loaded. Reload before retrying.`;
    if (status === 503)
      return `${message || 'Service unavailable'} — the governed action is not registered on this deployment.`;
    if (message) return message;
  }
  return error instanceof Error ? error.message : 'The request failed.';
}
