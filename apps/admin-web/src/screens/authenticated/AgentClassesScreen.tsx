import './operational-surfaces.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../design-system/primitives';
import { WorkspaceFilterTabs } from '../../design-system/WorkspaceDrawer';
import './agent-classes-workspace.css';

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

export const AgentClassesScreen: React.FC<{onClassGuardChange?: (guarded: boolean, busy: boolean) => void}> = ({onClassGuardChange}) => {
  const { principal, sessionId } = useAuthStore();
  const hasFunction = (functionCode: string) => Boolean(principal && ['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) && principal.scopes.includes(functionCode));
  const canView = hasFunction('agent.view');
  const canManage = hasFunction('agent.manage_classes') && !principal?.readOnlyPrincipal;
  const canViewLimits = hasFunction('limit.view');
  const canModifyLimits = hasFunction('limit.modify') && !principal?.readOnlyPrincipal;

  const key = JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <AgentClassesWorkspace key={key} canView={canView} canManage={canManage} canViewLimits={canViewLimits} canModifyLimits={canModifyLimits} onClassGuardChange={onClassGuardChange} />;
};

const AgentClassesWorkspace: React.FC<{canView: boolean; canManage: boolean; canViewLimits: boolean; canModifyLimits: boolean; onClassGuardChange?: (guarded: boolean, busy: boolean) => void}> = ({canView, canManage, canViewLimits, canModifyLimits, onClassGuardChange}) => {
  const listGeneration = useRef(0);
  const limitGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const mutationLock = useRef(false);
  const formBaseline = useRef<AgentClassForm>(EMPTY_FORM);
  const [pendingNavigation, setPendingNavigation] = useState<AgentClassRecord | 'create' | 'close' | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const navigationTrigger = useRef<HTMLElement | null>(null);
  const restoreNavigationFocus = useRef(false);
  const [classUnconfirmed, setClassUnconfirmed] = useState(false);
  const [classNeedsRefresh, setClassNeedsRefresh] = useState(false);
  const [limitUnconfirmedClassId, setLimitUnconfirmedClassId] = useState<string | null>(null);
  useEffect(() => { if (pendingNavigation) keepEditingRef.current?.focus(); else if (restoreNavigationFocus.current) { restoreNavigationFocus.current = false; navigationTrigger.current?.focus(); } }, [pendingNavigation]);
  useEffect(() => () => { listGeneration.current += 1; limitGeneration.current += 1; mutationGeneration.current += 1; }, []);
  const [items, setItems] = useState<AgentClassRecord[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<AgentClassRecord | null>(null);
  const [form, setForm] = useState<AgentClassForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [message, setMessage] = useState('');

  // Agent class limit assignments state (limit.view read / limit.modify write)
  const [classLimitsLoaded, setClassLimitsLoaded] = useState(false);
  const [classLimitsLoading, setClassLimitsLoading] = useState(false);
  const [classLimitsBusy, setClassLimitsBusy] = useState(false);
  const [classLimitsError, setClassLimitsError] = useState('');
  const [classLimitsMsg, setClassLimitsMsg] = useState('');
  const [classLimits, setClassLimits] = useState<ClassLimitAssignmentRecord[]>([]);
  const [classLimitsPage, setClassLimitsPage] = useState<{ page: number; total: number; totalPages: number; hasNextPage: boolean } | null>(null);
  const [classLimitProfileCode, setClassLimitProfileCode] = useState('');
  const classBusy = saving || classLimitsBusy;
  const classGuard = classBusy || classUnconfirmed || Boolean(limitUnconfirmedClassId) || Boolean(classLimitProfileCode.trim()) || ((creating || Boolean(selected)) && JSON.stringify(form) !== JSON.stringify(formBaseline.current));
  useEffect(() => { onClassGuardChange?.(classGuard, classBusy); }, [onClassGuardChange, classGuard, classBusy]);
  useEffect(() => () => onClassGuardChange?.(false, false), [onClassGuardChange]);
  useEffect(() => {
    if (!classGuard) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [classGuard]);


  const resetClassLimitsState = () => {
    limitGeneration.current += 1;
    mutationGeneration.current += 1;
    setClassLimitsLoading(false);
    setClassLimitsLoaded(false);
    setClassLimits([]);
    setClassLimitsPage(null);
    setClassLimitsError('');
    setClassLimitsMsg('');
    setClassLimitProfileCode('');
  };

  const loadClasses = useCallback(async () => {
    if (!canView) return;
    const request = ++listGeneration.current;
    setLoading(true); setListError('');
    try {
      const response: unknown = await ApiClient.get('/internal/agents/classes');
      const rows = Array.isArray(response) ? response : (response as { data?: unknown } | null)?.data;
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.id !== 'string' || typeof row.reference !== 'string' || typeof row.code !== 'string' || typeof row.name !== 'string' || typeof row.isActive !== 'boolean' || !Number.isSafeInteger(row.version) || row.version < 1)) throw new Error('Invalid Agent class catalogue response.');
      if (request === listGeneration.current) { setItems(rows as AgentClassRecord[]); setClassNeedsRefresh(false); }
    } catch (loadError) {
      if (request === listGeneration.current) { setItems([]); setListError(loadError instanceof Error ? loadError.message : 'Failed to load Agent classes.'); }
    } finally {
      if (request === listGeneration.current) setLoading(false);
    }
  }, [canView]);

  useEffect(() => { if (canView) void loadClasses(); }, [canView, loadClasses]);

  const applyChooseClass = (agentClass: AgentClassRecord) => {
    setSelected(agentClass);
    setCreating(false);
    const next = toForm(agentClass);
    formBaseline.current = next;
    setForm(next);
    setError('');
    setMessage('');
    resetClassLimitsState();
  };

  const applyStartCreate = () => {
    formBaseline.current = EMPTY_FORM;
    setSelected(null);
    setCreating(true);
    setForm(EMPTY_FORM);
    setError('');
    setMessage('');
    resetClassLimitsState();
  };

  const navigateEditor = (target: AgentClassRecord | 'create' | 'close') => {
    if (mutationLock.current || saving || classLimitsBusy || pendingNavigation || ((classNeedsRefresh || classUnconfirmed) && target !== 'close')) return;
    if ((creating || selected) && (JSON.stringify(form) !== JSON.stringify(formBaseline.current) || Boolean(classLimitProfileCode.trim()) || classUnconfirmed)) {
      navigationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingNavigation(target);
      return;
    }
    applyNavigation(target);
  };

  const applyNavigation = (target: AgentClassRecord | 'create' | 'close') => {
    setPendingNavigation(null);
    if (target === 'close') { setCreating(false); setSelected(null); setForm(EMPTY_FORM); resetClassLimitsState(); return; }
    if (classNeedsRefresh || classUnconfirmed) return;
    if (target === 'create') applyStartCreate();
    else {
      const current = items.find(item => item.id === target.id && item.version === target.version);
      if (!current) { setError('Catalogue changed; choose the current class again.'); return; }
      applyChooseClass(current);
    }
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

  const loadClassLimitAssignments = async (agentClassId: string, page = 1) => {
    if (!canViewLimits || classLimitsLoading) return;
    const request = ++limitGeneration.current;
    setClassLimitsLoading(true); setClassLimitsLoaded(false); setClassLimits([]); setClassLimitsPage(null);
    setClassLimitsError('');
    try {
      const res: any = await ApiClient.get(
        `/internal/limit-assignments/agent-class/${encodeURIComponent(agentClassId)}?page=${page}&limit=20`,
      );
      if (!res || res.page !== page || !Number.isSafeInteger(res.limit) || res.limit < 1 ||
          !Number.isSafeInteger(res.total) || res.total < 0 || !Number.isSafeInteger(res.totalPages) ||
          res.totalPages !== Math.ceil(res.total / res.limit) || res.hasNextPage !== (page < res.totalPages) ||
          !Array.isArray(res.data) || res.data.length > res.limit ||
          res.data.some((row: any) => !row || typeof row.id !== 'string' || !row.id.trim() ||
            typeof row.limitProfileCode !== 'string' || !row.limitProfileCode.trim() ||
            row.subjectType !== 'AGENT_CLASS' || row.subjectId !== agentClassId || typeof row.isActive !== 'boolean')) {
        throw new Error('Invalid Agent class limit assignments response.');
      }
      if (request !== limitGeneration.current) return;
      setClassLimits(res.data);
      setClassLimitsPage({ page, total: res.total, totalPages: res.totalPages, hasNextPage: res.hasNextPage });
      setClassLimitsLoaded(true);
    } catch (err: any) {
      if (request === limitGeneration.current) setClassLimitsError(err?.message || 'Failed to load Agent class limit assignments.');
    } finally {
      if (request === limitGeneration.current) setClassLimitsLoading(false);
    }
  };

  const matchesLimitReceipt = (row: any, classId: string, code: string, active: boolean, id?: string, version?: number) =>
    row && typeof row.id === 'string' && !!row.id.trim() && (!id || row.id === id) &&
    row.subjectType === 'AGENT_CLASS' && row.subjectId === classId && row.limitProfileCode === code &&
    row.isActive === active && Number.isSafeInteger(row.version) && row.version > (version ?? 0);

  const assignClassLimitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !canModifyLimits || classLimitsBusy || saving || classLimitsLoading || (Boolean(limitUnconfirmedClassId) || classUnconfirmed) || mutationLock.current || pendingNavigation) return;
    const code = classLimitProfileCode.trim().toUpperCase();
    if (!/^[A-Z0-9_]{3,80}$/.test(code)) {
      setClassLimitsError(
        'Limit profile code must be 3–80 uppercase letters, digits, or underscores (e.g. AGENT_CLASS_STANDARD).',
      );
      return;
    }
    const request = ++mutationGeneration.current;
    mutationLock.current = true;
    setClassLimitsBusy(true);
    setClassLimitsError('');
    setClassLimitsMsg('');
    try {
      const receipt = await ApiClient.post('/internal/limit-assignments', {
        subjectType: 'AGENT_CLASS',
        subjectId: selected.id,
        limitProfileCode: code,
      });
      if (request !== mutationGeneration.current) return;
      if (!matchesLimitReceipt(receipt, selected.id, code, true)) throw new Error('Unconfirmed class limit assignment receipt.');
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
      if (request === mutationGeneration.current) { setClassLimitsLoaded(false); setClassLimits([]); setClassLimitsPage(null); setLimitUnconfirmedClassId(selected.id); setClassLimitsError('The assignment outcome could not be confirmed. Review the class limits before retrying.'); }
    } finally {
      mutationLock.current = false;
      if (request === mutationGeneration.current) setClassLimitsBusy(false);
    }
  };

  const toggleClassLimitAssignment = async (assignment: ClassLimitAssignmentRecord) => {
    if (!selected || !canModifyLimits || classLimitsBusy || saving || classLimitsLoading || (Boolean(limitUnconfirmedClassId) || classUnconfirmed) || mutationLock.current || pendingNavigation || !Number.isSafeInteger(assignment.version) || (assignment.version ?? 0) < 1) return;
    const request = ++mutationGeneration.current;
    mutationLock.current = true;
    setClassLimitsBusy(true);
    setClassLimitsError('');
    setClassLimitsMsg('');
    try {
      const receipt = await ApiClient.patch(`/internal/limit-assignments/${encodeURIComponent(assignment.id)}`, {
        subjectType: 'AGENT_CLASS',
        isActive: !assignment.isActive,
        version: assignment.version,
      });
      if (request !== mutationGeneration.current) return;
      if (!matchesLimitReceipt(receipt, selected.id, assignment.limitProfileCode, !assignment.isActive, assignment.id, assignment.version)) throw new Error('Unconfirmed class limit update receipt.');
      setClassLimitsMsg(
        `Class limit ${assignment.limitProfileCode} ${assignment.isActive ? 'deactivated' : 'activated'}.`,
      );
      if (canViewLimits) {
        await loadClassLimitAssignments(selected.id, classLimitsPage?.page ?? 1);
      }
    } catch (err: any) {
      if (request === mutationGeneration.current) { setClassLimitsLoaded(false); setClassLimits([]); setClassLimitsPage(null); setLimitUnconfirmedClassId(selected.id); setClassLimitsError('The update outcome could not be confirmed. Reload class limits and inspect the assignment before retrying.'); }
    } finally {
      mutationLock.current = false;
      if (request === mutationGeneration.current) setClassLimitsBusy(false);
    }
  };

  const selectedStale = Boolean(selected && !creating && (!items.find(item => item.id === selected.id) || items.find(item => item.id === selected.id)?.version !== selected.version));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || saving || classLimitsBusy || classLimitsLoading || loading || !!listError || selectedStale || classUnconfirmed || Boolean(limitUnconfirmedClassId) || mutationLock.current || pendingNavigation) return;
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

    const request = ++mutationGeneration.current;
    let writeStarted = false;
    mutationLock.current = true;
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
        writeStarted = true;
        const created = await ApiClient.post<AgentClassRecord>('/internal/agents/classes', body);
        if (request !== mutationGeneration.current) return;
        if (!created || typeof created.id !== 'string' || !created.id.trim() || typeof created.reference !== 'string' || !created.reference.trim() || typeof created.code !== 'string' || !created.code.trim() || created.name !== form.name.trim() || created.isActive !== form.isActive || !Number.isSafeInteger(created.version) || created.version < 1 || (form.reference.trim() && created.reference !== form.reference.trim()) || (form.code.trim() && created.code !== form.code.trim())) throw new Error('Class creation response is incomplete.');
        setMessage(
          `Agent class ${created.reference} created. New classes start inactive unless explicitly activated.`,
        );
        setSelected(created);
        setCreating(false);
        formBaseline.current = toForm(created);
        setForm(formBaseline.current);
        await loadClasses();
      } else if (selected) {
        writeStarted = true;
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
        if (request !== mutationGeneration.current) return;
        if (!updated || updated.id !== selected.id || updated.reference !== selected.reference || updated.code !== selected.code || updated.name !== form.name.trim() || updated.isActive !== form.isActive || !Number.isSafeInteger(updated.version) || updated.version <= selected.version) throw new Error('Class update response is incomplete.');
        setMessage(`Agent class ${updated.reference} saved at version ${updated.version}.`);
        setSelected(updated);
        formBaseline.current = toForm(updated);
        setForm(formBaseline.current);
        await loadClasses();
      }
    } catch (saveError) {
      if (request === mutationGeneration.current && writeStarted) { listGeneration.current++; setLoading(false); setClassUnconfirmed(true); setClassNeedsRefresh(true); }
      if (request === mutationGeneration.current) setError(
        `${saveError instanceof Error ? saveError.message : 'Unable to save Agent class.'} ` +
          'If the response was lost, refresh the list and inspect the class before retrying.',
      );
    } finally {
      mutationLock.current = false;
      if (request === mutationGeneration.current) setSaving(false);
    }
  };

  if (!canView) {
    return (
      <div className="mn-operational" style={styles.wrap} role="alert">
        <div style={styles.error}>
          Agent class listing requires <code>agent.view</code>. Editing also requires{' '}
          <code>agent.manage_classes</code>.
        </div>
      </div>
    );
  }

  const matchingItems = items.filter(item => {
    const query = search.trim().toLocaleLowerCase();
    return (statusFilter === 'all' || item.isActive === (statusFilter === 'active')) &&
      (!query || [item.reference, item.code, item.name].some(value => value.toLocaleLowerCase().includes(query)));
  });

  return (
    <div className="mn-operational mn-agent-classes" style={styles.wrap}>
      <PageHeader eyebrow="Agent network" title="Agent classes & service eligibility" description="Review class configuration and manage it only with the dedicated authorization function." actions={
        <div style={styles.headerActions}>
          <button type="button" onClick={() => void loadClasses()} style={styles.secondaryButton} disabled={loading || saving || classLimitsBusy || Boolean(pendingNavigation)}>Refresh</button>
          {canManage && <button type="button" onClick={() => navigateEditor('create')} style={styles.primaryButton} disabled={loading || saving || classLimitsBusy || !!listError || classNeedsRefresh || classUnconfirmed || Boolean(pendingNavigation)}>Create class</button>}
        </div>
      } />

      <div style={styles.notice} role="note">
        Class fields are policy-bearing configuration. Applicable services are restricted to validated canonical Ordinary Agent V1 service identifiers; leaving all services unchecked saves <code>null</code>. Blank JSON fields are saved as <code>null</code>; no capability or regulatory defaults are supplied. New classes default to inactive; activation must be selected explicitly.
      </div>
      {!canManage && (
        <div
          style={styles.governanceBanner}
          role="note"
          data-testid="agent-classes-readonly-governance"
        >
          <strong>Read-Only Governance Mode:</strong> Your session is read-only or lacks <code>agent.manage_classes</code>. Class catalogue creation and editing require{' '}
          <code>agent.manage_classes</code> (granted to <code>AGENT_NETWORK_MANAGER</code> and{' '}
          <code>SUPER_ADMIN</code>).
        </div>
      )}
      {classUnconfirmed && <div style={styles.warningBox} role="status">The last class outcome is unconfirmed or conflicted. Refresh the catalogue and independently inspect class records and available audit history before acting again. A fresh catalogue or missing record cannot exclude a late commit. The local review lock is lost on confirmed exit or session change.
        {!classNeedsRefresh && !loading && !listError && <button type="button" style={styles.smallButton} onClick={() => { if ((creating || selected) && !window.confirm('Acknowledge review and discard the local class editor? Copy any needed entries before continuing.')) return; setCreating(false); setSelected(null); setForm(EMPTY_FORM); formBaseline.current = EMPTY_FORM; resetClassLimitsState(); setError(''); setClassUnconfirmed(false); }}>I reviewed the class and audit history</button>}
      </div>}
      {listError && <div style={styles.error} role="alert">Agent class catalogue unavailable: {listError}. Draft values remain in this workspace; refresh before taking action.</div>}
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

      <div className="mn-agent-class-catalogue-header">
        <div><p>CLASS GOVERNANCE</p><h2>Class catalogue</h2><span>Review services, configuration and version before making changes.</span></div>
        {!loading && !listError && <span className="mn-agent-class-count">{matchingItems.length} of {items.length} {items.length === 1 ? 'class' : 'classes'} shown</span>}
      </div>
      <div className="mn-agent-class-filters">
        <WorkspaceFilterTabs label="Class state" value={statusFilter} options={[{value:'all',label:'All classes'},{value:'active',label:'Active'},{value:'inactive',label:'Inactive'}]} onChange={setStatusFilter} />
        <label>Search returned classes<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Reference, code or name" /></label>
      </div>
      {loading ? (
        <div style={styles.loading}>Loading Agent classes…</div>
      ) : listError ? null : items.length === 0 ? (
        <div style={styles.empty}>No Agent classes returned by the authorized API.</div>
      ) : matchingItems.length === 0 ? (
        <div style={styles.empty}>No returned classes match these filters.</div>
      ) : (
        <div style={styles.tableWrap} role="region" aria-label="Agent classes" tabIndex={0}>
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
              {matchingItems.map((item) => (
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
                      onClick={() => navigateEditor(item)}
                      disabled={saving || classLimitsBusy || classNeedsRefresh || classUnconfirmed || Boolean(pendingNavigation)}
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

      {!loading && !listError && (creating || selected) && (
        <section
          className="mn-agent-class-editor"
          style={styles.editor}
          aria-label={creating ? 'Create Agent class' : 'Agent class details'}
        >
          <div style={styles.editorHeader}>
            <div><p className="mn-agent-class-editor-eyebrow">{creating ? 'NEW CONFIGURATION' : 'CLASS CONFIGURATION'}</p>
            <h3 style={styles.sectionTitle}>
              {creating ? 'Create Agent class' : `${selected?.reference} — configuration`}
            </h3><p className="mn-agent-class-editor-note">Changes remain local until saved. Review policy-bearing fields before submitting.</p></div>
            <button
              type="button"
              style={styles.secondaryButton}
              disabled={saving || classLimitsBusy || Boolean(pendingNavigation)}
              onClick={() => navigateEditor('close')}
            >
              Close
            </button>
          </div>
          {pendingNavigation && <div role="group" aria-label="Discard class changes" style={styles.warningBox}>
            <p>Discard the local class changes? Saved changes remain in the catalogue. Inspect a refreshed catalogue after an unconfirmed outcome.</p>
            <button ref={keepEditingRef} type="button" style={styles.secondaryButton} onClick={() => { restoreNavigationFocus.current = true; setPendingNavigation(null); }}>Keep editing</button>{' '}
            <button type="button" style={styles.secondaryButton} onClick={() => applyNavigation(pendingNavigation)}>Discard changes</button>
          </div>}

          {selectedStale && <div style={styles.warningBox} role="alert">The catalogue has changed or this class is no longer listed. Your draft is retained; review and reselect the current class before saving. Reselecting replaces the draft.</div>}
          {canManage ? (
            <form onSubmit={save} style={styles.form}>
              <fieldset disabled={saving || Boolean(pendingNavigation)} className="mn-agent-class-fields">
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
              <button type="submit" style={styles.primaryButton} disabled={saving || classLimitsBusy || classLimitsLoading || selectedStale || classUnconfirmed || Boolean(limitUnconfirmedClassId) || Boolean(pendingNavigation)}>
                {saving ? 'Saving…' : creating ? (form.isActive ? 'Create active class' : 'Create inactive class') : 'Save class'}
              </button>
              </fieldset>
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
                    disabled={classLimitsLoading || classLimitsBusy || saving}
                    onClick={() => void loadClassLimitAssignments(selected.id, classLimitsPage?.page ?? 1)}
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

              {limitUnconfirmedClassId && <div role="status" style={styles.warningBox}>
                A class limit outcome is unconfirmed for class <code>{limitUnconfirmedClassId}</code>. Inspect the relevant assignments and available audit history before further writes. A page or fresh read cannot prove absence or exclude a late commit. The local lock is lost on confirmed exit or session change. If you cannot view limits, use an independently authorized reviewer.
                {selected.id === limitUnconfirmedClassId && ((canViewLimits && classLimitsLoaded) || !canViewLimits) && <div><button type="button" style={styles.smallButton} onClick={() => setLimitUnconfirmedClassId(null)}>I reviewed the class limits and audit history</button></div>}
              </div>}
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
                      {classLimitsPage?.total === 0
                        ? <>No <code>AGENT_CLASS</code> limit assignments configured for <code>{selected.reference}</code>.</>
                        : 'No assignments on this page. Return to an earlier page to review current results.'}
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
                            · {Number.isSafeInteger(assignment.version) && (assignment.version ?? 0) > 0 ? `v${assignment.version}` : 'version unavailable'}
                          </span>
                          {canModifyLimits && (
                            <button
                              type="button"
                              style={styles.smallButton}
                              disabled={classLimitsBusy || classLimitsLoading || saving || (Boolean(limitUnconfirmedClassId) || classUnconfirmed) || Boolean(pendingNavigation) || !Number.isSafeInteger(assignment.version) || (assignment.version ?? 0) < 1}
                              title={!Number.isSafeInteger(assignment.version) || (assignment.version ?? 0) < 1 ? 'Version unavailable; refresh before changing this assignment.' : undefined}
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
                  {classLimitsPage && (classLimitsPage.totalPages > 1 || classLimitsPage.page > 1) && (
                    <nav aria-label="Class limit assignment pages" style={styles.inlineLimitForm}>
                      <button type="button" style={styles.smallButton} disabled={classLimitsPage.page <= 1 || classLimitsBusy || saving} onClick={() => void loadClassLimitAssignments(selected.id, classLimitsPage.page - 1)}>Previous</button>
                      <span>Page {classLimitsPage.page} of {Math.max(classLimitsPage.totalPages, 1)} · {classLimitsPage.total} assignments</span>
                      <button type="button" style={styles.smallButton} disabled={!classLimitsPage.hasNextPage || classLimitsBusy || saving} onClick={() => void loadClassLimitAssignments(selected.id, classLimitsPage.page + 1)}>Next</button>
                    </nav>
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
                    disabled={classLimitsBusy || classLimitsLoading || saving}
                  />
                  <button
                    type="submit"
                    style={styles.smallButton}
                    disabled={classLimitsBusy || classLimitsLoading || saving || (Boolean(limitUnconfirmedClassId) || classUnconfirmed) || Boolean(pendingNavigation)}
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
  wrap: { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1250, color: 'var(--mn-text-primary, #132b25)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  title: { margin: '0 0 6px', color: 'var(--mn-nav-surface-deep, #082f23)', fontSize: 22 },
  subtitle: { margin: 0, color: 'var(--mn-text-secondary, #52655f)', fontSize: 13 },
  headerActions: { display: 'flex', gap: 8 },
  notice: { margin: '18px 0', padding: 12, border: '1px solid #FCD34D', borderRadius: 8, background: '#FFFBEB', color: '#78350F', fontSize: 13, lineHeight: 1.5 },
  governanceBanner: { margin: '0 0 12px', padding: 11, border: '1px solid #BFDBFE', borderRadius: 8, background: '#EFF6FF', color: '#1E3A8A', fontSize: 12, lineHeight: 1.5 },
  warningBox: { margin: '0 0 12px', padding: 11, border: '1px solid #FDBA74', borderRadius: 8, background: '#FFF7ED', color: '#9A3412', fontSize: 12, lineHeight: 1.5 },
  primaryButton: { padding: '9px 14px', border: '1px solid var(--mn-action-primary, #0b624a)', borderRadius: 6, color: '#fff', background: 'var(--mn-action-primary, #0b624a)', cursor: 'pointer', fontWeight: 700 },
  secondaryButton: { padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: 'var(--mn-text-primary, #132b25)', cursor: 'pointer' },
  smallButton: { padding: '5px 9px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 12 },
  error: { padding: 11, marginBottom: 12, border: '1px solid #FCA5A5', borderRadius: 6, background: '#FEF2F2', color: '#991B1B', fontSize: 13 },
  success: { padding: 11, marginBottom: 12, border: '1px solid #6EE7B7', borderRadius: 6, background: '#ECFDF5', color: '#065F46', fontSize: 13 },
  loading: { padding: 24, textAlign: 'center', color: 'var(--mn-text-secondary, #52655f)' },
  empty: { padding: 24, color: 'var(--mn-text-secondary, #52655f)', textAlign: 'center', background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 8 },
  tableWrap: { width: '100%', overflowX: 'auto', background: '#fff', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 750, fontSize: 13 },
  active: { padding: '3px 8px', borderRadius: 12, background: '#ECFDF5', color: '#065F46', fontSize: 11, fontWeight: 700 },
  inactive: { padding: '3px 8px', borderRadius: 12, background: 'var(--mn-surface-sunken, #eef3f0)', color: 'var(--mn-text-secondary, #52655f)', fontSize: 11, fontWeight: 700 },
  editor: { marginTop: 20, padding: 16, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8 },
  editorHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  sectionTitle: { margin: 0, color: 'var(--mn-nav-surface-deep, #082f23)', fontSize: 16 },
  subSectionTitle: { margin: '0 0 4px', color: 'var(--mn-nav-surface-deep, #082f23)', fontSize: 14 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--mn-text-primary, #132b25)', fontSize: 12, fontWeight: 600 },
  input: { width: '100%', boxSizing: 'border-box', padding: 9, border: '1px solid #CBD5E1', borderRadius: 5, font: 'inherit', fontWeight: 400 },
  inlineInput: { padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 5, font: 'inherit', fontSize: 12, minWidth: 240 },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: 68, padding: 9, border: '1px solid #CBD5E1', borderRadius: 5, font: 'inherit', fontWeight: 400, resize: 'vertical' },
  jsonArea: { width: '100%', boxSizing: 'border-box', minHeight: 112, padding: 9, border: '1px solid #CBD5E1', borderRadius: 5, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, fontWeight: 400, resize: 'vertical' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--mn-text-primary, #132b25)', fontSize: 13 },
  serviceFieldset: { margin: 0, padding: 12, border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 8, background: 'var(--mn-surface-canvas, #f5f8f6)' },
  serviceLegend: { padding: '0 6px', fontSize: 12, fontWeight: 700, color: 'var(--mn-nav-surface-deep, #082f23)' },
  serviceActions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  serviceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 8 },
  serviceOption: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: 8, background: '#fff', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 6, fontSize: 12, color: 'var(--mn-text-primary, #132b25)', cursor: 'pointer' },
  serviceDesc: { display: 'block', marginTop: 2, color: 'var(--mn-text-secondary, #52655f)', fontSize: 11 },
  configGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12 },
  versionNote: { margin: 0, color: 'var(--mn-text-secondary, #52655f)', fontSize: 12 },
  readOnlyDetails: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 },
  pre: { padding: 10, margin: '6px 0 0', maxHeight: 240, overflow: 'auto', background: 'var(--mn-surface-canvas, #f5f8f6)', borderRadius: 5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  classLimitsSection: { marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--mn-border-subtle, #dde7e2)', display: 'flex', flexDirection: 'column', gap: 8 },
  limitList: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  limitItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--mn-surface-canvas, #f5f8f6)', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 6, fontSize: 12 },
  inlineLimitForm: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 },
};
