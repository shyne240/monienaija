import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../design-system/primitives';
import {
  Arena4OperationsApi,
  describeHttpError,
  type RoleDefinitionFunctionOption,
  type RoleDefinitionProposal,
} from '../services/arena4-operations-api';

/**
 * ARENA B9 — configurable workforce roles.
 *
 * An authorized SUPER_ADMIN defines a role and selects the catalogue functions it may hold; an
 * independent FINANCE_CONTROLLER approves or rejects the definition; only then can the SUPER_ADMIN
 * apply it to the catalogue. The panel never invents permissions: the function list comes from the
 * same server catalogue the apply path validates against, and the only actions offered are the
 * ones the signed-in session's roles and functions allow.
 *
 * Assignment of an applied role stays in the governed role-change form below this panel, because a
 * definition without a governed assignment would be a policy with no effect.
 */

const STATUS_LABEL: Record<RoleDefinitionProposal['status'], string> = {
  REQUESTED: 'Awaiting independent approval',
  APPROVED: 'Approved — not yet applied',
  APPLIED: 'Applied to the catalogue',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired before a decision',
  FAILED: 'Apply failed — nothing changed',
};

const styles = {
  panel: {
    display: 'grid',
    gap: '1rem',
    padding: '1.25rem',
    border: '1px solid #d7e3dd',
    borderRadius: '14px',
    background: '#ffffff',
  } as React.CSSProperties,
  heading: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '1rem',
    flexWrap: 'wrap' as const,
  },
  title: { margin: 0, fontSize: '1.05rem' } as React.CSSProperties,
  muted: { margin: 0, color: '#5b6b64', fontSize: '0.85rem' } as React.CSSProperties,
  form: {
    display: 'grid',
    gap: '0.75rem',
    padding: '0.9rem',
    borderRadius: '10px',
    background: '#f7faf8',
    border: '1px solid #e2ece7',
  } as React.CSSProperties,
  row: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' as const },
  field: { display: 'grid', gap: '0.25rem', flex: '1 1 220px' } as React.CSSProperties,
  label: { fontSize: '0.78rem', fontWeight: 600, color: '#37413d' } as React.CSSProperties,
  input: {
    padding: '0.5rem 0.6rem',
    borderRadius: '8px',
    border: '1px solid #cbd8d1',
    fontSize: '0.88rem',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  functionList: {
    maxHeight: '190px',
    overflowY: 'auto' as const,
    display: 'grid',
    gap: '0.3rem',
    padding: '0.5rem',
    border: '1px solid #dfe8e3',
    borderRadius: '8px',
    background: '#fff',
  },
  grid: { display: 'grid', gap: '0.6rem' } as React.CSSProperties,
  card: {
    display: 'grid',
    gap: '0.4rem',
    padding: '0.85rem',
    borderRadius: '10px',
    border: '1px solid #e1e9e5',
    background: '#fbfdfc',
  } as React.CSSProperties,
  badge: (tone: 'pending' | 'ok' | 'bad' | 'neutral'): React.CSSProperties => ({
    display: 'inline-block',
    padding: '0.1rem 0.5rem',
    borderRadius: '999px',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.02em',
    background:
      tone === 'pending'
        ? '#fff4d6'
        : tone === 'ok'
          ? '#e2f5ea'
          : tone === 'bad'
            ? '#fde8e6'
            : '#eef2f0',
    color:
      tone === 'pending'
        ? '#7a5b00'
        : tone === 'ok'
          ? '#146c43'
          : tone === 'bad'
            ? '#a3241b'
            : '#4a5651',
  }),
  error: {
    margin: 0,
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    background: '#fdecea',
    color: '#8f2019',
    fontSize: '0.85rem',
  } as React.CSSProperties,
  notice: {
    margin: 0,
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    background: '#eaf5ef',
    color: '#146c43',
    fontSize: '0.85rem',
  } as React.CSSProperties,
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8rem' },
};

const toneFor = (status: RoleDefinitionProposal['status']) =>
  status === 'APPLIED'
    ? ('ok' as const)
    : status === 'REQUESTED' || status === 'APPROVED'
      ? ('pending' as const)
      : status === 'REJECTED' || status === 'FAILED'
        ? ('bad' as const)
        : ('neutral' as const);

export const RoleDefinitionsPanel: React.FC<{
  canDefine: boolean;
  canDecide: boolean;
  canApply: boolean;
}> = ({ canDefine, canDecide, canApply }) => {
  const [functions, setFunctions] = useState<RoleDefinitionFunctionOption[] | null>(null);
  const [proposals, setProposals] = useState<RoleDefinitionProposal[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');

  const [roleKey, setRoleKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [readOnly, setReadOnly] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('');

  const reload = useCallback(async () => {
    setLoadError('');
    try {
      const [functionList, proposalList] = await Promise.all([
        Arena4OperationsApi.roleDefinitionFunctions(),
        Arena4OperationsApi.roleDefinitionProposals(),
      ]);
      setFunctions(functionList);
      setProposals(proposalList);
    } catch (error) {
      setFunctions([]);
      setProposals([]);
      setLoadError(
        describeHttpError(
          error,
          'Role definitions could not be loaded from the catalogue service.',
        ),
      );
    }
  }, []);

  useEffect(() => {
    // Loaded on demand: opening the workspace is an explicit operator action, and a role that
    // only reads assignments should not generate definition-catalogue traffic it cannot use.
    if (open) void reload();
  }, [open, reload]);

  const visibleFunctions = useMemo(() => {
    const list = functions ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (fn) =>
        fn.functionCode.toLowerCase().includes(needle) ||
        fn.name.toLowerCase().includes(needle) ||
        fn.domain.toLowerCase().includes(needle),
    );
  }, [functions, filter]);

  const toggle = (code: string) =>
    setSelected((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError('');
    setActionNotice('');
    if (!roleKey.trim() || !displayName.trim() || !description.trim() || !reason.trim()) {
      setActionError('Role key, display name, description and reason are all required.');
      return;
    }
    if (selected.length === 0) {
      setActionError('Select at least one function for the role.');
      return;
    }
    setBusy(true);
    try {
      const result = await Arena4OperationsApi.submitRoleDefinition({
        proposalType: 'CREATE',
        roleKey: roleKey.trim().toUpperCase(),
        displayName: displayName.trim(),
        description: description.trim(),
        readOnly,
        functionGrants: selected.map((code) => ({
          functionCode: code,
          accessType: readOnly ? 'VIEW' : 'EXECUTE',
        })),
        reason: reason.trim(),
      });
      setActionNotice(
        result.proposal.status === 'REQUESTED'
          ? `Proposal ${result.proposal.targetRoleKey} submitted. An independent checker must decide it before it can be applied.`
          : `Proposal ${result.proposal.targetRoleKey} recorded as ${result.proposal.status}.`,
      );
      setRoleKey('');
      setDisplayName('');
      setDescription('');
      setSelected([]);
      setReason('');
      await reload();
    } catch (error) {
      setActionError(
        describeHttpError(error, 'The role definition proposal was not accepted by the server.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(true);
    setActionError('');
    setActionNotice('');
    try {
      const result = await Arena4OperationsApi.decideRoleDefinition(
        id,
        decision,
        decision === 'approve'
          ? 'Reviewed the requested functions and their sensitivity.'
          : 'Rejected: the requested functions are not appropriate for this role.',
      );
      setActionNotice(
        `Proposal ${result.proposal.targetRoleKey} recorded as ${result.proposal.status}.`,
      );
      await reload();
    } catch (error) {
      setActionError(
        describeHttpError(error, 'The decision was not accepted — re-read the proposal state.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = async (id: string) => {
    setBusy(true);
    setActionError('');
    setActionNotice('');
    try {
      const result = await Arena4OperationsApi.applyRoleDefinition(id);
      setActionNotice(
        result.success
          ? `Role ${result.proposal.targetRoleKey} applied. It can now be assigned through the governed role-change form below.`
          : `Apply did not complete: ${result.reason ?? result.proposal.status}. Nothing was changed.`,
      );
      await reload();
    } catch (error) {
      setActionError(
        describeHttpError(error, 'The approved definition was not applied — re-read its state.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={styles.panel} data-testid="role-definitions-panel">
      <div style={styles.heading}>
        <div>
          <h2 style={styles.title}>Configurable roles</h2>
          <p style={styles.muted}>
            Define a role from the function catalogue, have it approved by an independent checker,
            then apply it. Applying a definition does not grant it to anyone.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen((current) => !current)}
            data-testid="rd-open"
          >
            {open ? 'Hide configurable roles' : 'Open configurable roles'}
          </Button>
          {open ? (
            <Button type="button" variant="secondary" onClick={() => void reload()} disabled={busy}>
              Refresh definitions
            </Button>
          ) : null}
        </div>
      </div>

      {loadError ? (
        <p style={styles.error} role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p style={styles.error} role="alert">
          {actionError}
        </p>
      ) : null}
      {actionNotice ? (
        <p style={styles.notice} role="status">
          {actionNotice}
        </p>
      ) : null}

      {!open ? (
        <p style={styles.muted} data-testid="rd-closed">
          Configurable roles are closed. Opening the workspace loads the function catalogue and the
          current definitions; nothing is requested until you open it.
        </p>
      ) : null}
      {open && canDefine ? (
        <form style={styles.form} onSubmit={submit} data-testid="role-definition-form">
          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="rd-role-key">
                Role key
              </label>
              <input
                id="rd-role-key"
                style={styles.input}
                value={roleKey}
                onChange={(event) => setRoleKey(event.target.value.toUpperCase())}
                placeholder="e.g. SOC_ANALYST"
                disabled={busy}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="rd-display-name">
                Display name
              </label>
              <input
                id="rd-display-name"
                style={styles.input}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="e.g. SOC Analyst"
                disabled={busy}
              />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="rd-description">
              Description
            </label>
            <input
              id="rd-description"
              style={styles.input}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this role is for, in one sentence"
              disabled={busy}
            />
          </div>
          <label style={{ ...styles.label, display: 'flex', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(event) => setReadOnly(event.target.checked)}
              disabled={busy}
            />
            Read-only role (only READ-sensitivity functions may be granted)
          </label>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="rd-function-filter">
              Permitted functions ({selected.length} selected)
            </label>
            <input
              id="rd-function-filter"
              style={styles.input}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by code, name or domain"
              disabled={busy}
            />
            <div style={styles.functionList} data-testid="rd-function-list">
              {functions === null ? (
                <p style={styles.muted}>Loading the function catalogue…</p>
              ) : visibleFunctions.length === 0 ? (
                <p style={styles.muted}>
                  No function matches this filter. The catalogue offers no assignable function for
                  this search.
                </p>
              ) : (
                visibleFunctions.map((fn) => (
                  <label
                    key={fn.functionCode}
                    style={{ display: 'flex', gap: '0.45rem', fontSize: '0.82rem' }}
                    data-testid={`rd-function-${fn.functionCode}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(fn.functionCode)}
                      onChange={() => toggle(fn.functionCode)}
                      disabled={busy}
                    />
                    <span>
                      <code style={styles.code}>{fn.functionCode}</code> — {fn.name}{' '}
                      <span style={styles.muted}>
                        ({fn.domain}, {fn.sensitivity})
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="rd-reason">
              Reason for the definition
            </label>
            <input
              id="rd-reason"
              style={styles.input}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Recorded on the proposal and its audit trail"
              disabled={busy}
            />
          </div>
          <Button type="submit" disabled={busy} data-testid="rd-submit">
            {busy ? 'Submitting…' : 'Submit definition for approval'}
          </Button>
        </form>
      ) : null}
      {open && !canDefine ? (
        <p style={styles.muted} data-testid="rd-no-authoring">
          Your session cannot author role definitions. Only SUPER_ADMIN holds the initiating
          function; a FINANCE_CONTROLLER decides them independently.
        </p>
      ) : null}

      {open ? (
        <div style={styles.grid} data-testid="rd-proposals">
          {proposals === null ? (
            <p style={styles.muted}>Loading role definitions…</p>
          ) : proposals.length === 0 ? (
            <p style={styles.muted}>
              No role definition has been proposed yet. A definition is not a grant: nothing changes
              until an approved definition is applied and then assigned.
            </p>
          ) : (
            proposals.map((proposal) => (
              <article
                key={proposal.id}
                style={styles.card}
                data-testid={`rd-proposal-${proposal.id}`}
              >
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: '0.92rem' }}>{proposal.targetRoleKey}</strong>
                  <span style={styles.badge(toneFor(proposal.status))}>
                    {STATUS_LABEL[proposal.status]}
                  </span>
                </div>
                <p style={styles.muted}>
                  {proposal.proposedDisplayName} · {proposal.proposalType}
                  {proposal.proposedReadOnly ? ' · read-only' : ''}
                </p>
                <p style={styles.muted}>
                  Functions:{' '}
                  {proposal.proposedFunctionGrants.length === 0
                    ? 'none'
                    : proposal.proposedFunctionGrants
                        .map((grant) => `${grant.functionCode} (${grant.accessType})`)
                        .join(', ')}
                </p>
                <p style={styles.muted}>
                  Requested {new Date(proposal.requestedAt).toISOString()} · expires{' '}
                  {new Date(proposal.expiresAt).toISOString()}
                  {proposal.decisionReason ? ` · decision: ${proposal.decisionReason}` : ''}
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {proposal.status === 'REQUESTED' && canDecide ? (
                    <>
                      <Button
                        type="button"
                        onClick={() => void decide(proposal.id, 'approve')}
                        disabled={busy}
                        data-testid={`rd-approve-${proposal.id}`}
                      >
                        Approve definition
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void decide(proposal.id, 'reject')}
                        disabled={busy}
                        data-testid={`rd-reject-${proposal.id}`}
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {proposal.status === 'REQUESTED' && !canDecide ? (
                    <p style={styles.muted}>
                      Awaiting an independent checker. The proposer can never decide its own
                      definition.
                    </p>
                  ) : null}
                  {proposal.status === 'APPROVED' && canApply ? (
                    <Button
                      type="button"
                      onClick={() => void apply(proposal.id)}
                      disabled={busy}
                      data-testid={`rd-apply-${proposal.id}`}
                    >
                      Apply to catalogue
                    </Button>
                  ) : null}
                  {proposal.status === 'APPLIED' ? (
                    <p style={styles.notice}>
                      Applied. Assign it to a workforce user in the governed role-change form below.
                    </p>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
};
