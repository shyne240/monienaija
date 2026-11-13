import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Alert,
  Button,
  Field,
  PageHeader,
  ScrollRegion,
  StatusBadge,
} from '../../design-system/primitives';
import { useAuthStore } from '../../store/auth-store';
import {
  InstitutionAdminApi,
  type AttributionGapSummaryRow,
  type InstitutionStatus,
  type InstitutionSummary,
  type InstitutionType,
} from '../../services/institution-admin-api';
import {
  INSTITUTION_FUNCTIONS,
  STATUS_TONES,
  describeError,
  formatTimestamp,
  hasAnyScope,
} from './institution-console-support';
import '../../design-system/tokens.css';
import './institution-console.css';

/**
 * ARENA 4 — institutional directory.
 *
 * Lists the institutions the workforce principal may see (the backend scopes the listing) and
 * offers administrative registration. Two rules are stated in the UI because they are domain
 * invariants, not decoration:
 *   - a recorded licence reference is evidence supplied for verification, never proof of a licence;
 *   - only APPROVED confers financial authority, and approval happens through the governed
 *     lifecycle action decided by an independent checker.
 */

interface InstitutionDirectoryScreenProps {
  onOpenInstitution: (institutionId: string) => void;
}

const STATUS_FILTERS: Array<{ value: 'ALL' | InstitutionStatus; label: string }> = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'REGISTERED', label: 'Registered (no authority)' },
  { value: 'EVIDENCE_SUBMITTED', label: 'Evidence submitted (no authority)' },
  { value: 'APPROVED', label: 'Operationally approved' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'CLOSED', label: 'Closed' },
];

const INSTITUTION_TYPES: InstitutionType[] = [
  'MMO',
  'COMMERCIAL_BANK',
  'MICROFINANCE_BANK',
  'PAYMENT_SERVICE_BANK',
  'PSP',
  'PARTNER',
];

const EMPTY_FORM = {
  reference: '',
  code: '',
  legalName: '',
  displayName: '',
  institutionType: 'MMO' as InstitutionType,
  regulatorName: '',
  licenceReference: '',
};

export const InstitutionDirectoryScreen: React.FC<InstitutionDirectoryScreenProps> = ({
  onOpenInstitution,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canView = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.view);
  const canManage = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.manage) && !principal?.readOnlyPrincipal;
  const canSeeGaps = hasAnyScope(scopes, INSTITUTION_FUNCTIONS.attributionView);

  const [rows, setRows] = useState<InstitutionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | InstitutionStatus>('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [gaps, setGaps] = useState<AttributionGapSummaryRow[] | null>(null);
  const [gapsError, setGapsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await InstitutionAdminApi.listInstitutions();
      setRows(data);
    } catch (error) {
      setRows(null);
      setLoadError(describeError(error, 'Institutions could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    void load();
  }, [canView, load]);

  useEffect(() => {
    if (!canSeeGaps) return;
    let cancelled = false;
    InstitutionAdminApi.attributionGapSummary()
      .then((data) => {
        if (!cancelled) setGaps(data);
      })
      .catch(() => {
        if (!cancelled) setGapsError('Attribution-gap summary is not available to this role.');
      });
    return () => {
      cancelled = true;
    };
  }, [canSeeGaps]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
      if (!term) return true;
      return [row.reference, row.code, row.legalName, row.displayName ?? '', row.regulatorName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      approved: list.filter((row) => row.status === 'APPROVED').length,
      withoutAuthority: list.filter((row) => !row.operationalAuthority).length,
      closed: list.filter((row) => row.status === 'CLOSED').length,
    };
  }, [rows]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || saving) return;
    setFormError(null);
    setFormNotice(null);
    if (!form.reference.trim() || !form.code.trim() || !form.legalName.trim()) {
      setFormError('Reference, code and legal name are required.');
      return;
    }
    setSaving(true);
    try {
      const created = await InstitutionAdminApi.registerInstitution({
        reference: form.reference.trim(),
        code: form.code.trim().toUpperCase(),
        legalName: form.legalName.trim(),
        displayName: form.displayName.trim() || undefined,
        institutionType: form.institutionType,
        regulatorName: form.regulatorName.trim() || undefined,
        licenceReference: form.licenceReference.trim() || undefined,
      });
      setForm({ ...EMPTY_FORM });
      setFormOpen(false);
      setFormNotice(
        `Registered ${created.reference}. The institution holds no financial authority until an independent checker approves its lifecycle.`,
      );
      await load();
    } catch (error) {
      setFormError(describeError(error, 'Registration failed.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <div className="mn-inst">
        <PageHeader title="Institutions" description="Institutional administration" />
        <Alert tone="warning" title="Not available">
          Your workforce principal does not hold <code>institution.view</code>.
        </Alert>
      </div>
    );
  }

  return (
    <div className="mn-inst">
      <PageHeader
        title="Institutions"
        description="Financial institutions, their regulatory evidence and their operational approval state."
        actions={
          canManage ? (
            <Button
              variant={formOpen ? 'secondary' : 'primary'}
              onClick={() => {
                setFormOpen((value) => !value);
                setFormError(null);
                setFormNotice(null);
              }}
            >
              {formOpen ? 'Close registration' : 'Register institution'}
            </Button>
          ) : undefined
        }
      />

      <Alert tone="info" title="Registration is not authorisation">
        A licence reference is evidence recorded for verification, never proof of a valid licence.
        Only an <strong>APPROVED</strong> institution can hold financial authority, and approval is a
        governed lifecycle change decided by a principal other than its requester.
      </Alert>

      {formNotice ? (
        <Alert tone="success" title="Registered">
          {formNotice}
        </Alert>
      ) : null}

      {formOpen && canManage ? (
        <section className="mn-inst__panel" aria-labelledby="mn-inst-register-title">
          <h2 id="mn-inst-register-title" className="mn-inst__panel-title">
            Register institution
          </h2>
          <p className="mn-inst__panel-note">
            Registration records the legal entity. It does not create accounts, affiliations or
            customer enrolments, and it grants no financial authority.
          </p>
          <form className="mn-inst__grid" onSubmit={submit}>
            <Field label="Reference" htmlFor="inst-reference">
              <input
                id="inst-reference"
                className="mn-input"
                value={form.reference}
                maxLength={64}
                onChange={(event) => setForm({ ...form, reference: event.target.value })}
                required
              />
            </Field>
            <Field label="Code" htmlFor="inst-code" hint="Uppercase short code, unique.">
              <input
                id="inst-code"
                className="mn-input"
                value={form.code}
                maxLength={32}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                required
              />
            </Field>
            <Field label="Legal name" htmlFor="inst-legal-name">
              <input
                id="inst-legal-name"
                className="mn-input"
                value={form.legalName}
                maxLength={200}
                onChange={(event) => setForm({ ...form, legalName: event.target.value })}
                required
              />
            </Field>
            <Field label="Display name (optional)" htmlFor="inst-display-name">
              <input
                id="inst-display-name"
                className="mn-input"
                value={form.displayName}
                maxLength={200}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              />
            </Field>
            <Field label="Institution type" htmlFor="inst-type">
              <select
                id="inst-type"
                className="mn-input"
                value={form.institutionType}
                onChange={(event) =>
                  setForm({ ...form, institutionType: event.target.value as InstitutionType })
                }
              >
                {INSTITUTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Regulator (optional)" htmlFor="inst-regulator">
              <input
                id="inst-regulator"
                className="mn-input"
                value={form.regulatorName}
                maxLength={120}
                onChange={(event) => setForm({ ...form, regulatorName: event.target.value })}
              />
            </Field>
            <Field
              label="Licence reference (optional)"
              htmlFor="inst-licence"
              hint="Recorded as unverified evidence. It never activates the institution."
            >
              <input
                id="inst-licence"
                className="mn-input"
                value={form.licenceReference}
                maxLength={120}
                onChange={(event) => setForm({ ...form, licenceReference: event.target.value })}
              />
            </Field>
            <div className="mn-inst__form-actions">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Registering…' : 'Register'}
              </Button>
            </div>
          </form>
          {formError ? (
            <Alert tone="danger" title="Registration failed">
              {formError}
            </Alert>
          ) : null}
        </section>
      ) : null}

      <section className="mn-inst__panel" aria-labelledby="mn-inst-coverage-title">
        <h2 id="mn-inst-coverage-title" className="mn-inst__panel-title">
          Directory coverage
        </h2>
        <p className="mn-inst__panel-note">
          Derived from the institution records listed below for your principal. No figure is
          estimated or extrapolated.
        </p>
        <dl className="mn-inst__stats">
          <div>
            <dt>Institutions in scope</dt>
            <dd>{rows ? totals.total : '—'}</dd>
          </div>
          <div>
            <dt>Operationally approved</dt>
            <dd>{rows ? totals.approved : '—'}</dd>
          </div>
          <div>
            <dt>Without financial authority</dt>
            <dd>{rows ? totals.withoutAuthority : '—'}</dd>
          </div>
          <div>
            <dt>Closed</dt>
            <dd>{rows ? totals.closed : '—'}</dd>
          </div>
        </dl>

        {canSeeGaps ? (
          <div className="mn-inst__gaps">
            <h3 className="mn-inst__subtitle">Unresolved attribution gaps (platform)</h3>
            {gapsError ? (
              <p className="mn-inst__hint">{gapsError}</p>
            ) : gaps === null ? (
              <p className="mn-inst__hint">Loading gap summary…</p>
            ) : gaps.length === 0 ? (
              <p className="mn-inst__hint">
                No unresolved gaps reported by the attribution resolver.
              </p>
            ) : (
              <ul className="mn-inst__gap-list">
                {gaps.map((gap) => (
                  <li key={gap.gapReason}>
                    <span className="mn-inst__gap-reason">{gap.gapReason.replace(/_/g, ' ')}</span>
                    <StatusBadge tone="warning">{gap.agentCount} agent(s)</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
            <p className="mn-inst__hint">
              A gap means the resolver could not attribute an agent to exactly one usable
              institution. Gaps are reported, never filled with a default institution.
            </p>
          </div>
        ) : null}
      </section>

      <section className="mn-inst__panel" aria-labelledby="mn-inst-list-title">
        <div className="mn-inst__list-head">
          <h2 id="mn-inst-list-title" className="mn-inst__panel-title">
            Institutions
          </h2>
          <div className="mn-inst__filters">
            <Field label="Search" htmlFor="inst-search" layout="inline">
              <input
                id="inst-search"
                className="mn-input"
                placeholder="Reference, code, legal name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Field label="Status" htmlFor="inst-status-filter" layout="inline">
              <select
                id="inst-status-filter"
                className="mn-input"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'ALL' | InstitutionStatus)
                }
              >
                {STATUS_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="quiet" onClick={() => void load()} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {loadError ? (
          <Alert tone="danger" title="Could not load institutions">
            {loadError}
          </Alert>
        ) : null}

        {loading && rows === null ? (
          <p className="mn-inst__hint" role="status">
            Loading institutions…
          </p>
        ) : rows && rows.length === 0 ? (
          <div className="mn-inst__empty">
            <p>No institutions are registered in your scope yet.</p>
            {canManage ? (
              <Button variant="primary" onClick={() => setFormOpen(true)}>
                Register the first institution
              </Button>
            ) : null}
          </div>
        ) : rows && filtered.length === 0 ? (
          <div className="mn-inst__empty">
            <p>No institution matches the current search and status filter.</p>
            <Button
              variant="quiet"
              onClick={() => {
                setSearch('');
                setStatusFilter('ALL');
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <ScrollRegion label="Institutions table" hint="Scroll horizontally for all columns.">
            <table className="mn-inst__table">
              <thead>
                <tr>
                  <th scope="col">Institution</th>
                  <th scope="col">Type</th>
                  <th scope="col">Lifecycle</th>
                  <th scope="col">Financial authority</th>
                  <th scope="col">Regulator / evidence</th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className="mn-inst__sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="mn-inst__primary">{row.displayName || row.legalName}</span>
                      <span className="mn-inst__secondary">
                        {row.reference} · {row.code}
                      </span>
                    </td>
                    <td>{row.institutionType.replace(/_/g, ' ')}</td>
                    <td>
                      <StatusBadge tone={STATUS_TONES[row.status]}>
                        {row.status.replace(/_/g, ' ')}
                      </StatusBadge>
                    </td>
                    <td>
                      {row.operationalAuthority ? (
                        <StatusBadge tone="success">Operational authority</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">No financial authority</StatusBadge>
                      )}
                    </td>
                    <td>
                      <span className="mn-inst__secondary">
                        {row.regulatorName || 'Regulator not recorded'}
                      </span>
                      <span className="mn-inst__secondary">
                        {row.evidenceReference
                          ? `Evidence: ${row.evidenceReference}`
                          : 'No evidence reference recorded'}
                      </span>
                    </td>
                    <td className="mn-inst__mono">{formatTimestamp(row.updatedAt)}</td>
                    <td>
                      <Button size="sm" onClick={() => onOpenInstitution(row.id)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}

        {rows && rows.length > 0 ? (
          <p className="mn-inst__hint">
            {filtered.length} of {rows.length} institution(s) shown. Licence references shown here
            are recorded evidence, not verified authorisation.
          </p>
        ) : null}
      </section>
    </div>
  );
};
