import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { AgentFundingPanel } from './AgentFundingPanel';
import { AgentCredentialPanel } from './AgentCredentialPanel';
import { AgentClassAssignmentPanel, type AgentClassOption } from '../../components/AgentClassAssignmentPanel';
import { AgentUnifiedHistoryPanel } from '../../components/AgentUnifiedHistoryPanel';
import { AgentTransactionPinSupportPanel } from '../../components/AgentTransactionPinSupportPanel';

interface Agent {
  id: string;
  reference: string;
  status: string;
  agentClassId: string | null;
  originApplicationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentFinancialPosition {
  agentId: string;
  currency: string;
  balanceMinor: string;
  availableBalanceMinor?: string;
  walletExists: boolean;
  walletId: string | null;
  status?: string | null;
}

interface AgentReceivingNumberView {
  agentId: string;
  receivingNumber: string | null;
  status: string;
}

interface AgentApplicationRecord {
  id: string;
  reference: string;
  agentClassId: string;
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | string;
  applicantReference: string;
  businessName: string | null;
  contactEmail: string | null;
  payload?: Record<string, unknown> | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  version?: number;
  agentId: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface LimitCatalogOption {
  code: string;
  name?: string;
  isActive?: boolean;
}

interface WalletTransferRow {
  id: string;
  direction?: string;
  amountMinor: string;
  currency: string;
  status: string;
  reference?: string | null;
  createdAt: string;
}

interface AgentCashToCashRow {
  id: string;
  beneficiaryPhoneMasked: string;
  principalMinor: string;
  currency: string;
  status: string;
  redemptionMethod: string | null;
  reference: string | null;
  createdAt: string;
}

interface OutletRecord {
  id: string;
  agentId: string;
  reference: string;
  code: string | null;
  name: string;
  displayName: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  status: string;
}

interface TerminalRecord {
  id: string;
  agentId: string;
  outletId: string;
  reference: string;
  code: string | null;
  label: string | null;
  serialNumber: string | null;
  status: string;
}

interface AgentLimitAssignmentRecord {
  id: string;
  limitProfileCode: string;
  subjectType: string;
  subjectId: string | null;
  precedence?: number;
  isActive: boolean;
  version?: number;
  effectiveFrom?: string | null;
}

function formatMinor(minorRaw: string | undefined | null, currency = 'NGN'): string {
  if (minorRaw === undefined || minorRaw === null) return `${currency} 0.00`;
  try {
    const minor = BigInt(minorRaw);
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    const whole = (abs / 100n).toLocaleString('en-NG');
    const frac = String(abs % 100n).padStart(2, '0');
    return `${negative ? '-' : ''}${currency} ${whole}.${frac}`;
  } catch {
    return `${currency} ${minorRaw}`;
  }
}

function canPerformAgentLifecycle(
  action: 'suspend' | 'terminate' | 'reactivate' | 'activate',
  currentStatus: string,
): boolean {
  switch (action) {
    case 'activate':
      return currentStatus === 'PENDING';
    case 'suspend':
      return currentStatus === 'ACTIVE';
    case 'reactivate':
      return currentStatus === 'SUSPENDED';
    case 'terminate':
      return currentStatus !== 'TERMINATED';
    default:
      return false;
  }
}

export const AgentNetworkScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const canView = hasFn('agent.view');
  const canManageFunding =
    (principal?.roles.includes('AGENT_NETWORK_MANAGER') === true ||
      principal?.roles.includes('FINANCE_CONTROLLER') === true) &&
    (hasFn('agent.fund') || hasFn('agent.defund'));
  const canSuspend = hasFn('agent.suspend');
  const canTerminate = hasFn('agent.terminate');
  const canReactivate = hasFn('agent.reactivate');
  const canActivate = hasFn('agent.activate');
  const canLifecycle = canSuspend || canTerminate || canReactivate || canActivate;
  const canManageCredentials = hasFn('agent.manage_credentials');
  const canReviewApplications = hasFn('agent.review_application');
  const canManageOutletsTerminals = hasFn('agent.manage_outlets_terminals');
  const canAssignLimit = hasFn('agent.assign_limit');
  const isOperatorOrPrivilegedWorkforce = ['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(
    principal?.type ?? '',
  );
  const canViewReceivingNumber = canView && isOperatorOrPrivilegedWorkforce;
  const canViewUnifiedHistory = canView && isOperatorOrPrivilegedWorkforce;
  const canManageClasses = hasFn('agent.manage_classes');
  const canViewLimitCatalog = hasFn('limit.view');
  const canViewTransactions = hasFn('transaction.view') && isOperatorOrPrivilegedWorkforce;
  const canManageSupport = hasFn('customer.manage_support_case');

  const lifecycleFunctions = {
    suspend: 'agent.suspend',
    terminate: 'agent.terminate',
    reactivate: 'agent.reactivate',
    activate: 'agent.activate',
  } as const;

  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fundingTargetAgentId, setFundingTargetAgentId] = useState('');

  // Selected agent drawer state
  const [selected, setSelected] = useState<Agent | null>(null);
  const [position, setPosition] = useState<AgentFinancialPosition | null>(null);
  const [detailError, setDetailError] = useState('');
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  // Receiving number sub-panel
  const [receivingInfo, setReceivingInfo] = useState<AgentReceivingNumberView | null>(null);
  const [receivingLoading, setReceivingLoading] = useState(false);
  const [receivingError, setReceivingError] = useState('');
  const [receivingNotEntitled, setReceivingNotEntitled] = useState(false);

  // Outlets & terminals sub-panel
  const [outletsLoaded, setOutletsLoaded] = useState(false);
  const [outletsLoading, setOutletsLoading] = useState(false);
  const [outletsError, setOutletsError] = useState('');
  const [outletsMsg, setOutletsMsg] = useState('');
  const [outlets, setOutlets] = useState<OutletRecord[]>([]);
  const [terminals, setTerminals] = useState<TerminalRecord[]>([]);
  const [outletForm, setOutletForm] = useState({ reference: '', name: '', city: '', state: '' });
  const [terminalForm, setTerminalForm] = useState({ reference: '', outletId: '', label: '', serialNumber: '' });
  const [outletBusy, setOutletBusy] = useState(false);

  // Per-agent limits sub-panel
  const [limitsLoaded, setLimitsLoaded] = useState(false);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsError, setLimitsError] = useState('');
  const [limitsMsg, setLimitsMsg] = useState('');
  const [agentLimits, setAgentLimits] = useState<AgentLimitAssignmentRecord[]>([]);
  const [newLimitProfileCode, setNewLimitProfileCode] = useState('');
  const [limitsBusy, setLimitsBusy] = useState(false);

  // Agent applications queue (scope: agent.review_application)
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState('');
  const [applicationsMsg, setApplicationsMsg] = useState('');
  const [applications, setApplications] = useState<AgentApplicationRecord[]>([]);
  const [applicationStatusFilter, setApplicationStatusFilter] = useState('');
  const [inspectedApplication, setInspectedApplication] = useState<AgentApplicationRecord | null>(null);
  const [inspectAppLoading, setInspectAppLoading] = useState(false);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [applicationBusyId, setApplicationBusyId] = useState<string | null>(null);

  // On-demand catalogs & transaction observability
  const [classCatalog, setClassCatalog] = useState<AgentClassOption[]>([]);
  const [classCatalogLoading, setClassCatalogLoading] = useState(false);
  const [limitCatalog, setLimitCatalog] = useState<LimitCatalogOption[]>([]);
  const [limitCatalogLoading, setLimitCatalogLoading] = useState(false);
  const [agentHistoryLoaded, setAgentHistoryLoaded] = useState(false);
  const [agentHistoryLoading, setAgentHistoryLoading] = useState(false);
  const [agentHistoryError, setAgentHistoryError] = useState('');
  const [walletTransfers, setWalletTransfers] = useState<WalletTransferRow[]>([]);
  const [agentC2CRows, setAgentC2CRows] = useState<AgentCashToCashRow[]>([]);

  const fetchAgents = async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params: string[] = [`page=${page}`, `limit=20`];
      if (statusFilter) params.push(`status=${statusFilter}`);
      const res: any = await ApiClient.get(`/internal/agents?${params.join('&')}`);
      const rows: Agent[] = res.data || (Array.isArray(res) ? res : []);
      setAgents(rows);
      setTotal(res.total ?? rows.length);
      if (selected) {
        const refreshed = rows.find((item) => item.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) void fetchAgents();
    else setLoading(false);
  }, [page, statusFilter, canView]);

  const loadPosition = async (agentId: string) => {
    setDetailError('');
    try {
      const pos = await ApiClient.get<AgentFinancialPosition>(
        `/internal/agents/${encodeURIComponent(agentId)}/financial-position`,
      );
      setPosition(pos);
    } catch (e: any) {
      setDetailError(e?.message || 'Failed to load financial position');
    }
  };

  const openDetail = async (a: Agent) => {
    if (!canView) return;
    setSelected(a);
    setPosition(null);
    setDetailError('');
    setLifecycleReason('');
    setActionMsg('');
    setActionErr('');
    setReceivingInfo(null);
    setReceivingError('');
    setReceivingNotEntitled(false);
    setOutletsLoaded(false);
    setOutlets([]);
    setTerminals([]);
    setOutletsError('');
    setOutletsMsg('');
    setLimitsLoaded(false);
    setAgentLimits([]);
    setLimitsError('');
    setLimitsMsg('');
    setNewLimitProfileCode('');
    setAgentHistoryLoaded(false);
    setAgentHistoryError('');
    setWalletTransfers([]);
    setAgentC2CRows([]);
    await loadPosition(a.id);
  };

  const loadClassCatalog = async () => {
    if (!canView || classCatalogLoading) return;
    setClassCatalogLoading(true);
    try {
      const res: any = await ApiClient.get('/internal/agents/classes');
      const rows = Array.isArray(res) ? res : res?.data || [];
      setClassCatalog(rows);
    } catch (e: any) {
      setActionErr(e?.message || 'Failed to load Agent class catalog');
    } finally {
      setClassCatalogLoading(false);
    }
  };

  const loadLimitCatalog = async () => {
    if (!canViewLimitCatalog || limitCatalogLoading) return;
    setLimitCatalogLoading(true);
    try {
      const res: any = await ApiClient.get('/internal/limit-profiles');
      const rows = Array.isArray(res) ? res : res?.data || res?.items || [];
      setLimitCatalog(rows);
    } catch (e: any) {
      setLimitsError(e?.message || 'Failed to load limit profile catalog');
    } finally {
      setLimitCatalogLoading(false);
    }
  };

  const loadAgentTransactions = async (agentId: string, walletId: string | null) => {
    if (!canViewTransactions || agentHistoryLoading) return;
    setAgentHistoryLoading(true);
    setAgentHistoryError('');
    try {
      const c2cPromise = ApiClient.get<any>(
        `/internal/admin/cash-to-cash/transfers?page=1&limit=10&agentId=${encodeURIComponent(agentId)}`,
      );
      const walletPromise = walletId
        ? ApiClient.get<any>(`/wallets/${encodeURIComponent(walletId)}/transactions?page=1&limit=10`)
        : Promise.resolve({ items: [] });
      const [c2cOutcome, walletOutcome] = await Promise.allSettled([c2cPromise, walletPromise]);
      const errors: string[] = [];
      if (c2cOutcome.status === 'fulfilled') {
        const c2cRes = c2cOutcome.value;
        setAgentC2CRows(Array.isArray(c2cRes?.data) ? c2cRes.data : Array.isArray(c2cRes) ? c2cRes : []);
      } else {
        setAgentC2CRows([]);
        errors.push((c2cOutcome.reason as Error)?.message || 'Failed to load Cash-to-Cash history');
      }
      if (walletOutcome.status === 'fulfilled') {
        const walletRes = walletOutcome.value;
        setWalletTransfers(
          Array.isArray(walletRes?.items)
            ? walletRes.items
            : Array.isArray(walletRes?.data)
              ? walletRes.data
              : [],
        );
      } else {
        setWalletTransfers([]);
        errors.push((walletOutcome.reason as Error)?.message || 'Failed to load wallet transfers');
      }
      setAgentHistoryLoaded(true);
      if (errors.length > 0) {
        setAgentHistoryError(errors.join(' · '));
      }
    } catch (e: any) {
      setAgentHistoryError(e?.message || 'Failed to load Agent transaction records');
    } finally {
      setAgentHistoryLoading(false);
    }
  };

  const doLifecycle = async (action: keyof typeof lifecycleFunctions, id: string) => {
    if (!hasFn(lifecycleFunctions[action]) || lifecycleBusy) return;
    if (selected && !canPerformAgentLifecycle(action, selected.status)) return;
    setLifecycleBusy(true);
    setActionErr('');
    setActionMsg('');
    try {
      const reasonText = lifecycleReason.trim() || `${action} via Admin Web`;
      const payload = action === 'suspend' || action === 'terminate' ? { reason: reasonText } : {};
      const updated: any = await ApiClient.post(
        `/internal/admin/agents/${encodeURIComponent(id)}/${action}`,
        payload,
      );
      if (updated && typeof updated === 'object' && 'status' in updated) {
        setSelected((cur) => (cur && cur.id === id ? { ...cur, ...updated } : cur));
      }
      setActionMsg(`Agent ${action} succeeded`);
      setLifecycleReason('');
      await Promise.all([fetchAgents(), loadPosition(id)]);
    } catch (e: any) {
      setActionErr(e?.message || `${action} failed`);
    } finally {
      setLifecycleBusy(false);
    }
  };

  const loadReceivingNumber = async (agentId: string) => {
    if (!canViewReceivingNumber || receivingLoading || receivingNotEntitled) return;
    setReceivingLoading(true);
    setReceivingError('');
    setReceivingInfo(null);
    try {
      const view = await ApiClient.get<AgentReceivingNumberView>(
        `/internal/agents/${encodeURIComponent(agentId)}/receiving-number`,
      );
      setReceivingInfo(view);
    } catch (e: any) {
      setReceivingInfo(null);
      if (e?.status === 403) {
        setReceivingNotEntitled(true);
        setReceivingError('');
      } else {
        setReceivingError(e?.message || 'Failed to load receiving number');
      }
    } finally {
      setReceivingLoading(false);
    }
  };

  const loadOutletsAndTerminals = async (agentId: string) => {
    setOutletsLoading(true);
    setOutletsError('');
    try {
      const [outletRows, terminalRows] = await Promise.all([
        ApiClient.get<OutletRecord[]>(`/internal/agents/${encodeURIComponent(agentId)}/outlets`),
        ApiClient.get<TerminalRecord[]>(`/internal/agents/${encodeURIComponent(agentId)}/terminals`),
      ]);
      const safeOutlets = Array.isArray(outletRows) ? outletRows : [];
      const safeTerminals = Array.isArray(terminalRows) ? terminalRows : [];
      setOutlets(safeOutlets);
      setTerminals(safeTerminals);
      setOutletsLoaded(true);
      setTerminalForm((cur) => ({
        ...cur,
        outletId: safeOutlets.some((o) => o.id === cur.outletId)
          ? cur.outletId
          : (safeOutlets.find((o) => o.status === 'ACTIVE')?.id ?? safeOutlets[0]?.id ?? ''),
      }));
    } catch (e: any) {
      setOutletsError(e?.message || 'Failed to load outlets and terminals');
    } finally {
      setOutletsLoading(false);
    }
  };

  const createOutlet = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !canManageOutletsTerminals || outletBusy) return;
    const reference = outletForm.reference.trim();
    const name = outletForm.name.trim();
    if (reference.length < 3 || name.length < 2) {
      setOutletsError('Outlet reference (min 3 chars) and name (min 2 chars) are required.');
      return;
    }
    setOutletBusy(true);
    setOutletsError('');
    setOutletsMsg('');
    try {
      const body: Record<string, string> = { reference, name };
      if (outletForm.city.trim()) body.city = outletForm.city.trim();
      if (outletForm.state.trim()) body.state = outletForm.state.trim();
      await ApiClient.post(`/internal/agents/${encodeURIComponent(selected.id)}/outlets`, body);
      setOutletForm({ reference: '', name: '', city: '', state: '' });
      setOutletsMsg(`Outlet ${reference} created.`);
      await loadOutletsAndTerminals(selected.id);
    } catch (e: any) {
      setOutletsError(e?.message || 'Failed to create outlet');
    } finally {
      setOutletBusy(false);
    }
  };

  const doOutletLifecycle = async (outletId: string, action: 'suspend' | 'reactivate' | 'terminate') => {
    if (!selected || !canManageOutletsTerminals || outletBusy) return;
    setOutletBusy(true);
    setOutletsError('');
    setOutletsMsg('');
    try {
      await ApiClient.post(`/internal/outlets/${encodeURIComponent(outletId)}/${action}`);
      setOutletsMsg(`Outlet ${action} succeeded.`);
      await loadOutletsAndTerminals(selected.id);
    } catch (e: any) {
      setOutletsError(e?.message || `Outlet ${action} failed`);
    } finally {
      setOutletBusy(false);
    }
  };

  const createTerminal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !canManageOutletsTerminals || outletBusy) return;
    const reference = terminalForm.reference.trim();
    const outletId = terminalForm.outletId.trim();
    if (reference.length < 3 || !outletId) {
      setOutletsError('Terminal reference (min 3 chars) and an outlet selection are required.');
      return;
    }
    setOutletBusy(true);
    setOutletsError('');
    setOutletsMsg('');
    try {
      const body: Record<string, string> = { reference, outletId };
      if (terminalForm.label.trim()) body.label = terminalForm.label.trim();
      if (terminalForm.serialNumber.trim()) body.serialNumber = terminalForm.serialNumber.trim();
      await ApiClient.post(`/internal/agents/${encodeURIComponent(selected.id)}/terminals`, body);
      setTerminalForm((cur) => ({ ...cur, reference: '', label: '', serialNumber: '' }));
      setOutletsMsg(`Terminal ${reference} created.`);
      await loadOutletsAndTerminals(selected.id);
    } catch (e: any) {
      setOutletsError(e?.message || 'Failed to create terminal');
    } finally {
      setOutletBusy(false);
    }
  };

  const doTerminalLifecycle = async (terminalId: string, action: 'suspend' | 'reactivate' | 'terminate') => {
    if (!selected || !canManageOutletsTerminals || outletBusy) return;
    setOutletBusy(true);
    setOutletsError('');
    setOutletsMsg('');
    try {
      await ApiClient.post(`/internal/terminals/${encodeURIComponent(terminalId)}/${action}`);
      setOutletsMsg(`Terminal ${action} succeeded.`);
      await loadOutletsAndTerminals(selected.id);
    } catch (e: any) {
      setOutletsError(e?.message || `Terminal ${action} failed`);
    } finally {
      setOutletBusy(false);
    }
  };

  const loadAgentLimits = async (agentId: string) => {
    setLimitsLoading(true);
    setLimitsError('');
    try {
      const res: any = await ApiClient.get(`/internal/limit-assignments/agent/${encodeURIComponent(agentId)}`);
      const rows = res?.data || res?.items || (Array.isArray(res) ? res : []);
      setAgentLimits(rows);
      setLimitsLoaded(true);
    } catch (e: any) {
      setLimitsError(e?.message || 'Failed to load agent limit assignments');
    } finally {
      setLimitsLoading(false);
    }
  };

  const assignAgentLimit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !canAssignLimit || limitsBusy) return;
    const code = newLimitProfileCode.trim().toUpperCase();
    if (!code) {
      setLimitsError('Limit profile code is required.');
      return;
    }
    setLimitsBusy(true);
    setLimitsError('');
    setLimitsMsg('');
    try {
      await ApiClient.post('/internal/limit-assignments', {
        subjectType: 'AGENT',
        subjectId: selected.id,
        limitProfileCode: code,
      });
      setNewLimitProfileCode('');
      setLimitsMsg(`Assigned limit profile ${code} to ${selected.reference}.`);
      await loadAgentLimits(selected.id);
    } catch (e: any) {
      setLimitsError(e?.message || 'Failed to assign limit profile');
    } finally {
      setLimitsBusy(false);
    }
  };

  const toggleAgentLimit = async (item: AgentLimitAssignmentRecord) => {
    if (!selected || !canAssignLimit || limitsBusy) return;
    setLimitsBusy(true);
    setLimitsError('');
    setLimitsMsg('');
    try {
      await ApiClient.patch(`/internal/limit-assignments/${encodeURIComponent(item.id)}`, {
        subjectType: 'AGENT',
        isActive: !item.isActive,
        version: item.version ?? 1,
      });
      setLimitsMsg(
        `Limit profile ${item.limitProfileCode} ${item.isActive ? 'deactivated' : 'activated'}.`,
      );
      await loadAgentLimits(selected.id);
    } catch (e: any) {
      setLimitsError(e?.message || 'Failed to update limit assignment');
    } finally {
      setLimitsBusy(false);
    }
  };

  const inspectApplication = async (applicationId: string) => {
    if (!canReviewApplications || inspectAppLoading) return;
    setInspectAppLoading(true);
    setApplicationsError('');
    try {
      const detail = await ApiClient.get<AgentApplicationRecord>(
        `/internal/agents/applications/${encodeURIComponent(applicationId)}`,
      );
      setInspectedApplication(detail);
    } catch (e: any) {
      setApplicationsError(e?.message || 'Failed to load application details');
    } finally {
      setInspectAppLoading(false);
    }
  };

  const loadApplications = async () => {
    if (!canReviewApplications) return;
    setApplicationsLoading(true);
    setApplicationsError('');
    try {
      const res: any = await ApiClient.get('/internal/agents/applications');
      const rows = Array.isArray(res) ? res : res?.data || [];
      setApplications(rows);
      setApplicationsLoaded(true);
    } catch (e: any) {
      setApplicationsError(e?.message || 'Failed to load Agent applications');
    } finally {
      setApplicationsLoading(false);
    }
  };

  const handleApplicationAction = async (
    app: AgentApplicationRecord,
    action: 'review' | 'approve' | 'reject' | 'activate',
  ) => {
    if (!canReviewApplications || applicationBusyId) return;
    if (action === 'reject' && !(rejectReasons[app.id] || '').trim()) {
      setApplicationsError('A rejection reason is required before rejecting an application.');
      return;
    }
    setApplicationBusyId(app.id);
    setApplicationsError('');
    setApplicationsMsg('');
    try {
      if (action === 'activate') {
        const activated: any = await ApiClient.post(
          `/internal/admin/agents/applications/${encodeURIComponent(app.id)}/activate`,
        );
        setApplicationsMsg(
          `Application ${app.reference} activated${activated?.reference ? ` as Agent ${activated.reference}` : ''}.`,
        );
        await Promise.all([loadApplications(), fetchAgents()]);
      } else if (action === 'reject') {
        await ApiClient.post(`/internal/agents/applications/${encodeURIComponent(app.id)}/reject`, {
          reason: (rejectReasons[app.id] || '').trim(),
        });
        setRejectReasons((cur) => ({ ...cur, [app.id]: '' }));
        setApplicationsMsg(`Application ${app.reference} rejected.`);
        await loadApplications();
      } else {
        await ApiClient.post(`/internal/agents/applications/${encodeURIComponent(app.id)}/${action}`);
        setApplicationsMsg(
          action === 'review'
            ? `Application ${app.reference} marked under review.`
            : `Application ${app.reference} approved.`,
        );
        await loadApplications();
      }
    } catch (e: any) {
      setApplicationsError(e?.message || `Application ${action} failed`);
    } finally {
      setApplicationBusyId(null);
    }
  };

  if (!canView) {
    return (
      <div style={wrap}>
        <div style={denied} data-testid="agent-directory-not-entitled">
          <strong>Not entitled:</strong> Agent directory and Agent receiving-number lookup require{' '}
          <code>agent.view</code>. Your roles: {principal?.roles.join(', ')}
        </div>
        {canManageFunding && <AgentFundingPanel />}
      </div>
    );
  }

  const hasNextPage = total > 0 ? page * 20 < total : agents.length >= 20;

  return (
    <div style={wrap}>
      <h2 style={h2}>🏪 Agent Network Management</h2>
      <p style={sub}>
        Browse agents, inspect ledger-derived financial positions, review onboarding applications, manage outlets/terminals and agent limits, and perform only lifecycle actions granted to this principal.
      </p>

      {canManageFunding && (
        <div>
          {fundingTargetAgentId && (
            <div style={noteBox}>
              Funding panel targeted to Agent <code>{fundingTargetAgentId}</code>.{' '}
              <button type="button" style={smallBtn} onClick={() => setFundingTargetAgentId('')}>
                Clear target
              </button>
            </div>
          )}
          <AgentFundingPanel agentId={fundingTargetAgentId || undefined} />
        </div>
      )}

      {canReviewApplications && (
        <section style={sectionCard} aria-label="Agent applications governance">
          <div style={sectionHead}>
            <div>
              <h3 style={h3}>Agent Onboarding Applications</h3>
              <p style={smallMuted}>
                Review submitted applications, inspect submitted application details, record approval or rejection decisions, and activate approved Ordinary Agents.
              </p>
            </div>
            <div style={actionRow}>
              {applicationsLoaded && (
                <select
                  aria-label="Filter applications by status"
                  value={applicationStatusFilter}
                  onChange={(e) => setApplicationStatusFilter(e.target.value)}
                  style={inlineInput}
                >
                  <option value="">All application states</option>
                  <option value="SUBMITTED">SUBMITTED</option>
                  <option value="UNDER_REVIEW">UNDER_REVIEW</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                </select>
              )}
              <button
                type="button"
                style={btn}
                disabled={applicationsLoading}
                onClick={() => void loadApplications()}
              >
                {applicationsLoading ? 'Loading…' : applicationsLoaded ? 'Refresh applications' : 'Load applications'}
              </button>
            </div>
          </div>
          {applicationsError && <div style={errBox} role="alert">{applicationsError}</div>}
          {applicationsMsg && <div style={successBox} role="status">{applicationsMsg}</div>}
          {applicationsLoaded && (() => {
            const visibleApps = applications.filter((a) =>
              applicationStatusFilter ? a.status === applicationStatusFilter : true,
            );
            return visibleApps.length === 0 ? (
              <div style={empty}>No Agent onboarding applications found.</div>
            ) : (
              <table style={table}>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Business / Applicant</th>
                    <th>Class</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleApps.map((app) => {
                    const busy = applicationBusyId === app.id;
                    const canReviewOrDecide = app.status === 'SUBMITTED' || app.status === 'UNDER_REVIEW';
                    const canActivateFromApp = app.status === 'APPROVED' && !app.agentId;
                    const matchedClass = classCatalog.find((c) => c.id === app.agentClassId);
                    return (
                      <tr key={app.id}>
                        <td style={cell}>
                          <strong>{app.reference}</strong>
                          {app.agentId && <div style={smallMuted}>Agent: <code>{app.agentId}</code></div>}
                        </td>
                        <td style={cell}>
                          {app.businessName || app.applicantReference}
                          {app.contactEmail && <div style={smallMuted}>{app.contactEmail}</div>}
                          {app.rejectionReason && <div style={smallMuted}>Rejected: {app.rejectionReason}</div>}
                        </td>
                        <td style={cell}>
                          {matchedClass ? `${matchedClass.name} (${matchedClass.code})` : <code>{app.agentClassId}</code>}
                        </td>
                        <td style={cell}><span style={badge(app.status)}>{app.status}</span></td>
                        <td style={cell}>
                          <div style={actionRow}>
                            <button
                              type="button"
                              style={smallBtn}
                              disabled={inspectAppLoading}
                              onClick={() => void inspectApplication(app.id)}
                            >
                              Inspect details
                            </button>
                            {app.status === 'SUBMITTED' && (
                              <button
                                type="button"
                                style={smallBtn}
                                disabled={busy}
                                onClick={() => void handleApplicationAction(app, 'review')}
                              >
                                Mark under review
                              </button>
                            )}
                            {canReviewOrDecide && (
                              <>
                                <button
                                  type="button"
                                  style={successBtn}
                                  disabled={busy}
                                  onClick={() => void handleApplicationAction(app, 'approve')}
                                >
                                  Approve
                                </button>
                                <input
                                  aria-label={`Rejection reason for ${app.reference}`}
                                  placeholder="Rejection reason"
                                  value={rejectReasons[app.id] || ''}
                                  onChange={(e) => setRejectReasons((cur) => ({ ...cur, [app.id]: e.target.value }))}
                                  style={inlineInput}
                                  disabled={busy}
                                />
                                <button
                                  type="button"
                                  style={dangerBtn}
                                  disabled={busy || !(rejectReasons[app.id] || '').trim()}
                                  onClick={() => void handleApplicationAction(app, 'reject')}
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {canActivateFromApp && (
                              <button
                                type="button"
                                style={successBtn}
                                disabled={busy}
                                onClick={() => void handleApplicationAction(app, 'activate')}
                              >
                                Activate agent
                              </button>
                            )}
                            {app.agentId && (
                              <button
                                type="button"
                                style={smallBtn}
                                onClick={() => {
                                  const found = agents.find((item) => item.id === app.agentId);
                                  if (found) void openDetail(found);
                                }}
                              >
                                Open agent
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}

          {inspectedApplication && (
            <div style={{ ...card, marginTop: 12 }} data-testid="inspected-agent-application">
              <div style={sectionHead}>
                <strong>Application Detail — {inspectedApplication.reference}</strong>
                <button type="button" style={smallBtn} onClick={() => setInspectedApplication(null)}>
                  Close detail
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>
                  <strong>Applicant:</strong> {inspectedApplication.applicantReference} ·{' '}
                  <strong>Business:</strong> {inspectedApplication.businessName || '—'} ·{' '}
                  <strong>Email:</strong> {inspectedApplication.contactEmail || '—'}
                </div>
                <div>
                  <strong>Status:</strong> {inspectedApplication.status} ·{' '}
                  <strong>Class ID:</strong> <code>{inspectedApplication.agentClassId}</code>
                  {inspectedApplication.version != null && <> · <strong>Version:</strong> {inspectedApplication.version}</>}
                </div>
                {inspectedApplication.payload && Object.keys(inspectedApplication.payload).length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <strong>Submitted Questionnaire / Evidence Metadata:</strong>
                    <ul style={compactList}>
                      {Object.entries(inspectedApplication.payload).map(([k, v]) => (
                        <li key={k} style={compactListItem}>
                          <span><code>{k}</code></span>
                          <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <div style={filters}>
        <label>
          Status:{' '}
          <select
            aria-label="Agent status filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="PENDING">PENDING</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="TERMINATED">TERMINATED</option>
          </select>
        </label>
        <button type="button" onClick={() => void fetchAgents()} style={btn} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div style={errBox} role="alert">{error}</div>}
      {loading ? (
        <div style={loadingBox}>Loading agents…</div>
      ) : agents.length === 0 ? (
        <div style={empty}>No agents found for this filter.</div>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Status</th>
              <th>Class</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td style={cell}>{a.reference}</td>
                <td style={cell}><span style={badge(a.status)}>{a.status}</span></td>
                <td style={cell}>{a.agentClassId ? <code>{a.agentClassId}</code> : '—'}</td>
                <td style={cell}>{new Date(a.createdAt).toLocaleString()}</td>
                <td style={cell}>
                  <button type="button" onClick={() => void openDetail(a)} style={smallBtn}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={pager}>
        Total: {total} — Page {page}{' '}
        <button
          type="button"
          disabled={loading || page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          style={smallBtn}
        >
          Prev
        </button>{' '}
        <button
          type="button"
          disabled={loading || !hasNextPage}
          onClick={() => setPage((p) => p + 1)}
          style={smallBtn}
        >
          Next
        </button>
      </div>

      {selected && (
        <div style={drawer}>
          <div style={drawerHead}>
            <div>
              <strong>{selected.reference}</strong> — <span style={badge(selected.status)}>{selected.status}</span>
            </div>
            <div style={actionRow}>
              {canManageFunding && (
                <button
                  type="button"
                  style={smallBtn}
                  onClick={() => setFundingTargetAgentId(selected.id)}
                >
                  Target in funding
                </button>
              )}
              <button type="button" onClick={() => setSelected(null)} style={smallBtn}>
                Close
              </button>
            </div>
          </div>
          <div style={drawerBody}>
            <div><strong>ID:</strong> <code>{selected.id}</code></div>
            <div>
              <strong>Class:</strong>{' '}
              {(() => {
                const matched = classCatalog.find((c) => c.id === selected.agentClassId);
                return matched
                  ? `${matched.name} (${matched.code})`
                  : selected.agentClassId
                    ? <code>{selected.agentClassId}</code>
                    : 'None assigned';
              })()}{' '}
              <button
                type="button"
                style={smallBtn}
                disabled={classCatalogLoading}
                onClick={() => void loadClassCatalog()}
              >
                {classCatalogLoading ? 'Loading classes…' : classCatalog.length > 0 ? 'Refresh class catalog' : 'Resolve class name'}
              </button>
            </div>
            <AgentClassAssignmentPanel
              agentId={selected.id}
              currentClassId={selected.agentClassId}
              availableClasses={classCatalog}
              canManageClasses={canManageClasses}
            />

            {detailError && <div style={errBox} role="alert">{detailError}</div>}
            {position ? (
              <div style={card}>
                <strong>Financial Position ({position.currency || 'NGN'} ledger-derived)</strong>
                <div>
                  Wallet: {position.walletExists ? <code>{position.walletId}</code> : 'none'}
                  {position.status ? ` (${position.status})` : ''} — Balance:{' '}
                  <strong>{formatMinor(position.balanceMinor, position.currency || 'NGN')}</strong>
                  {position.availableBalanceMinor !== undefined && (
                    <> · Available: {formatMinor(position.availableBalanceMinor, position.currency || 'NGN')}</>
                  )}
                </div>
              </div>
            ) : !detailError ? (
              <div style={loadingBox}>Loading position…</div>
            ) : null}

            <div style={card}>
              <div style={sectionHead}>
                <strong>Agent Receiving Number</strong>
                <button
                  type="button"
                  style={smallBtn}
                  disabled={!canViewReceivingNumber || receivingLoading || receivingNotEntitled}
                  onClick={() => void loadReceivingNumber(selected.id)}
                >
                  {!canViewReceivingNumber || receivingNotEntitled
                    ? 'Not entitled'
                    : receivingLoading
                      ? 'Loading…'
                      : 'Load receiving number'}
                </button>
              </div>
              {(!canViewReceivingNumber || receivingNotEntitled) && (
                <div
                  style={{
                    marginTop: 6,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: '#FFFBEB',
                    border: '1px solid #FCD34D',
                    color: '#92400E',
                    fontSize: 12,
                  }}
                  role="status"
                  data-testid="receiving-number-not-entitled"
                >
                  <strong>Not entitled:</strong> Viewing an Agent receiving number requires an authorized
                  workforce principal (<code>OPERATOR</code>, <code>SERVICE</code>, or{' '}
                  <code>PRIVILEGED</code>) with <code>agent.view</code>. Forbidden requests are not retried.
                </div>
              )}
              {receivingError && <div style={errBox} role="alert">{receivingError}</div>}
              {canViewReceivingNumber && !receivingNotEntitled && receivingInfo && (
                <div style={{ marginTop: 6 }}>
                  Number: <strong>{receivingInfo.receivingNumber ?? 'Not allocated'}</strong> · Status:{' '}
                  <span style={badge(receivingInfo.status)}>{receivingInfo.status}</span>
                </div>
              )}
            </div>

            {canLifecycle ? (
              <div style={card}>
                <strong>Lifecycle Governance</strong>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(canSuspend || canTerminate) && (
                    <input
                      aria-label="Lifecycle reason"
                      placeholder="Audit reason (for suspend / terminate)"
                      value={lifecycleReason}
                      onChange={(e) => setLifecycleReason(e.target.value)}
                      style={inlineInput}
                      disabled={lifecycleBusy}
                    />
                  )}
                  <div style={actionRow} aria-label="Granted agent lifecycle actions">
                    {canSuspend && (
                      <button
                        type="button"
                        disabled={lifecycleBusy || !canPerformAgentLifecycle('suspend', selected.status)}
                        onClick={() => void doLifecycle('suspend', selected.id)}
                        style={warnBtn}
                      >
                        Suspend
                      </button>
                    )}
                    {canTerminate && (
                      <button
                        type="button"
                        disabled={lifecycleBusy || !canPerformAgentLifecycle('terminate', selected.status)}
                        onClick={() => void doLifecycle('terminate', selected.id)}
                        style={dangerBtn}
                      >
                        Terminate
                      </button>
                    )}
                    {canReactivate && (
                      <button
                        type="button"
                        disabled={lifecycleBusy || !canPerformAgentLifecycle('reactivate', selected.status)}
                        onClick={() => void doLifecycle('reactivate', selected.id)}
                        style={successBtn}
                      >
                        Reactivate
                      </button>
                    )}
                    {canActivate && (
                      <button
                        type="button"
                        disabled={lifecycleBusy || !canPerformAgentLifecycle('activate', selected.status)}
                        onClick={() => void doLifecycle('activate', selected.id)}
                        style={successBtn}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={denied}>
                Lifecycle actions require <code>agent.suspend / terminate / reactivate / activate</code>.
              </div>
            )}
            {actionMsg && <div style={successBox} role="status">{actionMsg}</div>}
            {actionErr && <div style={errBox} role="alert">{actionErr}</div>}

            {canManageCredentials && (
              <AgentCredentialPanel
                agentId={selected.id}
                agentStatus={selected.status}
                canManage={canManageCredentials}
              />
            )}

            <section style={card} aria-label="Agent outlets and terminals">
              <div style={sectionHead}>
                <strong>Outlets &amp; Terminals</strong>
                <button
                  type="button"
                  style={smallBtn}
                  disabled={outletsLoading}
                  onClick={() => void loadOutletsAndTerminals(selected.id)}
                >
                  {outletsLoading ? 'Loading…' : outletsLoaded ? 'Refresh outlets & terminals' : 'Load outlets & terminals'}
                </button>
              </div>
              {outletsError && <div style={errBox} role="alert">{outletsError}</div>}
              {outletsMsg && <div style={successBox} role="status">{outletsMsg}</div>}
              {outletsLoaded && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <strong>Outlets ({outlets.length})</strong>
                    {outlets.length === 0 ? (
                      <div style={smallMuted}>No outlets registered for this Agent.</div>
                    ) : (
                      <ul style={compactList}>
                        {outlets.map((outlet) => (
                          <li key={outlet.id} style={compactListItem}>
                            <span>
                              <strong>{outlet.reference}</strong> — {outlet.name}
                              {outlet.city || outlet.state ? ` (${[outlet.city, outlet.state].filter(Boolean).join(', ')})` : ''}{' '}
                              <span style={badge(outlet.status)}>{outlet.status}</span>
                            </span>
                            {canManageOutletsTerminals && (
                              <span style={actionRow}>
                                <button
                                  type="button"
                                  style={warnBtn}
                                  disabled={outletBusy || outlet.status !== 'ACTIVE'}
                                  onClick={() => void doOutletLifecycle(outlet.id, 'suspend')}
                                >
                                  Suspend outlet
                                </button>
                                <button
                                  type="button"
                                  style={successBtn}
                                  disabled={outletBusy || outlet.status !== 'SUSPENDED'}
                                  onClick={() => void doOutletLifecycle(outlet.id, 'reactivate')}
                                >
                                  Reactivate outlet
                                </button>
                                <button
                                  type="button"
                                  style={dangerBtn}
                                  disabled={outletBusy || outlet.status === 'TERMINATED'}
                                  onClick={() => void doOutletLifecycle(outlet.id, 'terminate')}
                                >
                                  Terminate outlet
                                </button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <strong>Terminals ({terminals.length})</strong>
                    {terminals.length === 0 ? (
                      <div style={smallMuted}>No terminals registered for this Agent.</div>
                    ) : (
                      <ul style={compactList}>
                        {terminals.map((terminal) => (
                          <li key={terminal.id} style={compactListItem}>
                            <span>
                              <strong>{terminal.reference}</strong>
                              {terminal.label ? ` — ${terminal.label}` : ''}
                              {terminal.serialNumber ? ` · SN ${terminal.serialNumber}` : ''} · Outlet <code>{terminal.outletId}</code>{' '}
                              <span style={badge(terminal.status)}>{terminal.status}</span>
                            </span>
                            {canManageOutletsTerminals && (
                              <span style={actionRow}>
                                <button
                                  type="button"
                                  style={warnBtn}
                                  disabled={outletBusy || terminal.status !== 'ACTIVE'}
                                  onClick={() => void doTerminalLifecycle(terminal.id, 'suspend')}
                                >
                                  Suspend terminal
                                </button>
                                <button
                                  type="button"
                                  style={successBtn}
                                  disabled={outletBusy || terminal.status !== 'SUSPENDED'}
                                  onClick={() => void doTerminalLifecycle(terminal.id, 'reactivate')}
                                >
                                  Reactivate terminal
                                </button>
                                <button
                                  type="button"
                                  style={dangerBtn}
                                  disabled={outletBusy || terminal.status === 'TERMINATED'}
                                  onClick={() => void doTerminalLifecycle(terminal.id, 'terminate')}
                                >
                                  Terminate terminal
                                </button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {canManageOutletsTerminals && (
                    selected.status !== 'ACTIVE' ? (
                      <div style={smallMuted}>Outlet and terminal creation requires an ACTIVE Agent.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <form onSubmit={createOutlet} style={actionRow} aria-label="Create outlet form">
                          <input
                            aria-label="Outlet reference"
                            placeholder="Outlet ref (e.g. OUT-ABJ-01)"
                            value={outletForm.reference}
                            onChange={(e) => setOutletForm((c) => ({ ...c, reference: e.target.value }))}
                            style={inlineInput}
                            disabled={outletBusy}
                          />
                          <input
                            aria-label="Outlet name"
                            placeholder="Outlet name"
                            value={outletForm.name}
                            onChange={(e) => setOutletForm((c) => ({ ...c, name: e.target.value }))}
                            style={inlineInput}
                            disabled={outletBusy}
                          />
                          <input
                            aria-label="Outlet city"
                            placeholder="City (optional)"
                            value={outletForm.city}
                            onChange={(e) => setOutletForm((c) => ({ ...c, city: e.target.value }))}
                            style={inlineInput}
                            disabled={outletBusy}
                          />
                          <input
                            aria-label="Outlet state"
                            placeholder="State (optional)"
                            value={outletForm.state}
                            onChange={(e) => setOutletForm((c) => ({ ...c, state: e.target.value }))}
                            style={inlineInput}
                            disabled={outletBusy}
                          />
                          <button type="submit" style={smallBtn} disabled={outletBusy}>
                            Create outlet
                          </button>
                        </form>

                        {outlets.length > 0 && (
                          <form onSubmit={createTerminal} style={actionRow} aria-label="Create terminal form">
                            <input
                              aria-label="Terminal reference"
                              placeholder="Terminal ref (e.g. TRM-001)"
                              value={terminalForm.reference}
                              onChange={(e) => setTerminalForm((c) => ({ ...c, reference: e.target.value }))}
                              style={inlineInput}
                              disabled={outletBusy}
                            />
                            <select
                              aria-label="Terminal outlet"
                              value={terminalForm.outletId}
                              onChange={(e) => setTerminalForm((c) => ({ ...c, outletId: e.target.value }))}
                              style={inlineInput}
                              disabled={outletBusy}
                            >
                              {outlets.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.reference} ({o.status})
                                </option>
                              ))}
                            </select>
                            <input
                              aria-label="Terminal label"
                              placeholder="Label (optional)"
                              value={terminalForm.label}
                              onChange={(e) => setTerminalForm((c) => ({ ...c, label: e.target.value }))}
                              style={inlineInput}
                              disabled={outletBusy}
                            />
                            <input
                              aria-label="Terminal serial number"
                              placeholder="Serial number (optional)"
                              value={terminalForm.serialNumber}
                              onChange={(e) => setTerminalForm((c) => ({ ...c, serialNumber: e.target.value }))}
                              style={inlineInput}
                              disabled={outletBusy}
                            />
                            <button type="submit" style={smallBtn} disabled={outletBusy}>
                              Create terminal
                            </button>
                          </form>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </section>

            <section style={card} aria-label="Agent limit assignments">
              <div style={sectionHead}>
                <strong>Agent Limit Assignments</strong>
                <button
                  type="button"
                  style={smallBtn}
                  disabled={limitsLoading}
                  onClick={() => void loadAgentLimits(selected.id)}
                >
                  {limitsLoading ? 'Loading…' : limitsLoaded ? 'Refresh agent limits' : 'Load agent limits'}
                </button>
              </div>
              {limitsError && <div style={errBox} role="alert">{limitsError}</div>}
              {limitsMsg && <div style={successBox} role="status">{limitsMsg}</div>}
              {limitsLoaded && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {agentLimits.length === 0 ? (
                    <div style={smallMuted}>No direct limit assignments configured for this Agent.</div>
                  ) : (
                    <ul style={compactList}>
                      {agentLimits.map((item) => (
                        <li key={item.id} style={compactListItem}>
                          <span>
                            <code>{item.limitProfileCode}</code> ·{' '}
                            <span style={badge(item.isActive ? 'ACTIVE' : 'INACTIVE')}>
                              {item.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>{' '}
                            · v{item.version ?? 1}
                          </span>
                          {canAssignLimit && (
                            <button
                              type="button"
                              style={smallBtn}
                              disabled={limitsBusy}
                              onClick={() => void toggleAgentLimit(item)}
                            >
                              {item.isActive ? 'Deactivate limit' : 'Activate limit'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {canAssignLimit && (
                    <form onSubmit={assignAgentLimit} style={actionRow} aria-label="Assign agent limit form">
                      {canViewLimitCatalog && limitCatalog.length > 0 && (
                        <select
                          aria-label="Select catalog limit profile"
                          value={newLimitProfileCode}
                          onChange={(e) => setNewLimitProfileCode(e.target.value)}
                          style={inlineInput}
                          disabled={limitsBusy}
                        >
                          <option value="">Choose catalog profile…</option>
                          {limitCatalog.map((profile) => (
                            <option key={profile.code} value={profile.code}>
                              {profile.code}{profile.name ? ` — ${profile.name}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        aria-label="Agent limit profile code"
                        placeholder="Profile code (e.g. AGENT_STANDARD)"
                        value={newLimitProfileCode}
                        onChange={(e) => setNewLimitProfileCode(e.target.value)}
                        style={inlineInput}
                        disabled={limitsBusy}
                      />
                      {canViewLimitCatalog && (
                        <button
                          type="button"
                          style={smallBtn}
                          disabled={limitCatalogLoading}
                          onClick={() => void loadLimitCatalog()}
                        >
                          {limitCatalogLoading ? 'Loading catalog…' : 'Load limit catalog'}
                        </button>
                      )}
                      <button type="submit" style={smallBtn} disabled={limitsBusy}>
                        Assign limit profile
                      </button>
                    </form>
                  )}
                </div>
              )}
            </section>

            {canViewTransactions && (
              <section style={card} aria-label="Agent transaction and Cash-to-Cash visibility">
                <div style={sectionHead}>
                  <strong>Agent Transaction &amp; Cash-to-Cash Visibility</strong>
                  <button
                    type="button"
                    style={smallBtn}
                    disabled={agentHistoryLoading}
                    onClick={() => void loadAgentTransactions(selected.id, position?.walletId ?? null)}
                  >
                    {agentHistoryLoading
                      ? 'Loading…'
                      : agentHistoryLoaded
                        ? 'Refresh Agent transactions'
                        : 'Load Agent transactions'}
                  </button>
                </div>
                {agentHistoryError && <div style={errBox} role="alert">{agentHistoryError}</div>}
                {agentHistoryLoaded && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <strong>Wallet Transfers ({walletTransfers.length})</strong>
                      {!position?.walletId ? (
                        <div style={smallMuted}>No NGN wallet allocated yet for wallet-transfer lookup.</div>
                      ) : walletTransfers.length === 0 ? (
                        <div style={smallMuted}>No wallet transfers recorded on wallet <code>{position.walletId}</code>.</div>
                      ) : (
                        <ul style={compactList}>
                          {walletTransfers.map((tx) => (
                            <li key={tx.id} style={compactListItem}>
                              <span>
                                <code>{tx.reference || tx.id.slice(0, 8)}</code> · {tx.direction || 'TRANSFER'} ·{' '}
                                <strong>{formatMinor(tx.amountMinor, tx.currency)}</strong>
                              </span>
                              <span style={badge(tx.status)}>{tx.status}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <strong>Cash-to-Cash Transfers ({agentC2CRows.length})</strong>
                      {agentC2CRows.length === 0 ? (
                        <div style={smallMuted}>No Cash-to-Cash transfers found for this Agent.</div>
                      ) : (
                        <ul style={compactList}>
                          {agentC2CRows.map((row) => (
                            <li key={row.id} style={compactListItem}>
                              <span>
                                <code>{row.reference || row.id.slice(0, 8)}</code> · {row.beneficiaryPhoneMasked} ·{' '}
                                <strong>{formatMinor(row.principalMinor, row.currency)}</strong>
                                {row.redemptionMethod ? ` (${row.redemptionMethod})` : ''}
                              </span>
                              <span style={badge(row.status)}>{row.status}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {canViewUnifiedHistory && (
              <section style={card} aria-label="Unified Agent history section">
                <AgentUnifiedHistoryPanel
                  agentId={selected.id}
                  canViewAgent={canViewUnifiedHistory}
                />
              </section>
            )}

            {canManageSupport && (
              <AgentTransactionPinSupportPanel
                agentId={selected.id}
                canManageSupport={canManageSupport}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const wrap: React.CSSProperties = { padding: '24px', maxWidth: 1100 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: '#032B14' };
const h3: React.CSSProperties = { margin: '0 0 4px', color: '#032B14', fontSize: 16 };
const sub: React.CSSProperties = { color: '#64748B', fontSize: 13, marginBottom: 16 };
const smallMuted: React.CSSProperties = { color: '#64748B', fontSize: 12 };
const filters: React.CSSProperties = { display: 'flex', gap: 12, marginTop: 16, marginBottom: 16, alignItems: 'center' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer' };
const smallBtn: React.CSSProperties = { padding: '6px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', fontSize: 12 };
const warnBtn: React.CSSProperties = { ...smallBtn, background: '#FFF7ED', borderColor: '#FDBA74' };
const dangerBtn: React.CSSProperties = { ...smallBtn, background: '#FEF2F2', borderColor: '#FCA5A5' };
const successBtn: React.CSSProperties = { ...smallBtn, background: '#ECFDF5', borderColor: '#6EE7B7' };
const inlineInput: React.CSSProperties = { padding: '6px 9px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12, background: '#fff' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' };
const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #F1F5F9', fontSize: 13, textAlign: 'left' };
const badge = (s: string): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
  background: s === 'ACTIVE' || s === 'APPROVED' ? '#ECFDF5' : s === 'SUSPENDED' || s === 'UNDER_REVIEW' ? '#FFF7ED' : s === 'TERMINATED' || s === 'REJECTED' ? '#FEF2F2' : '#F1F5F9',
  color: s === 'ACTIVE' || s === 'APPROVED' ? '#065F46' : s === 'SUSPENDED' || s === 'UNDER_REVIEW' ? '#92400E' : s === 'TERMINATED' || s === 'REJECTED' ? '#991B1B' : '#334155',
});
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, marginTop: 8, marginBottom: 8, fontSize: 13 };
const successBox: React.CSSProperties = { background: '#ECFDF5', border: '1px solid #6EE7B7', color: '#065F46', padding: 10, borderRadius: 6, marginTop: 8, marginBottom: 8, fontSize: 13 };
const noteBox: React.CSSProperties = { background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E3A8A', padding: 10, borderRadius: 6, marginTop: 12, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const loadingBox: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B' };
const empty: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B', background: '#fff', borderRadius: 8, border: '1px dashed #E2E8F0' };
const pager: React.CSSProperties = { marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#64748B' };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const sectionCard: React.CSSProperties = { marginTop: 16, padding: 16, border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff' };
const sectionHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' };
const drawer: React.CSSProperties = { marginTop: 16, border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', overflow: 'hidden' };
const drawerHead: React.CSSProperties = { padding: 12, background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 };
const drawerBody: React.CSSProperties = { padding: 16, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 };
const card: React.CSSProperties = { padding: 12, background: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' };
const compactList: React.CSSProperties = { listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 6 };
const compactListItem: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 8px', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6 };
