import './operational-surfaces.css';
import React, { useEffect, useRef, useState } from 'react';
import './compliance-workspace.css';
import './compliance-redesign.css';
import { Button, PageHeader, ScrollRegion } from '../../design-system/primitives';
import { ApiClient } from '../../services/api-client';
import {
  createKycRequestId,
  KycWorkforceReviewApi,
  type KycIdentityKind,
} from '../../services/kyc-governance-api';
import { useDialogFocus } from '../../utils/use-dialog-focus';
import { useAuthStore } from '../../store/auth-store';
import {
  CustomerComplianceCaseRow,
  validCustomerCase,
  validQueueComplianceCase,
} from '../../utils/compliance-case';
import { ComplianceCaseDrawer } from '../../components/ComplianceCaseDrawer';

interface ComplianceScreenProps {
  initialCustomerId?: string;
  initialCategory?: string;
  mode?: 'kyc' | 'cases';
  liveWorkspace?: boolean;
  onBackToCustomer?: () => void;
  onComplianceGuardChange?: (guarded: boolean, busy: boolean) => void;
  onNavigateToCustomer?: (customerId: string) => void;
  onNavigateToKycProviders?: () => void;
  onNavigateToKycTierPolicies?: () => void;
  onNavigateToComplianceCases?: (customerId?: string) => void;
  onNavigateToSupport?: (customerId?: string) => void;
}

interface KycTierReviewRow {
  customer_id: string;
  reason: string;
  policy_version: number | null;
  created_at: string;
  hold_reason: string | null;
}

interface OperationalKycQueueItem {
  customerId: string;
  reference: string | null;
  customerReference?: string | null;
  displayName: string | null;
  customerType: string;
  customerStatus: string;
  kycLevel: string;
  kycStatus: string;
  priorityBand?: string | null;
  assessmentReason?: string | null;
  assessedBy?: string | null;
  assessmentUpdatedAt?: string | null;
  manualHoldReason?: string | null;
  tierReviewReason?: string | null;
  tierReviewPolicyVersion?: number | null;
  onboardingStatus?: string | null;
  poaStatus?: string | null;
  updatedAt?: string;
  manualHold?: { reason: string; actor?: string | null; createdAt?: string | null } | null;
  latestEvaluation?: {
    outcome: string;
    reason?: string | null;
    createdAt?: string | null;
  } | null;
  currentAssessment?: {
    id: string;
    level?: string | null;
    status?: string | null;
    reason?: string | null;
    createdAt?: string | null;
  } | null;
}

const CUSTOMER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOVERNED_HOLD_REASONS = ['MANUAL_REVIEW', 'IDENTITY_CONFLICT', 'EVIDENCE_REVOKED'] as const;
const NON_FRAUD_CATEGORIES = [
  'AML',
  'KYC',
  'SANCTIONS',
  'PEP',
  'DOCUMENT',
  'ACCOUNT_REVIEW',
  'MANUAL_REVIEW',
  'OTHER',
] as const;

function isKycTierReviewRow(value: unknown): value is KycTierReviewRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.customer_id === 'string' &&
    CUSTOMER_UUID.test(row.customer_id) &&
    typeof row.reason === 'string' &&
    (row.policy_version === null ||
      (Number.isSafeInteger(row.policy_version) && Number(row.policy_version) >= 0)) &&
    typeof row.created_at === 'string' &&
    Number.isFinite(Date.parse(row.created_at)) &&
    (row.hold_reason === null || typeof row.hold_reason === 'string')
  );
}

function fmtShortDate(val?: string | null): string {
  if (typeof val === 'string' && Number.isFinite(Date.parse(val))) {
    return new Date(val).toLocaleString();
  }
  return '—';
}

export const ComplianceScreen: React.FC<ComplianceScreenProps> = ({
  initialCustomerId,
  initialCategory,
  mode = 'kyc',
  liveWorkspace = false,
  onBackToCustomer,
  onComplianceGuardChange,
  onNavigateToCustomer,
  onNavigateToKycProviders,
  onNavigateToKycTierPolicies,
  onNavigateToComplianceCases,
  onNavigateToSupport,
}) => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([
    sessionId,
    principal?.principalId,
    principal?.sessionId,
    principal?.type,
    principal?.assuranceLevel,
    principal?.scopes,
    principal?.roles,
    principal?.customerAccess,
    principal?.readOnlyPrincipal,
    mode,
    initialCustomerId,
    initialCategory,
  ]);
  return (
    <ComplianceWorkspace
      key={key}
      principal={principal}
      initialCustomerId={initialCustomerId}
      initialCategory={initialCategory}
      mode={mode}
      liveWorkspace={liveWorkspace}
      onBackToCustomer={onBackToCustomer}
      onComplianceGuardChange={onComplianceGuardChange}
      onNavigateToCustomer={onNavigateToCustomer}
      onNavigateToKycProviders={onNavigateToKycProviders}
      onNavigateToKycTierPolicies={onNavigateToKycTierPolicies}
      onNavigateToComplianceCases={onNavigateToComplianceCases}
      onNavigateToSupport={onNavigateToSupport}
    />
  );
};

const ComplianceWorkspace: React.FC<
  ComplianceScreenProps & { principal: ReturnType<typeof useAuthStore.getState>['principal'] }
> = ({
  principal,
  initialCustomerId,
  initialCategory,
  mode = 'kyc',
  liveWorkspace = false,
  onBackToCustomer,
  onComplianceGuardChange,
  onNavigateToCustomer,
  onNavigateToKycProviders,
  onNavigateToKycTierPolicies,
  onNavigateToComplianceCases,
  onNavigateToSupport,
}) => {
  const lookupGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const queueGeneration = useRef(0);
  const opQueueGeneration = useRef(0);
  const dossierGeneration = useRef(0);
  const caseQueueGeneration = useRef(0);
  useEffect(
    () => () => {
      lookupGeneration.current += 1;
      mutationGeneration.current += 1;
      queueGeneration.current += 1;
      opQueueGeneration.current += 1;
      dossierGeneration.current += 1;
      caseQueueGeneration.current += 1;
    },
    [],
  );
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const canViewKyc = hasFn('kyc.view');
  const canLoadTierReviewQueue =
    mode === 'kyc' && hasFn('kyc.review') && principal?.assuranceLevel === 'MFA';
  const availableKycStatuses = [
    ...(hasFn('kyc.review') ? ['NOT_STARTED', 'PENDING'] : []),
    ...(hasFn('kyc.approve') ? ['APPROVED'] : []),
    ...(hasFn('kyc.reject') ? ['REJECTED'] : []),
  ];
  const canSubmitKyc = availableKycStatuses.length > 0 && !principal?.readOnlyPrincipal;
  const canManageCases = hasFn('compliance.manage_case');
  const canMutateCases = canManageCases && !principal?.readOnlyPrincipal;
  const canAccess =
    mode === 'cases' ? canManageCases : canViewKyc || availableKycStatuses.length > 0;
  const canUseOperationalKycWorkspace =
    mode === 'kyc' && canAccess && principal?.assuranceLevel === 'MFA';

  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [kyc, setKyc] = useState<any>(null);
  const [kycDossier, setKycDossier] = useState<any>(null);
  const [kycDossierLoading, setKycDossierLoading] = useState(false);
  const [kycDossierError, setKycDossierError] = useState('');
  const [workforceConsentConfirmed, setWorkforceConsentConfirmed] = useState(false);
  const [workforceVerificationBusy, setWorkforceVerificationBusy] = useState(false);
  const [workforceVerificationMessage, setWorkforceVerificationMessage] = useState('');
  const [workforceVerificationError, setWorkforceVerificationError] = useState('');

  // Operational KYC Queue state
  const [opQueueItems, setOpQueueItems] = useState<OperationalKycQueueItem[]>([]);
  const [opQueueCounts, setOpQueueCounts] = useState<{
    total: number;
    actionable: number;
    pending: number;
    rejected: number;
    notStarted: number;
    approved: number;
    tierReviewHolds: number;
  } | null>(null);
  const [opQueueLoaded, setOpQueueLoaded] = useState(false);
  const [opQueueLoading, setOpQueueLoading] = useState(false);
  const [opQueueError, setOpQueueError] = useState('');
  const [opQueueStatus, setOpQueueStatus] = useState('ACTIONABLE');
  const [opQueueLevel, setOpQueueLevel] = useState('ALL');
  const [opQueueSearch, setOpQueueSearch] = useState('');
  const [opQueuePage, setOpQueuePage] = useState(1);
  const [opQueueTotalPages, setOpQueueTotalPages] = useState(1);

  // Operational Compliance Case Queue state
  const [queueCases, setQueueCases] = useState<CustomerComplianceCaseRow[]>([]);
  const [queueCounts, setQueueCounts] = useState<{
    total: number;
    open: number;
    escalated: number;
    underReview: number;
    pendingCustomer: number;
    unassigned: number;
    criticalOrHigh: number;
  } | null>(null);
  const [queueCasesLoaded, setQueueCasesLoaded] = useState(false);
  const [queueCasesLoading, setQueueCasesLoading] = useState(false);
  const [queueCasesError, setQueueCasesError] = useState('');
  const [queueStatusFilter, setQueueStatusFilter] = useState('ALL');
  const [queueSeverityFilter, setQueueSeverityFilter] = useState('ALL');
  const [queueCategoryFilter, setQueueCategoryFilter] = useState('ALL');
  const [queueAssignedFilter, setQueueAssignedFilter] = useState('ALL');
  const [queueSearch, setQueueSearch] = useState('');
  const [queuePage, setQueuePage] = useState(1);
  const [queueTotalPages, setQueueTotalPages] = useState(1);

  // Create Case state
  const [showCreateCase, setShowCreateCase] = useState(false);
  const [newCaseCustomerId, setNewCaseCustomerId] = useState(initialCustomerId || '');
  const [newCaseNumber, setNewCaseNumber] = useState('');
  const [newCaseCategory, setNewCaseCategory] = useState('AML');
  const [newCaseSeverity, setNewCaseSeverity] = useState('HIGH');
  const [creatingCase, setCreatingCase] = useState(false);
  const [createCaseMsg, setCreateCaseMsg] = useState('');
  const [createCaseErr, setCreateCaseErr] = useState('');

  const [cases, setCases] = useState<CustomerComplianceCaseRow[]>([]);
  const [selectedCase, setSelectedCase] = useState<CustomerComplianceCaseRow | null>(null);
  const [reviewQueue, setReviewQueue] = useState<KycTierReviewRow[]>([]);
  const [reviewQueueLoaded, setReviewQueueLoaded] = useState(false);
  const [reviewQueueLoading, setReviewQueueLoading] = useState(false);
  const [reviewQueueError, setReviewQueueError] = useState('');
  const [caseCategory, setCaseCategory] = useState(initialCategory || 'ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [kycLevel, setKycLevel] = useState('LEVEL_1');
  const [kycStatus, setKycStatus] = useState('APPROVED');
  const [kycReason, setKycReason] = useState('');
  const [assessMsg, setAssessMsg] = useState('');
  const [assessErr, setAssessErr] = useState('');
  const [assessing, setAssessing] = useState(false);
  const [decisionDirty, setDecisionDirty] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<{
    id: string;
    level: string;
    status: string;
    reason: string;
  } | null>(null);
  const [uncertain, setUncertain] = useState<{ id: string; level: string; status: string } | null>(
    null,
  );
  const [completedDecision, setCompletedDecision] = useState<{
    id: string;
    level: string;
    status: string;
  } | null>(null);
  const [reviewReady, setReviewReady] = useState(false);
  const mutationInFlight = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(
    dialogRef,
    Boolean(pendingDecision),
    () => {
      if (!mutationInFlight.current) setPendingDecision(null);
    },
    triggerRef,
  );
  useEffect(() => {
    if (assessing) dialogRef.current?.focus();
  }, [assessing]);
  const complianceGuard =
    mode === 'kyc' &&
    (decisionDirty ||
      assessing ||
      Boolean(pendingDecision) ||
      Boolean(uncertain) ||
      Boolean(completedDecision));
  useEffect(() => {
    onComplianceGuardChange?.(complianceGuard, assessing);
  }, [onComplianceGuardChange, complianceGuard, assessing]);
  useEffect(() => () => onComplianceGuardChange?.(false, false), [onComplianceGuardChange]);
  useEffect(() => {
    if (!complianceGuard) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [complianceGuard]);

  useEffect(() => {
    if (availableKycStatuses.length > 0 && !availableKycStatuses.includes(kycStatus)) {
      const fallback = availableKycStatuses.includes('APPROVED')
        ? 'APPROVED'
        : availableKycStatuses.includes('PENDING')
          ? 'PENDING'
          : availableKycStatuses[0];
      setKycStatus(fallback);
      if (fallback === 'PENDING' || fallback === 'REJECTED') {
        setKycLevel('NONE');
      }
    }
  }, [availableKycStatuses.join('|'), kycStatus]);

  const loadCustomerKycDossier = async (targetCustomerId: string) => {
    const id = targetCustomerId.trim();
    if (!canUseOperationalKycWorkspace || !CUSTOMER_UUID.test(id)) return;
    const gen = ++dossierGeneration.current;
    setKycDossierLoading(true);
    setKycDossierError('');
    try {
      const response: any = await Promise.resolve(
        ApiClient.get(`/internal/kyc/review-workspace/customers/${encodeURIComponent(id)}`),
      );
      if (gen !== dossierGeneration.current) return;
      if (response && typeof response === 'object' && response.customer?.id === id) {
        setKycDossier(response);
      }
    } catch (err: any) {
      if (gen === dossierGeneration.current) {
        setKycDossierError(err?.message || 'Unable to load extended KYC review dossier.');
      }
    } finally {
      if (gen === dossierGeneration.current) setKycDossierLoading(false);
    }
  };

  const verifyRegisteredIdentity = async (kind: KycIdentityKind) => {
    const customerId = String(kycDossier?.customer?.id ?? '').trim();
    const notice = kycDossier?.consentNotice;
    if (!CUSTOMER_UUID.test(customerId) || !notice?.version || !workforceConsentConfirmed) {
      setWorkforceVerificationError(
        'Review the active notice and confirm customer consent before verification.',
      );
      return;
    }
    setWorkforceVerificationBusy(true);
    setWorkforceVerificationError('');
    setWorkforceVerificationMessage('');
    try {
      const result = await KycWorkforceReviewApi.verifyRegisteredIdentity(customerId, {
        kind,
        customerConsentConfirmed: true,
        noticeVersion: notice.version,
        consentRequestId: createKycRequestId(),
        requestId: createKycRequestId(),
      });
      setWorkforceVerificationMessage(
        `${kind} verification ${result.status} · consent ${result.consentId} → attempt ${result.id} · ${result.provider} route v${result.routeVersion}`,
      );
      setWorkforceConsentConfirmed(false);
      await loadCustomerKycDossier(customerId);
    } catch (err: any) {
      setWorkforceVerificationError(
        err?.message || 'Identity verification could not be completed.',
      );
    } finally {
      setWorkforceVerificationBusy(false);
    }
  };

  const loadOperationalKycQueue = async (
    overrides?: Partial<{ status: string; level: string; search: string; page: number }>,
  ) => {
    if (!canUseOperationalKycWorkspace) return;
    const gen = ++opQueueGeneration.current;
    setOpQueueLoading(true);
    setOpQueueError('');
    const nextStatus = overrides?.status ?? opQueueStatus;
    const nextLevel = overrides?.level ?? opQueueLevel;
    const nextSearch = overrides?.search ?? opQueueSearch;
    const nextPage = overrides?.page ?? opQueuePage;
    try {
      const qs = new URLSearchParams({
        status: nextStatus,
        level: nextLevel,
        page: String(nextPage),
        limit: '15',
      });
      if (nextSearch.trim()) qs.set('search', nextSearch.trim());
      const res: any = await Promise.resolve(
        ApiClient.get(`/internal/kyc/review-workspace/queue?${qs.toString()}`),
      );
      if (gen !== opQueueGeneration.current) return;
      if (res && Array.isArray(res.items)) {
        setOpQueueItems(res.items as OperationalKycQueueItem[]);
        setOpQueueCounts(res.counts ?? null);
        setOpQueueTotalPages(Math.max(1, Number(res.pagination?.totalPages ?? 1)));
        setOpQueueLoaded(true);
      }
    } catch (err: any) {
      if (gen === opQueueGeneration.current) {
        setOpQueueError(err?.message || 'Operational KYC review queue is unavailable.');
      }
    } finally {
      if (gen === opQueueGeneration.current) setOpQueueLoading(false);
    }
  };

  const loadComplianceCaseQueue = async (
    overrides?: Partial<{
      status: string;
      severity: string;
      category: string;
      assignedTo: string;
      search: string;
      page: number;
    }>,
  ) => {
    if (mode !== 'cases' || !canManageCases) return;
    const gen = ++caseQueueGeneration.current;
    setQueueCasesLoading(true);
    setQueueCasesError('');
    const st = overrides?.status ?? queueStatusFilter;
    const sev = overrides?.severity ?? queueSeverityFilter;
    const cat = overrides?.category ?? queueCategoryFilter;
    const asgn = overrides?.assignedTo ?? queueAssignedFilter;
    const srch = overrides?.search ?? queueSearch;
    const pg = overrides?.page ?? queuePage;
    try {
      const qs = new URLSearchParams({
        scope: 'COMPLIANCE',
        status: st,
        severity: sev,
        category: cat,
        assignedTo: asgn,
        page: String(pg),
        limit: '20',
      });
      if (srch.trim()) qs.set('search', srch.trim());
      const res: any = await Promise.resolve(
        ApiClient.get(`/internal/compliance-cases?${qs.toString()}`),
      );
      if (gen !== caseQueueGeneration.current) return;
      if (res && Array.isArray(res.items) && res.items.every(validQueueComplianceCase)) {
        setQueueCases(res.items.filter((r: CustomerComplianceCaseRow) => r.category !== 'FRAUD'));
        setQueueCounts(res.counts ?? null);
        setQueueTotalPages(Math.max(1, Number(res.pagination?.totalPages ?? 1)));
        setQueueCasesLoaded(true);
      }
    } catch (err: any) {
      if (gen === caseQueueGeneration.current) {
        setQueueCasesError(err?.message || 'Compliance case queue is unavailable.');
      }
    } finally {
      if (gen === caseQueueGeneration.current) setQueueCasesLoading(false);
    }
  };

  const fetchForCustomer = async (requestedCustomerId = customerId, alsoLoadDossier = false) => {
    const id = requestedCustomerId.trim();
    if (!id) {
      setError('Enter a customer UUID');
      return;
    }
    if (!canAccess) return;
    const request = ++lookupGeneration.current;
    const valid = () => request === lookupGeneration.current;
    setLoading(true);
    setError('');
    setSearched(false);
    setKyc(null);
    setKycDossier(null);
    setKycDossierError('');
    setCases([]);
    setSelectedCase(null);
    const errors: string[] = [];

    const requests: Promise<void>[] = [];
    if (mode === 'kyc' && canViewKyc) {
      requests.push(
        Promise.resolve(ApiClient.get(`/customers/${encodeURIComponent(id)}/kyc`))
          .then((record: any) => {
            if (
              !record ||
              typeof record !== 'object' ||
              Array.isArray(record) ||
              typeof record.level !== 'string' ||
              typeof record.status !== 'string' ||
              record.customerId !== id
            )
              throw new Error('KYC lookup returned an invalid response.');
            if (valid()) setKyc(record);
          })
          .catch((err: any) => {
            errors.push(
              err?.status === 404
                ? 'Customer or current KYC assessment not found.'
                : err?.message || 'KYC assessment lookup failed',
            );
          }),
      );
    }
    if (mode === 'cases' && canManageCases) {
      requests.push(
        Promise.resolve(ApiClient.get(`/customers/${encodeURIComponent(id)}/compliance-cases`))
          .then((response: any) => {
            const rows = Array.isArray(response) ? response : (response?.data ?? response?.items);
            if (!Array.isArray(rows) || rows.some((row: unknown) => !validCustomerCase(row, id)))
              throw new Error('Compliance lookup returned an invalid response.');
            if (valid()) setCases(rows);
          })
          .catch((err: any) => {
            errors.push(err?.message || 'Compliance case lookup failed');
          }),
      );
    }

    await Promise.all(requests);
    if (!valid()) return;
    if (errors.length > 0) setError(errors.join('; '));
    else {
      setSearched(requests.length > 0);
      if (mode === 'kyc' && (liveWorkspace || alsoLoadDossier) && CUSTOMER_UUID.test(id)) {
        void loadCustomerKycDossier(id);
      }
    }
    setLoading(false);
  };

  const refreshReviewQueue = async () => {
    if (!canLoadTierReviewQueue || reviewQueueLoading) return;
    const request = ++queueGeneration.current;
    setReviewQueue([]);
    setReviewQueueLoaded(false);
    setReviewQueueError('');
    setReviewQueueLoading(true);
    try {
      const rows: unknown = await ApiClient.get('/internal/kyc/tier-reviews');
      if (request !== queueGeneration.current) return;
      if (!Array.isArray(rows) || rows.some((row) => !isKycTierReviewRow(row)))
        throw new Error('KYC review queue returned an invalid response.');
      setReviewQueue(rows as KycTierReviewRow[]);
    } catch (caught) {
      if (request === queueGeneration.current) {
        setReviewQueue([]);
        setReviewQueueError(
          caught instanceof Error ? caught.message : 'KYC review queue is unavailable.',
        );
      }
    } finally {
      if (request === queueGeneration.current) {
        setReviewQueueLoaded(true);
        setReviewQueueLoading(false);
      }
    }
  };

  useEffect(() => {
    if (liveWorkspace && canAccess) {
      if (mode === 'kyc') {
        void loadOperationalKycQueue();
        if (canLoadTierReviewQueue) void refreshReviewQueue();
      } else if (mode === 'cases') {
        void loadComplianceCaseQueue();
      }
    }
    if (!initialCustomerId || !canAccess) return;
    setCustomerId(initialCustomerId);
    setNewCaseCustomerId(initialCustomerId);
    void fetchForCustomer(initialCustomerId, liveWorkspace);
  }, [initialCustomerId, canAccess, mode, liveWorkspace]);

  const handleCreateComplianceCase = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canMutateCases || creatingCase) return;
    const targetCust = newCaseCustomerId.trim() || customerId.trim();
    const normalizedNum = newCaseNumber.trim().toLowerCase();
    if (!CUSTOMER_UUID.test(targetCust)) {
      setCreateCaseErr('Enter a valid Customer UUID to open a compliance case.');
      return;
    }
    if (!/^[a-z0-9][a-z0-9_.:-]{0,99}$/.test(normalizedNum)) {
      setCreateCaseErr(
        'Case number must start with lowercase alphanumeric and contain only a-z, 0-9, -, _, ., :.',
      );
      return;
    }
    setCreatingCase(true);
    setCreateCaseErr('');
    setCreateCaseMsg('');
    try {
      const created = await ApiClient.post<CustomerComplianceCaseRow>(
        `/customers/${encodeURIComponent(targetCust)}/compliance-cases`,
        {
          caseNumber: normalizedNum,
          category: newCaseCategory,
          severity: newCaseSeverity,
        },
      );
      if (!created || typeof created.id !== 'string') {
        throw new Error('Case creation response was invalid.');
      }
      setCreateCaseMsg(`Created compliance case ${created.caseNumber}.`);
      setNewCaseNumber('');
      setShowCreateCase(false);
      if (customerId.trim() === targetCust) {
        void fetchForCustomer(targetCust);
      }
      if (liveWorkspace || queueCasesLoaded) {
        void loadComplianceCaseQueue();
      }
      setSelectedCase(created);
    } catch (err: any) {
      setCreateCaseErr(err?.message || 'Failed to create compliance case.');
    } finally {
      setCreatingCase(false);
    }
  };

  const beginAssessment = (event: React.FormEvent) => {
    event.preventDefault();
    if (
      loading ||
      assessing ||
      mutationInFlight.current ||
      pendingDecision ||
      uncertain ||
      completedDecision ||
      !canSubmitKyc ||
      !availableKycStatuses.includes(kycStatus) ||
      !customerId.trim() ||
      !principal?.principalId
    )
      return;
    const effectiveLevel = kycStatus === 'PENDING' || kycStatus === 'REJECTED' ? 'NONE' : kycLevel;
    const effectiveReason =
      (kycStatus === 'PENDING' || kycStatus === 'REJECTED') && !kycReason.trim()
        ? 'MANUAL_REVIEW'
        : kycReason.trim();
    setPendingDecision({
      id: customerId.trim(),
      level: effectiveLevel,
      status: kycStatus,
      reason: effectiveReason,
    });
  };

  const reviewAssessment = async () => {
    if (!uncertain || !canViewKyc || assessing || loading) return;
    const request = ++lookupGeneration.current;
    setLoading(true);
    setReviewReady(false);
    setError('');
    setKyc(null);
    setSearched(false);
    try {
      const record: any = await ApiClient.get(`/customers/${encodeURIComponent(uncertain.id)}/kyc`);
      if (request !== lookupGeneration.current) return;
      if (
        !record ||
        record.customerId !== uncertain.id ||
        !['NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3'].includes(record.level) ||
        !['NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED'].includes(record.status)
      )
        throw new Error('KYC review response did not match the customer.');
      setKyc(record);
      setSearched(true);
      setReviewReady(true);
    } catch (err: any) {
      if (request === lookupGeneration.current)
        setError(
          err?.status === 404
            ? 'Customer or current KYC assessment not found; review remains required.'
            : err?.message || 'KYC review failed.',
        );
    } finally {
      if (request === lookupGeneration.current) setLoading(false);
    }
  };

  const submitAssessment = async () => {
    if (
      !pendingDecision ||
      assessing ||
      mutationInFlight.current ||
      uncertain ||
      completedDecision ||
      !canSubmitKyc ||
      !availableKycStatuses.includes(pendingDecision.status) ||
      !principal?.principalId
    )
      return;
    const decision = pendingDecision;
    const request = ++mutationGeneration.current;
    mutationInFlight.current = true;
    setAssessErr('');
    setAssessMsg('');
    setAssessing(true);
    try {
      const receipt: any = await ApiClient.post(
        `/customers/${encodeURIComponent(decision.id)}/kyc-assessment`,
        {
          level: decision.level,
          status: decision.status,
          reason: decision.reason || undefined,
          assessedBy: principal.principalId,
        },
      );
      if (request !== mutationGeneration.current) return;
      if (
        !receipt ||
        typeof receipt.id !== 'string' ||
        !receipt.id.trim() ||
        receipt.customerId !== decision.id ||
        receipt.level !== decision.level ||
        receipt.status !== decision.status ||
        (receipt.assessedBy !== undefined && receipt.assessedBy !== principal.principalId) ||
        (receipt.reason !== undefined && (receipt.reason ?? '') !== decision.reason) ||
        (receipt.isCurrent !== undefined && receipt.isCurrent !== true)
      )
        throw new Error('Assessment receipt did not match the decision.');
      setDecisionDirty(false);
      setKycReason('');
      setCompletedDecision({ id: decision.id, level: decision.level, status: decision.status });
      setAssessMsg('KYC assessment submitted.');
      if (canViewKyc) await fetchForCustomer(decision.id, liveWorkspace || Boolean(kycDossier));
      if (canLoadTierReviewQueue) void refreshReviewQueue();
      if (liveWorkspace || opQueueLoaded) void loadOperationalKycQueue();
    } catch (err: any) {
      if (request === mutationGeneration.current) {
        lookupGeneration.current++;
        setLoading(false);
        setReviewReady(false);
        setUncertain({ id: decision.id, level: decision.level, status: decision.status });
        setAssessErr(
          `Assessment outcome not confirmed. Check the customer assessment and audit trail before retrying. ${err?.message || 'Service unavailable.'}`,
        );
      }
    } finally {
      mutationInFlight.current = false;
      if (request === mutationGeneration.current) {
        setAssessing(false);
        setPendingDecision(null);
      }
    }
  };

  const syncUpdatedCase = (updated: CustomerComplianceCaseRow) => {
    setSelectedCase(updated);
    setCases((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
    setQueueCases((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  };

  if (!canAccess) {
    return (
      <div className="mn-operational" style={wrap} role="alert">
        <div style={denied}>
          {mode === 'cases'
            ? 'Compliance case lookup requires compliance.manage_case.'
            : 'KYC assessment lookup or action requires kyc.view, kyc.review, kyc.approve, or kyc.reject.'}
        </div>
      </div>
    );
  }

  const visibleCases = cases.filter(
    (item) =>
      item.category !== 'FRAUD' && (caseCategory === 'ALL' || item.category === caseCategory),
  );

  const nonFraudCases = cases.filter((item) => item.category !== 'FRAUD');

  return (
    <div className="mn-operational mn-compliance compliance-workspace" style={wrap}>
      <PageHeader
        eyebrow="Compliance and risk"
        title={mode === 'cases' ? 'Compliance case lookup' : 'KYC assessment lookup & review'}
        description={
          mode === 'cases'
            ? 'Triage the non-FRAUD compliance case queue, open new cases, or look up compliance cases for a customer.'
            : 'Inspect the operational KYC review queue, evaluate customer tier evidence & blockers, and submit governed KYC decisions.'
        }
      />

      {mode === 'kyc' &&
        (onNavigateToKycProviders ||
          onNavigateToKycTierPolicies ||
          onNavigateToComplianceCases) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {onNavigateToKycProviders && hasFn('kyc.provider.view') && (
              <Button variant="secondary" onClick={onNavigateToKycProviders}>
                KYC Provider Governance →
              </Button>
            )}
            {onNavigateToKycTierPolicies && hasFn('kyc.policy.view') && (
              <Button variant="secondary" onClick={onNavigateToKycTierPolicies}>
                KYC Tier Policy Governance →
              </Button>
            )}
            {onNavigateToComplianceCases && canManageCases && (
              <Button
                variant="secondary"
                onClick={() => onNavigateToComplianceCases(customerId.trim() || undefined)}
              >
                Compliance Cases →
              </Button>
            )}
          </div>
        )}

      {canUseOperationalKycWorkspace && (
        <section
          className="compliance-workspace__panel"
          aria-labelledby="operational-kyc-queue-heading"
          data-testid="operational-kyc-queue-panel"
        >
          <div className="compliance-workspace__heading">
            <div>
              <p className="compliance-workspace__eyebrow">OPERATIONAL WORKSPACE</p>
              <h2 id="operational-kyc-queue-heading">Operational KYC customer queue</h2>
              <p>
                Institution-scoped customer KYC queue with tier progression, verification status,
                manual holds, and proof-of-address state.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => void loadOperationalKycQueue()}
              disabled={opQueueLoading}
            >
              {opQueueLoading
                ? 'Loading operational queue…'
                : opQueueLoaded
                  ? 'Refresh operational queue'
                  : 'Load operational KYC queue'}
            </Button>
          </div>

          {opQueueCounts && (
            <div style={kpiGridStyle} data-testid="operational-kyc-kpis">
              <div style={kpiCardStyle}>
                <span>Actionable</span>
                <strong>
                  {(opQueueCounts as any).actionable ?? (opQueueCounts as any).total ?? 0}
                </strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Pending</span>
                <strong>
                  {(opQueueCounts as any).pending ?? (opQueueCounts as any).pendingReview ?? 0}
                </strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Rejected</span>
                <strong>{opQueueCounts.rejected ?? 0}</strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Not Started</span>
                <strong>{opQueueCounts.notStarted ?? 0}</strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Approved</span>
                <strong>{opQueueCounts.approved ?? 0}</strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Manual / Auto Holds</span>
                <strong>
                  {(opQueueCounts as any).tierReviewHolds ??
                    (opQueueCounts as any).manualHolds ??
                    0}
                </strong>
              </div>
            </div>
          )}

          <div style={filterBarStyle}>
            <label style={inlineFilterLabel}>
              Queue slice
              <select
                aria-label="Operational KYC status filter"
                value={opQueueStatus}
                onChange={(e) => {
                  const next = e.target.value;
                  setOpQueueStatus(next);
                  setOpQueuePage(1);
                  void loadOperationalKycQueue({ status: next, page: 1 });
                }}
              >
                <option value="ACTIONABLE">Actionable (Pending / Rejected / Holds)</option>
                <option value="PENDING">Pending reviews</option>
                <option value="REJECTED">Rejected reviews</option>
                <option value="NOT_STARTED">Not started</option>
                <option value="APPROVED">Approved customers</option>
                <option value="ALL">All customers</option>
              </select>
            </label>
            <label style={inlineFilterLabel}>
              Tier
              <select
                aria-label="Operational KYC tier filter"
                value={opQueueLevel}
                onChange={(e) => {
                  const next = e.target.value;
                  setOpQueueLevel(next);
                  setOpQueuePage(1);
                  void loadOperationalKycQueue({ level: next, page: 1 });
                }}
              >
                <option value="ALL">All tiers</option>
                <option value="NONE">Tier 0 (None)</option>
                <option value="LEVEL_1">Tier 1</option>
                <option value="LEVEL_2">Tier 2</option>
                <option value="LEVEL_3">Tier 3</option>
              </select>
            </label>
            <label style={inlineFilterLabel}>
              Search customer
              <input
                aria-label="Search operational KYC queue"
                value={opQueueSearch}
                onChange={(e) => setOpQueueSearch(e.target.value)}
                placeholder="Name, reference, or UUID"
              />
            </label>
            <button
              type="button"
              className="compliance-case-detail"
              disabled={opQueueLoading}
              onClick={() => {
                setOpQueuePage(1);
                void loadOperationalKycQueue({ page: 1 });
              }}
            >
              Apply filter
            </button>
          </div>

          {opQueueError && (
            <div
              className="compliance-workspace__state compliance-workspace__state--error"
              role="alert"
            >
              {opQueueError}
            </div>
          )}
          {opQueueLoaded && !opQueueError && opQueueItems.length === 0 && (
            <div className="compliance-workspace__state">
              No customers match the selected operational KYC queue filter.
            </div>
          )}
          {opQueueItems.length > 0 && !opQueueError && (
            <>
              <ScrollRegion
                label="Operational KYC queue"
                hint="Scroll horizontally to see all columns."
              >
                <table className="compliance-workspace__table">
                  <thead>
                    <tr>
                      <th scope="col">Customer</th>
                      <th scope="col">Status &amp; Tier</th>
                      <th scope="col">Hold / Review Signal</th>
                      <th scope="col">PoA</th>
                      <th scope="col">Updated</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opQueueItems.map((row) => (
                      <tr key={row.customerId}>
                        <td>
                          <div>
                            <strong>
                              {row.displayName || row.reference || row.customerId.slice(0, 8)}
                            </strong>
                          </div>
                          <div style={{ fontSize: 11, color: '#64748B' }}>
                            <code>{row.customerId}</code>
                            {row.reference ? ` · ${row.reference}` : ''}
                          </div>
                        </td>
                        <td>
                          <span className="compliance-workspace__badge">{row.kycStatus}</span> ·{' '}
                          <strong>{row.kycLevel}</strong>
                        </td>
                        <td>
                          {row.manualHoldReason ||
                            row.manualHold?.reason ||
                            row.tierReviewReason ||
                            row.latestEvaluation?.reason ||
                            row.assessmentReason ||
                            row.currentAssessment?.reason ||
                            '—'}
                        </td>
                        <td>{row.poaStatus || row.priorityBand || '—'}</td>
                        <td>
                          {fmtShortDate(
                            row.assessmentUpdatedAt ||
                              row.manualHold?.createdAt ||
                              row.latestEvaluation?.createdAt ||
                              row.currentAssessment?.createdAt ||
                              row.updatedAt,
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="compliance-case-detail"
                            aria-label={`Review customer ${row.customerId}`}
                            onClick={() => {
                              setCustomerId(row.customerId);
                              setError('');
                              setSearched(false);
                              if (canViewKyc) void fetchForCustomer(row.customerId, true);
                              else void loadCustomerKycDossier(row.customerId);
                            }}
                          >
                            Review customer
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
              {opQueueTotalPages > 1 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>
                    Page {opQueuePage} of {opQueueTotalPages}
                  </span>
                  <button
                    type="button"
                    className="compliance-case-detail"
                    disabled={opQueuePage <= 1 || opQueueLoading}
                    onClick={() => {
                      const prev = Math.max(1, opQueuePage - 1);
                      setOpQueuePage(prev);
                      void loadOperationalKycQueue({ page: prev });
                    }}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className="compliance-case-detail"
                    disabled={opQueuePage >= opQueueTotalPages || opQueueLoading}
                    onClick={() => {
                      const next = opQueuePage + 1;
                      setOpQueuePage(next);
                      void loadOperationalKycQueue({ page: next });
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {canLoadTierReviewQueue && (
        <section
          className="compliance-workspace__panel"
          aria-labelledby="kyc-tier-review-queue-heading"
        >
          <div className="compliance-workspace__heading">
            <div>
              <p className="compliance-workspace__eyebrow">AUTOMATED TIER REVIEW</p>
              <h2 id="kyc-tier-review-queue-heading">KYC review queue</h2>
              <p>
                This queue contains customer IDs and machine reason codes only. Provider evidence
                and identity values are not included.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => void refreshReviewQueue()}
              disabled={reviewQueueLoading}
            >
              {reviewQueueLoading ? 'Loading queue…' : 'Refresh review queue'}
            </Button>
          </div>
          {reviewQueueError ? (
            <div className="compliance-workspace__state" role="alert">
              {reviewQueueError}
            </div>
          ) : null}
          {reviewQueueLoaded && !reviewQueueError && reviewQueue.length === 0 ? (
            <div className="compliance-workspace__state">
              No current KYC tier items are awaiting review.
            </div>
          ) : null}
          {reviewQueue.length > 0 && !reviewQueueError ? (
            <ScrollRegion label="KYC review queue" hint="Scroll horizontally to see all columns.">
              <table className="compliance-workspace__table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Policy version</th>
                    <th scope="col">Opened</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewQueue.map((item) => (
                    <tr key={item.customer_id}>
                      <td>
                        <code>{item.customer_id}</code>
                      </td>
                      <td>{item.hold_reason ?? item.reason}</td>
                      <td>{item.policy_version ?? '—'}</td>
                      <td>{item.created_at}</td>
                      <td>
                        <button
                          type="button"
                          className="compliance-case-detail"
                          aria-label={`Open KYC review for ${item.customer_id}`}
                          onClick={() => {
                            setCustomerId(item.customer_id);
                            setError('');
                            setSearched(false);
                            if (canViewKyc) void fetchForCustomer(item.customer_id);
                          }}
                        >
                          Open customer review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          ) : null}
        </section>
      )}

      {mode === 'cases' && canManageCases && (
        <section
          className="compliance-workspace__panel"
          aria-labelledby="compliance-case-queue-heading"
          data-testid="compliance-case-queue-panel"
        >
          <div className="compliance-workspace__heading">
            <div>
              <p className="compliance-workspace__eyebrow">COMPLIANCE CASE QUEUE</p>
              <h2 id="compliance-case-queue-heading">Non-FRAUD compliance case queue</h2>
              <p>
                Institution-scoped triage queue across AML, KYC, Sanctions, PEP, Document, Account
                Review, and Manual Review cases.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canMutateCases && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setShowCreateCase((open) => !open);
                    setCreateCaseErr('');
                    setCreateCaseMsg('');
                  }}
                >
                  {showCreateCase ? 'Close new case form' : '+ Open compliance case'}
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => void loadComplianceCaseQueue()}
                disabled={queueCasesLoading}
              >
                {queueCasesLoading
                  ? 'Loading queue…'
                  : queueCasesLoaded
                    ? 'Refresh case queue'
                    : 'Load compliance queue'}
              </Button>
            </div>
          </div>

          {createCaseMsg && (
            <div
              className="compliance-workspace__state compliance-workspace__state--success"
              role="status"
            >
              {createCaseMsg}
            </div>
          )}

          {showCreateCase && canMutateCases && (
            <form
              onSubmit={handleCreateComplianceCase}
              style={{ ...subPanelStyle, marginBottom: 14 }}
              aria-label="Create compliance case"
            >
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
                Open new non-FRAUD compliance case
              </h3>
              {createCaseErr && (
                <div
                  className="compliance-workspace__state compliance-workspace__state--error"
                  role="alert"
                  style={{ marginBottom: 8 }}
                >
                  {createCaseErr}
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                  gap: 10,
                }}
              >
                <label style={inlineFilterLabel}>
                  Target customer UUID
                  <input
                    aria-label="New case customer UUID"
                    value={newCaseCustomerId}
                    onChange={(e) => setNewCaseCustomerId(e.target.value)}
                    placeholder="Customer UUID"
                  />
                </label>
                <label style={inlineFilterLabel}>
                  Case number (lowercase)
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      aria-label="New case number"
                      value={newCaseNumber}
                      onChange={(e) => setNewCaseNumber(e.target.value)}
                      placeholder="aml-2026-0042"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="compliance-case-detail"
                      onClick={() =>
                        setNewCaseNumber(
                          `${newCaseCategory.toLowerCase().replace(/_/g, '-')}-${Date.now().toString(36)}`,
                        )
                      }
                    >
                      Generate
                    </button>
                  </div>
                </label>
                <label style={inlineFilterLabel}>
                  Category
                  <select
                    aria-label="New case category"
                    value={newCaseCategory}
                    onChange={(e) => setNewCaseCategory(e.target.value)}
                  >
                    {NON_FRAUD_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={inlineFilterLabel}>
                  Severity
                  <select
                    aria-label="New case severity"
                    value={newCaseSeverity}
                    onChange={(e) => setNewCaseSeverity(e.target.value)}
                  >
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </label>
              </div>
              <div style={{ marginTop: 10 }}>
                <Button type="submit" variant="primary" disabled={creatingCase}>
                  {creatingCase ? 'Creating…' : 'Create compliance case'}
                </Button>
              </div>
            </form>
          )}

          {queueCounts && (
            <div style={kpiGridStyle} data-testid="compliance-case-kpis">
              <div style={kpiCardStyle}>
                <span>Total Cases</span>
                <strong>{queueCounts.total}</strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Escalated</span>
                <strong>{queueCounts.escalated}</strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Open</span>
                <strong>{queueCounts.open}</strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Under Review</span>
                <strong>{queueCounts.underReview}</strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Unassigned</span>
                <strong>{queueCounts.unassigned}</strong>
              </div>
              <div style={kpiCardStyle}>
                <span>Critical / High</span>
                <strong>{queueCounts.criticalOrHigh}</strong>
              </div>
            </div>
          )}

          <div style={filterBarStyle}>
            <label style={inlineFilterLabel}>
              Queue status
              <select
                aria-label="Compliance queue status"
                value={queueStatusFilter}
                onChange={(e) => {
                  const next = e.target.value;
                  setQueueStatusFilter(next);
                  setQueuePage(1);
                  void loadComplianceCaseQueue({ status: next, page: 1 });
                }}
              >
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">Active (Unresolved)</option>
                <option value="ESCALATED">ESCALATED</option>
                <option value="OPEN">OPEN</option>
                <option value="UNDER_REVIEW">UNDER_REVIEW</option>
                <option value="PENDING_CUSTOMER">PENDING_CUSTOMER</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </label>
            <label style={inlineFilterLabel}>
              Queue severity
              <select
                aria-label="Compliance queue severity"
                value={queueSeverityFilter}
                onChange={(e) => {
                  const next = e.target.value;
                  setQueueSeverityFilter(next);
                  setQueuePage(1);
                  void loadComplianceCaseQueue({ severity: next, page: 1 });
                }}
              >
                <option value="ALL">All severities</option>
                <option value="CRITICAL">CRITICAL</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>
            </label>
            <label style={inlineFilterLabel}>
              Queue category
              <select
                aria-label="Compliance queue category"
                value={queueCategoryFilter}
                onChange={(e) => {
                  const next = e.target.value;
                  setQueueCategoryFilter(next);
                  setQueuePage(1);
                  void loadComplianceCaseQueue({ category: next, page: 1 });
                }}
              >
                <option value="ALL">All non-FRAUD</option>
                {NON_FRAUD_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>
            <label style={inlineFilterLabel}>
              Assignment
              <select
                aria-label="Compliance queue assignment"
                value={queueAssignedFilter}
                onChange={(e) => {
                  const next = e.target.value;
                  setQueueAssignedFilter(next);
                  setQueuePage(1);
                  void loadComplianceCaseQueue({ assignedTo: next, page: 1 });
                }}
              >
                <option value="ALL">All</option>
                <option value="UNASSIGNED">Unassigned</option>
                <option value="ME">Assigned to me</option>
              </select>
            </label>
            <label style={inlineFilterLabel}>
              Search queue
              <input
                aria-label="Search compliance queue"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Case #, customer ref or UUID"
              />
            </label>
            <button
              type="button"
              className="compliance-case-detail"
              disabled={queueCasesLoading}
              onClick={() => {
                setQueuePage(1);
                void loadComplianceCaseQueue({ page: 1 });
              }}
            >
              Filter queue
            </button>
          </div>

          {queueCasesError && (
            <div
              className="compliance-workspace__state compliance-workspace__state--error"
              role="alert"
            >
              {queueCasesError}
            </div>
          )}
          {queueCasesLoaded && !queueCasesError && queueCases.length === 0 && (
            <div className="compliance-workspace__state">
              No compliance cases match the active queue filters.
            </div>
          )}
          {queueCases.length > 0 && !queueCasesError && (
            <>
              <ScrollRegion
                label="Compliance case queue"
                hint="Scroll horizontally to see all columns."
              >
                <table className="compliance-workspace__table">
                  <thead>
                    <tr>
                      <th scope="col">Case number</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Category</th>
                      <th scope="col">Status</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Assigned</th>
                      <th scope="col">Opened</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueCases.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <code>{item.caseNumber}</code>
                        </td>
                        <td>
                          <div>
                            {item.customerDisplayName ||
                              item.customerReference ||
                              item.customerId.slice(0, 8)}
                          </div>
                          <div style={{ fontSize: 11, color: '#64748B' }}>
                            <code>{item.customerId.slice(0, 8)}…</code>
                          </div>
                        </td>
                        <td>{item.category}</td>
                        <td>
                          <span className="compliance-workspace__badge">{item.status}</span>
                        </td>
                        <td>{item.severity}</td>
                        <td>{item.assignedTo || 'Unassigned'}</td>
                        <td>{fmtShortDate(item.openedAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="compliance-case-detail"
                            aria-label={`Inspect queue case ${item.caseNumber}`}
                            onClick={() => setSelectedCase(item)}
                          >
                            Manage case
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
              {queueTotalPages > 1 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>
                    Page {queuePage} of {queueTotalPages}
                  </span>
                  <button
                    type="button"
                    className="compliance-case-detail"
                    disabled={queuePage <= 1 || queueCasesLoading}
                    onClick={() => {
                      const prev = Math.max(1, queuePage - 1);
                      setQueuePage(prev);
                      void loadComplianceCaseQueue({ page: prev });
                    }}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className="compliance-case-detail"
                    disabled={queuePage >= queueTotalPages || queueCasesLoading}
                    onClick={() => {
                      const next = queuePage + 1;
                      setQueuePage(next);
                      void loadComplianceCaseQueue({ page: next });
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {initialCustomerId && onBackToCustomer && (
        <Button onClick={onBackToCustomer}>← Back to Customer 360°</Button>
      )}
      {completedDecision && (
        <div className="compliance-workspace__boundary" role="status">
          <strong>Assessment submitted</strong>
          <span>
            A matching receipt was received for customer {completedDecision.id}, level{' '}
            {completedDecision.level}, status {completedDecision.status}. Review the assessment and
            audit history before submitting another decision.
          </span>
          <button
            type="button"
            disabled={loading || assessing}
            onClick={() => setCompletedDecision(null)}
          >
            I reviewed the submitted assessment
          </button>
        </div>
      )}
      {uncertain && (
        <div className="compliance-workspace__boundary" role="status">
          <strong>KYC review required</strong>
          <span>
            The {uncertain.status} decision for customer {uncertain.id} may have occurred.
            Independently inspect the assessment and available audit history. A missing record or
            fresh read cannot exclude a late commit. This local review lock is lost on confirmed
            exit or session change.
          </span>
          {canViewKyc ? (
            <button
              type="button"
              disabled={loading || assessing}
              onClick={() => void reviewAssessment()}
            >
              Reload assessment for review
            </button>
          ) : (
            <span>
              Assessment read permission is unavailable; use an independently authorized source.
            </span>
          )}
          {(!canViewKyc || reviewReady) && (
            <button
              type="button"
              disabled={loading || assessing}
              onClick={() => {
                setUncertain(null);
                setReviewReady(false);
                setAssessErr('');
              }}
            >
              I reviewed the assessment and audit history
            </button>
          )}
        </div>
      )}
      <div className="compliance-workspace__boundary" role="note">
        <strong>
          {mode === 'cases' ? 'Authorized case categories' : 'Customer-scoped assessment'}
        </strong>
        <span>
          {mode === 'cases'
            ? 'The server returns cases in categories authorized by your active role grants. This view excludes FRAUD and filters the returned records locally.'
            : 'Assessment visibility and decisions are governed by separate function grants. A lookup does not itself change customer status.'}
        </span>
      </div>
      <section className="compliance-workspace__panel" aria-labelledby="compliance-search-heading">
        <div className="compliance-workspace__heading">
          <div>
            <p className="compliance-workspace__eyebrow">CUSTOMER LOOKUP</p>
            <h2 id="compliance-search-heading">Find a customer</h2>
            <p>Use a customer UUID to load this workspace.</p>
          </div>
        </div>
        <form
          className="compliance-workspace__lookup"
          onSubmit={(event) => {
            event.preventDefault();
            void fetchForCustomer();
          }}
        >
          <label>
            Customer UUID
            <input
              id="compliance-customer-id"
              value={customerId}
              onChange={(event) => {
                if (
                  decisionDirty &&
                  !window.confirm('Change customer and discard the current KYC decision draft?')
                )
                  return;
                lookupGeneration.current += 1;
                dossierGeneration.current += 1;
                setLoading(false);
                setCustomerId(event.target.value);
                setKyc(null);
                setKycDossier(null);
                setKycDossierError('');
                setCases([]);
                setSelectedCase(null);
                setSearched(false);
                setError('');
                setAssessMsg('');
                setAssessErr('');
                setKycReason('');
                if (mode === 'kyc') {
                  const defaultSt = availableKycStatuses.includes('APPROVED')
                    ? 'APPROVED'
                    : availableKycStatuses.includes('PENDING')
                      ? 'PENDING'
                      : (availableKycStatuses[0] ?? 'APPROVED');
                  setKycStatus(defaultSt);
                  setKycLevel(
                    defaultSt === 'PENDING' || defaultSt === 'REJECTED' ? 'NONE' : 'LEVEL_1',
                  );
                }
                setDecisionDirty(false);
              }}
              disabled={
                assessing ||
                Boolean(pendingDecision) ||
                Boolean(uncertain) ||
                Boolean(completedDecision)
              }
              placeholder={
                initialCustomerId ? `Customer ${initialCustomerId.slice(0, 8)}…` : 'Customer UUID'
              }
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            disabled={loading || assessing || Boolean(pendingDecision) || Boolean(uncertain)}
          >
            {loading ? 'Loading…' : 'Search'}
          </Button>
          {mode === 'kyc' &&
            canUseOperationalKycWorkspace &&
            CUSTOMER_UUID.test(customerId.trim()) && (
              <Button
                type="button"
                variant="secondary"
                disabled={kycDossierLoading}
                onClick={() => void loadCustomerKycDossier(customerId.trim())}
              >
                {kycDossierLoading ? 'Loading dossier…' : 'Load KYC evidence dossier'}
              </Button>
            )}
          {CUSTOMER_UUID.test(customerId.trim()) && onNavigateToCustomer && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onNavigateToCustomer(customerId.trim())}
            >
              Open Customer 360°
            </Button>
          )}
        </form>
        {initialCustomerId && (
          <p className="compliance-workspace__hint">
            Customer context carried from Customer 360°; the customer ID is passed to the scoped
            lookup endpoint.
          </p>
        )}
      </section>
      <section className="compliance-workspace__panel" aria-labelledby="compliance-results-heading">
        <div className="compliance-workspace__heading">
          <div>
            <p className="compliance-workspace__eyebrow">
              {mode === 'cases' ? 'AUTHORIZED RECORDS' : 'CURRENT RECORD'}
            </p>
            <h2 id="compliance-results-heading">
              {mode === 'cases' ? 'Compliance cases' : 'KYC assessment'}
            </h2>
            <p>
              {mode === 'cases'
                ? 'Category selection filters the records returned for this customer.'
                : 'The current assessment is shown when you have permission to view it.'}
            </p>
          </div>
          {mode === 'cases' && searched && !error && (
            <span className="compliance-workspace__count">{visibleCases.length} shown</span>
          )}
        </div>
        {error && (
          <div
            className="compliance-workspace__state compliance-workspace__state--error"
            role="alert"
          >
            {error}
          </div>
        )}
        {loading && (
          <div className="compliance-workspace__state" role="status">
            Loading customer records…
          </div>
        )}
        {!loading && !error && !searched && (mode === 'cases' || canViewKyc) && (
          <div className="compliance-workspace__state">Search for a customer to view records.</div>
        )}
        {mode === 'kyc' && !canViewKyc && (
          <div className="compliance-workspace__state">
            Assessment lookup requires <code>kyc.view</code>.{' '}
            {canSubmitKyc
              ? 'Your decision permissions are shown below.'
              : 'Decision actions are unavailable for this session.'}
          </div>
        )}
        {mode === 'kyc' && canViewKyc && !loading && !error && kyc && (
          <div className="compliance-workspace__assessment">
            <div>
              <span>Assessment</span>
              <strong>
                KYC: Level {kyc.level} — Status {kyc.status}
              </strong>
            </div>
            <div>
              <span>Assessed by</span>
              <strong>{kyc.assessedBy || 'Not recorded'}</strong>
            </div>
            <div>
              <span>Reason</span>
              <strong>{kyc.reason || 'Not recorded'}</strong>
            </div>
          </div>
        )}
        {mode === 'kyc' && canViewKyc && !loading && searched && !error && !kyc && (
          <div className="compliance-workspace__state">
            No KYC assessment found for this customer.
          </div>
        )}

        {mode === 'kyc' && kycDossierError && (
          <div
            className="compliance-workspace__state compliance-workspace__state--error"
            role="alert"
            style={{ marginTop: 12 }}
          >
            {kycDossierError}
          </div>
        )}

        {mode === 'kyc' && kycDossier && (
          <div style={{ display: 'grid', gap: 14, marginTop: 16 }} data-testid="kyc-review-dossier">
            <div style={subPanelStyle}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
                Customer KYC Review Dossier &amp; Tier Progression
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 10,
                  fontSize: 13,
                }}
              >
                <div>
                  <span style={{ color: '#64748B', display: 'block', fontSize: 11 }}>Customer</span>
                  <strong>
                    {kycDossier.customer?.displayName ||
                      kycDossier.customer?.reference ||
                      kycDossier.customer?.id}
                  </strong>
                  <div style={{ fontSize: 11, color: '#64748B' }}>
                    {kycDossier.customer?.type} · Lifecycle: {kycDossier.customer?.status} · KYC:{' '}
                    {kycDossier.customer?.kycLevel} ({kycDossier.customer?.kycStatus})
                  </div>
                </div>
                <div>
                  <span style={{ color: '#64748B', display: 'block', fontSize: 11 }}>
                    Trusted Verification Engine
                  </span>
                  <strong>
                    {kycDossier.evidenceStatus?.trustedVerificationEngine?.readerStatus ===
                      'READY' || kycDossier.readiness?.trustedEvidenceReady
                      ? 'READY'
                      : 'UNAVAILABLE (Fail-Closed)'}
                  </strong>
                  <div style={{ fontSize: 11, color: '#64748B' }}>
                    Manual Hold:{' '}
                    {(kycDossier.assessmentState?.manualHold ?? kycDossier.assessment?.manualHold)
                      ? `${(kycDossier.assessmentState?.manualHold ?? kycDossier.assessment?.manualHold).reason} (${(kycDossier.assessmentState?.manualHold ?? kycDossier.assessment?.manualHold).actor})`
                      : 'None'}
                  </div>
                </div>
                <div>
                  <span style={{ color: '#64748B', display: 'block', fontSize: 11 }}>
                    Decision Eligibility
                  </span>
                  <strong>
                    {kycDossier.supportedDecisions?.readOnlyPrincipal
                      ? 'Read-Only Session'
                      : kycDossier.supportedDecisions?.approvalEligibleNow
                        ? 'Eligible for Tier Approval'
                        : 'Hold / Reject / Case Escalation'}
                  </strong>
                  {kycDossier.supportedDecisions?.approvalBlockedReason && (
                    <div style={{ fontSize: 11, color: '#B45309' }}>
                      {kycDossier.supportedDecisions.approvalBlockedReason}
                    </div>
                  )}
                </div>
              </div>

              {Array.isArray(kycDossier.blockers) && kycDossier.blockers.length > 0 && (
                <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                  <strong style={{ fontSize: 12 }}>Tier Progression &amp; Blockers</strong>
                  {kycDossier.blockers.map((blocker: any) => (
                    <div
                      key={blocker.code}
                      style={{
                        border: '1px solid #FDE68A',
                        background:
                          blocker.severity === 'BLOCKING_APPROVAL' ? '#FEF3C7' : '#FFFBEB',
                        borderRadius: 6,
                        padding: '8px 10px',
                        fontSize: 12,
                      }}
                    >
                      <strong>{blocker.title}</strong> ({blocker.code})
                      <div style={{ color: '#78350F', marginTop: 2 }}>{blocker.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <section
              aria-label="Record consent and verify identity"
              data-testid="workforce-consent-verification"
              style={{
                marginTop: 14,
                border: '1px solid #CBD5E1',
                borderRadius: 8,
                padding: 14,
                background: '#FFFFFF',
              }}
            >
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
                Customer consent &amp; identity verification
              </h3>
              {kycDossier.consentNotice?.version && kycDossier.consentNotice?.text ? (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#334155' }}>
                    Governed notice <code>{kycDossier.consentNotice.version}</code>
                  </p>
                  <blockquote
                    data-testid="governed-consent-notice"
                    style={{
                      margin: '0 0 10px',
                      padding: '8px 12px',
                      borderLeft: '3px solid #2563EB',
                      fontSize: 12,
                    }}
                  >
                    {kycDossier.consentNotice.text}
                  </blockquote>
                  <label
                    style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}
                  >
                    <input
                      type="checkbox"
                      checked={workforceConsentConfirmed}
                      onChange={(event) => setWorkforceConsentConfirmed(event.target.checked)}
                      data-testid="workforce-consent-confirmed"
                    />
                    I confirm the customer has agreed to this notice and the selected identity
                    check.
                  </label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    {(['BVN', 'NIN'] as const).map((kind) => {
                      const docs = kycDossier.evidenceStatus?.identityDocuments?.items ?? [];
                      const available = docs.some((doc: any) => doc.type === kind);
                      return (
                        <Button
                          key={kind}
                          type="button"
                          disabled={
                            !available || !workforceConsentConfirmed || workforceVerificationBusy
                          }
                          onClick={() => void verifyRegisteredIdentity(kind)}
                          data-testid={`verify-${kind.toLowerCase()}-with-consent`}
                        >
                          {workforceVerificationBusy
                            ? 'Verifying…'
                            : `Record consent & verify ${kind}`}
                        </Button>
                      );
                    })}
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: '#64748B' }}>
                    Requires an MFA workforce session, institution-scoped KYC review and
                    identity-document access. Raw identity numbers are not sent from this screen or
                    returned in the dossier.
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>
                  No active governed consent notice is configured; verification remains unavailable.
                </p>
              )}
              {workforceVerificationMessage && (
                <p
                  role="status"
                  data-testid="workforce-verification-result"
                  style={{ margin: '10px 0 0', fontSize: 12 }}
                >
                  {workforceVerificationMessage}
                </p>
              )}
              {workforceVerificationError && (
                <p role="alert" style={{ margin: '10px 0 0', color: '#B91C1C', fontSize: 12 }}>
                  {workforceVerificationError}
                </p>
              )}
            </section>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 14,
              }}
            >
              <div style={subPanelStyle}>
                <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
                  Verification Attempts &amp; Consents
                </h3>
                {(
                  kycDossier.evidenceStatus?.trustedVerificationEngine?.verificationAttempts ??
                  kycDossier.evidence?.verificationAttempts
                )?.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                    {(
                      kycDossier.evidenceStatus?.trustedVerificationEngine?.verificationAttempts ??
                      kycDossier.evidence?.verificationAttempts
                    )
                      .slice(0, 6)
                      .map((att: any) => (
                        <li key={att.id} style={{ marginBottom: 6 }}>
                          <strong>{att.kind}</strong> via <code>{att.provider}</code> —{' '}
                          <span>{att.outcome || att.status}</span> (
                          {fmtShortDate(att.completedAt || att.verifiedAt || att.createdAt)})
                          <div style={{ color: '#64748B', overflowWrap: 'anywhere' }}>
                            Attempt <code>{att.id}</code> ← consent{' '}
                            <code>{att.consentId || 'legacy/unlinked'}</code>
                            {att.routeVersion ? ` · route v${att.routeVersion}` : ''}
                          </div>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>
                    No provider verification attempts recorded.
                  </p>
                )}
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <strong>Active Consents:</strong>{' '}
                  {(
                    kycDossier.evidenceStatus?.trustedVerificationEngine?.consents ??
                    kycDossier.evidence?.consents
                  )?.length
                    ? (
                        kycDossier.evidenceStatus?.trustedVerificationEngine?.consents ??
                        kycDossier.evidence?.consents
                      )
                        .map(
                          (c: any) =>
                            `${c.kind || c.scope} · ${c.provenance || 'unverified'} · consent ${c.id} · route v${c.routeVersion ?? '—'} (${c.withdrawnAt ? 'WITHDRAWN' : c.status || 'GRANTED'})`,
                        )
                        .join(', ')
                    : 'None recorded'}
                </div>
                <div style={{ marginTop: 8, fontSize: 12 }} data-testid="identity-claim-linkage">
                  <strong>Ownership claims:</strong>{' '}
                  {(
                    kycDossier.evidenceStatus?.trustedVerificationEngine?.identityClaims ??
                    kycDossier.evidence?.identityClaims
                  )?.length
                    ? (
                        kycDossier.evidenceStatus?.trustedVerificationEngine?.identityClaims ??
                        kycDossier.evidence?.identityClaims
                      )
                        .map(
                          (claim: any) =>
                            `${claim.kind} ${claim.status} · claim ${claim.id} ← attempt ${claim.attemptId}`,
                        )
                        .join('; ')
                    : 'None recorded'}
                </div>
              </div>

              <div style={subPanelStyle}>
                <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
                  Permission-Bounded Customer Evidence
                </h3>
                {(() => {
                  const ev = kycDossier.evidenceStatus ?? kycDossier.evidence ?? {};
                  return (
                    <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
                      <div>
                        <strong>Primary Phone:</strong>{' '}
                        {ev.primaryPhone?.access === 'GRANTED'
                          ? ev.primaryPhone.present
                            ? `${ev.primaryPhone.maskedValue} (${ev.primaryPhone.verified ? 'Verified' : 'Unverified'})`
                            : 'Not on file'
                          : `Restricted (requires ${ev.primaryPhone?.requiredScope || 'customer.view'})`}
                      </div>
                      <div>
                        <strong>Residential Address:</strong>{' '}
                        {ev.residentialAddress?.access === 'GRANTED'
                          ? ev.residentialAddress.count > 0
                            ? `${ev.residentialAddress.primarySummary} (${ev.residentialAddress.count} on file)`
                            : 'No address recorded'
                          : `Restricted (requires ${ev.residentialAddress?.requiredScope || 'customer.view_addresses'})`}
                      </div>
                      <div>
                        <strong>Identity Documents:</strong>{' '}
                        {ev.identityDocuments?.access === 'GRANTED' ? (
                          ev.identityDocuments.items?.length ? (
                            ev.identityDocuments.items
                              .map(
                                (d: any) =>
                                  `${d.type || d.documentType} ${d.maskedDocumentNumber || d.maskedNumber}`,
                              )
                              .join(', ')
                          ) : (
                            'No identity documents submitted'
                          )
                        ) : (
                          <span>
                            Restricted — requires{' '}
                            <code>
                              {ev.identityDocuments?.requiredScope ||
                                'customer.view_identity_documents'}
                            </code>
                          </span>
                        )}
                      </div>
                      <div>
                        <strong>Proof of Address:</strong>{' '}
                        {ev.proofOfAddress?.access === 'GRANTED' ? (
                          ev.proofOfAddress.items?.length ? (
                            ev.proofOfAddress.items
                              .map(
                                (p: any) =>
                                  `${p.documentType}: ${p.reviewStatus || p.status} (${p.documentStatus || 'SCAN_PENDING'})`,
                              )
                              .join(', ')
                          ) : (
                            'No Proof of Address submissions'
                          )
                        ) : (
                          <span>
                            Restricted — requires{' '}
                            <code>
                              {ev.proofOfAddress?.requiredScope ||
                                'customer.view_proof_of_address_metadata'}
                            </code>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div style={subPanelStyle}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
                Active KYC Policy &amp; Provider Routing Context
              </h3>
              {(() => {
                const gov = kycDossier.governance ?? kycDossier.governanceContext ?? {};
                const tp = gov.tierPolicy ?? gov.activeTierPolicy;
                const pr = gov.providerRouting;
                return (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <strong>Effective Tier Policy:</strong>{' '}
                      {tp ? (
                        <span>
                          Status: <strong>{tp.status || 'PUBLISHED'}</strong> · Published v
                          {tp.publishedVersion ?? tp.policy?.version ?? 0}
                          {tp.effectiveVersion != null
                            ? ` (Effective v${tp.effectiveVersion})`
                            : ''}
                        </span>
                      ) : (
                        'Unconfigured'
                      )}
                    </div>
                    <div>
                      <strong>Provider Routing:</strong>{' '}
                      {pr?.access === 'GRANTED' ? (
                        <span>
                          Config v{pr.version} · Ready:{' '}
                          {pr.dispatchReadyProviders?.length
                            ? pr.dispatchReadyProviders.join(', ')
                            : 'None dispatch-ready'}
                        </span>
                      ) : (
                        <span>
                          Restricted — requires <code>kyc.provider.view</code>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {mode === 'cases' && (
          <>
            <div className="compliance-workspace__filter">
              <label>
                Category
                <select
                  value={caseCategory}
                  onChange={(event) => {
                    setCaseCategory(event.target.value);
                    setSelectedCase(null);
                  }}
                >
                  <option value="ALL">All non-FRAUD compliance cases</option>
                  <option value="AML">AML</option>
                  <option value="KYC">KYC</option>
                  <option value="SANCTIONS">SANCTIONS</option>
                  <option value="PEP">PEP</option>
                  <option value="DOCUMENT">DOCUMENT</option>
                  <option value="ACCOUNT_REVIEW">ACCOUNT_REVIEW</option>
                  <option value="MANUAL_REVIEW">MANUAL_REVIEW</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </label>
            </div>
            {!loading && !error && searched && (
              <p className="compliance-workspace__summary">
                {visibleCases.length} shown · {nonFraudCases.length} non-FRAUD records returned
              </p>
            )}
            {!loading && !error && visibleCases.length > 0 ? (
              <ScrollRegion label="Compliance cases" hint="Scroll horizontally to see all columns.">
                <table className="compliance-workspace__table">
                  <thead>
                    <tr>
                      <th scope="col">Case number</th>
                      <th scope="col">Category</th>
                      <th scope="col">Status</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCases.map((item: CustomerComplianceCaseRow) => (
                      <tr key={item.id}>
                        <td>
                          <code>{item.caseNumber}</code>
                        </td>
                        <td>{item.category}</td>
                        <td>
                          <span className="compliance-workspace__badge">{item.status}</span>
                        </td>
                        <td>{item.severity}</td>
                        <td>
                          <button
                            type="button"
                            className="compliance-case-detail"
                            aria-label={`View case ${item.caseNumber}`}
                            onClick={() => setSelectedCase(item)}
                          >
                            View details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            ) : (
              !loading &&
              searched &&
              !error && (
                <div className="compliance-workspace__state">
                  No compliance cases match this customer and category filter.
                </div>
              )
            )}
          </>
        )}
      </section>
      {mode === 'kyc' && canSubmitKyc && (
        <section className="compliance-workspace__panel" aria-labelledby="kyc-decision-heading">
          <div className="compliance-workspace__heading">
            <div>
              <p className="compliance-workspace__eyebrow">REVIEW DECISION</p>
              <h2 id="kyc-decision-heading">Submit KYC assessment decision</h2>
              <p>
                Available statuses reflect your function grants. Confirm the customer and decision
                before submitting.
              </p>
            </div>
          </div>
          <p className="compliance-workspace__target">
            Decision customer: <code>{customerId.trim() || 'Enter a customer UUID above'}</code>
          </p>
          <form onSubmit={beginAssessment} className="compliance-workspace__decision">
            <label>
              Level
              <select
                disabled={
                  assessing ||
                  Boolean(pendingDecision) ||
                  Boolean(uncertain) ||
                  Boolean(completedDecision)
                }
                value={kycLevel}
                onChange={(event) => {
                  setKycLevel(event.target.value);
                  setDecisionDirty(true);
                }}
              >
                <option value="NONE">NONE</option>
                <option value="LEVEL_1">LEVEL_1</option>
                <option value="LEVEL_2">LEVEL_2</option>
                <option value="LEVEL_3">LEVEL_3</option>
              </select>
            </label>
            <label>
              Status
              <select
                disabled={
                  assessing ||
                  Boolean(pendingDecision) ||
                  Boolean(uncertain) ||
                  Boolean(completedDecision)
                }
                value={kycStatus}
                onChange={(event) => {
                  const next = event.target.value;
                  setKycStatus(next);
                  if (next === 'PENDING' || next === 'REJECTED') {
                    setKycLevel('NONE');
                  } else if (next === 'APPROVED' && kycLevel === 'NONE') {
                    setKycLevel('LEVEL_1');
                  }
                  setDecisionDirty(true);
                }}
              >
                {availableKycStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assessment reason (optional)
              <input
                disabled={
                  assessing ||
                  Boolean(pendingDecision) ||
                  Boolean(uncertain) ||
                  Boolean(completedDecision)
                }
                value={kycReason}
                onChange={(event) => {
                  setKycReason(event.target.value);
                  setDecisionDirty(true);
                }}
                placeholder={
                  kycStatus === 'PENDING' || kycStatus === 'REJECTED'
                    ? 'MANUAL_REVIEW, IDENTITY_CONFLICT, or EVIDENCE_REVOKED'
                    : 'Reason (optional)'
                }
              />
            </label>
            {(kycStatus === 'PENDING' || kycStatus === 'REJECTED') && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#64748B' }}>Governed hold reason:</span>
                {GOVERNED_HOLD_REASONS.map((code) => (
                  <button
                    key={code}
                    type="button"
                    className="compliance-case-detail"
                    disabled={
                      assessing ||
                      Boolean(pendingDecision) ||
                      Boolean(uncertain) ||
                      Boolean(completedDecision)
                    }
                    onClick={() => {
                      setKycReason(code);
                      setDecisionDirty(true);
                    }}
                  >
                    {code}
                  </button>
                ))}
              </div>
            )}
            <div className="compliance-workspace__decision-action">
              <Button
                ref={triggerRef}
                type="submit"
                variant="primary"
                disabled={
                  loading ||
                  assessing ||
                  Boolean(pendingDecision) ||
                  Boolean(uncertain) ||
                  Boolean(completedDecision) ||
                  !customerId.trim()
                }
              >
                {assessing ? 'Submitting…' : 'Submit Assessment'}
              </Button>
            </div>
          </form>
          {assessMsg && (
            <div
              className="compliance-workspace__state compliance-workspace__state--success"
              role="status"
            >
              {assessMsg}
            </div>
          )}
          {assessErr && (
            <div
              className="compliance-workspace__state compliance-workspace__state--error"
              role="alert"
            >
              {assessErr}
            </div>
          )}
        </section>
      )}
      {selectedCase && (
        <ComplianceCaseDrawer
          record={selectedCase}
          onClose={() => setSelectedCase(null)}
          canMutate={canMutateCases}
          principalId={principal?.principalId}
          onCaseUpdated={syncUpdatedCase}
          onNavigateToCustomer={onNavigateToCustomer}
          onNavigateToSupport={onNavigateToSupport}
        />
      )}
      {pendingDecision && (
        <div className="cm-modal-backdrop">
          <section
            ref={dialogRef}
            tabIndex={-1}
            className="cm-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kyc-confirm-title"
          >
            <h2 id="kyc-confirm-title">Confirm KYC decision?</h2>
            <p>
              Customer <code>{pendingDecision.id}</code> · Level {pendingDecision.level} · Status{' '}
              {pendingDecision.status}
            </p>
            <p>Reason: {pendingDecision.reason || 'Not provided'}</p>
            <div className="cm-actions-row">
              <button type="button" disabled={assessing} onClick={() => setPendingDecision(null)}>
                Keep editing
              </button>
              <button type="button" disabled={assessing} onClick={() => void submitAssessment()}>
                {assessing ? 'Submitting…' : 'Confirm KYC decision'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1440 };
const denied: React.CSSProperties = {
  background: '#FFF7ED',
  border: '1px solid #FDBA74',
  color: '#92400E',
  padding: 12,
  borderRadius: 8,
  fontSize: 13,
};
const kpiGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))',
  gap: 10,
  marginBottom: 12,
};
const kpiCardStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  background: '#F8FAFC',
  border: '1px solid #E2E8F0',
  display: 'grid',
  gap: 2,
  fontSize: 12,
};
const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'flex-end',
  marginBottom: 12,
};
const inlineFilterLabel: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 12,
  fontWeight: 500,
};
const subPanelStyle: React.CSSProperties = {
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  padding: 12,
  background: '#F8FAFC',
};
