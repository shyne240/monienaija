import './operational-surfaces.css';
import './notification-redesign.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NotificationTemplateWorkspace } from '../../components/NotificationTemplateWorkspace';
import { ProviderConfigurationWorkspace } from '../../components/ProviderConfigurationWorkspace';
import { Alert, Button, Field, PageHeader } from '../../design-system/primitives';
import {
  BASELINE_CODE_EVENT_CATALOGUE,
  BASELINE_CODE_TEMPLATES,
  deriveNotificationPermissions,
  effectiveConfiguredChannels,
  getNotificationConfigurationSnapshot,
  isUuidString,
  ManagedNotificationChannel,
  NotificationConfigurationTarget,
  NotificationChangeRequestRecord,
  NotificationDeliveryPage,
  NotificationDeliveryRecord,
  NotificationEventCatalogueItem,
  NotificationOutboxReceiptPage,
  NotificationProviderStatus,
  NotificationTemplateVersion,
  SECURITY_LOCKED_EVENT_TYPES,
  validateTestSendRequest,
  validateTriggerConfigurationChange,
} from '../../services/notification-domain';
import {
  ControlledTestSendOutcome,
  LiveDiagnosticsSummary,
  NotificationManagementApi,
  SafeRuntimeConfiguration,
} from '../../services/notification-management-api';
import { ApiError } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

export type NotificationAdminTab =
  | 'overview'
  | 'events'
  | 'smsTemplates'
  | 'emailTemplates'
  | 'approvals'
  | 'providers'
  | 'deliveries'
  | 'testSend'
  | 'providerConfig';

interface TabDefinition {
  key: NotificationAdminTab;
  label: string;
}

function canEditConfigurationTarget(
  event: NotificationEventCatalogueItem,
  target: NotificationConfigurationTarget,
): boolean {
  const snapshot = getNotificationConfigurationSnapshot(event, target);
  return Boolean(snapshot && !snapshot.locked);
}

function describePendingConfigurationChange(record: NotificationChangeRequestRecord): string {
  const desired =
    record.channel === 'EVENT'
      ? record.proposedEventEnabled
      : record.channel === 'SMS'
        ? record.proposedSmsEnabled
        : record.channel === 'EMAIL'
          ? record.proposedEmailEnabled
          : undefined;
  const target =
    typeof desired === 'boolean' ? `${record.channel}: ${desired ? 'enable' : 'disable'}` : record.channel;
  const status =
    record.status === 'APPROVED' ? 'Approved, not yet confirmed effective' : 'Pending approval';
  return `${target} — ${status}`;
}

const TABS: readonly TabDefinition[] = [
  { key: 'overview', label: '1. Overview' },
  { key: 'events', label: '2. Event Catalogue & Triggers' },
  { key: 'smsTemplates', label: '3. SMS Templates' },
  { key: 'emailTemplates', label: '4. Email Templates' },
  { key: 'approvals', label: '5. Approvals & Governance' },
  { key: 'providers', label: '6. Provider Status' },
  { key: 'deliveries', label: '7. Deliveries & Retries' },
  { key: 'testSend', label: '8. Controlled Test-Send' },
  { key: 'providerConfig', label: '9. Provider Configuration' },
];

export const NotificationManagementScreen: React.FC<{ initialTab?: NotificationAdminTab }> = (props) => {
  const principal = useAuthStore((state) => state.principal);
  const contextKey = JSON.stringify([principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <NotificationManagementWorkspace key={contextKey} {...props} />;
};
const NotificationManagementWorkspace: React.FC<{ initialTab?: NotificationAdminTab }> = ({
  initialTab = 'overview',
}) => {
  const { principal } = useAuthStore();
  const permissions = useMemo(() => deriveNotificationPermissions(principal), [principal]);
  const currentPrincipalId = principal?.principalId ?? '';
  // Mirror the registry's existing maker policy for this control. The server remains
  // authoritative for all authorization, MFA, read-only and maker-checker decisions.
  const isWorkforcePrincipal = principal?.type === 'OPERATOR' || principal?.type === 'PRIVILEGED';
  const canProposeTriggerChange = Boolean(
    isWorkforcePrincipal &&
    principal?.roles.includes('SUPER_ADMIN') &&
    principal.scopes.includes('notification.view_deliveries') &&
    principal.customerAccess === 'NONE' &&
    !principal.readOnlyPrincipal &&
    permissions.hasMfaAssurance,
  );
  const hasNotificationCheckerIdentity = Boolean(
    isWorkforcePrincipal &&
    permissions.canUseWorkforceApprovalEndpoint &&
    principal?.customerAccess === 'NONE' &&
    !principal?.readOnlyPrincipal,
  );

  const visibleTabs = useMemo(
    () =>
      TABS.filter(
        (tabItem) => tabItem.key !== 'providerConfig' || permissions.canViewProviderConfig,
      ),
    [permissions.canViewProviderConfig],
  );

  const [activeTab, setActiveTab] = useState<NotificationAdminTab>(
    initialTab === 'providerConfig' && !permissions.canViewProviderConfig
      ? 'overview'
      : initialTab,
  );
  const activeTabRef = useRef<NotificationAdminTab>(activeTab);
  activeTabRef.current = activeTab;
  const [templateJumpEventType, setTemplateJumpEventType] = useState<string | undefined>(undefined);

  // Core data & boundary state
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [events, setEvents] = useState<NotificationEventCatalogueItem[]>(
    BASELINE_CODE_EVENT_CATALOGUE,
  );
  const [eventsSource, setEventsSource] = useState<'LOADING' | 'LIVE' | 'OFFLINE_REFERENCE'>(
    'LOADING',
  );
  const [eventsBlockedMsg, setEventsBlockedMsg] = useState<string>('');
  const [templates, setTemplates] = useState<NotificationTemplateVersion[]>(BASELINE_CODE_TEMPLATES);
  const [loadedTemplateChannels, setLoadedTemplateChannels] = useState<{
    SMS: boolean;
    EMAIL: boolean;
  }>({ SMS: false, EMAIL: false });
  const loadedTemplateChannelsRef = useRef<{ SMS: boolean; EMAIL: boolean }>({
    SMS: false,
    EMAIL: false,
  });
  const [templateBlocked, setTemplateBlocked] = useState({ SMS: '', EMAIL: '' });
  const [templateErrors, setTemplateErrors] = useState({ SMS: '', EMAIL: '' });
  const templateGenerations = useRef({ SMS: 0, EMAIL: 0 });
  const refreshGeneration = useRef(0);
  useEffect(() => () => { templateGenerations.current.SMS++; templateGenerations.current.EMAIL++; refreshGeneration.current++; }, []);
  const [providerStatus, setProviderStatus] = useState<NotificationProviderStatus | null>(null);
  const [providerBlockedMsg, setProviderBlockedMsg] = useState<string>('');
  const [runtimeConfig, setRuntimeConfig] = useState<SafeRuntimeConfiguration | null>(null);
  const [diagnostics, setDiagnostics] = useState<LiveDiagnosticsSummary | null>(null);
  const [outboxRows, setOutboxRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [changeRequests, setChangeRequests] = useState<NotificationChangeRequestRecord[]>([]);
  const [sessionSubmittedChanges, setSessionSubmittedChanges] = useState<
    NotificationChangeRequestRecord[]
  >([]);
  const [changeRequestsBlockedMsg, setChangeRequestsBlockedMsg] = useState<string>('');
  const [auditRows, setAuditRows] = useState<Array<Record<string, unknown>>>([]);
  const [globalLoadErrors, setGlobalLoadErrors] = useState<Record<string, string>>({});

  // Event Catalogue & Trigger Edit State (Capability 2)
  const [eventSearch, setEventSearch] = useState<string>('');
  const [eventClassFilter, setEventClassFilter] = useState<string>('ALL');
  const [eventGovernanceFilter, setEventGovernanceFilter] = useState<string>('ALL');
  const [editingTriggerEvent, setEditingTriggerEvent] =
    useState<NotificationEventCatalogueItem | null>(null);
  const triggerDrawerRef = useRef<HTMLElement>(null);
  const triggerOriginRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (editingTriggerEvent) triggerDrawerRef.current?.focus(); }, [editingTriggerEvent]);
  const [draftEventEnabled, setDraftEventEnabled] = useState<boolean>(false);
  const [draftSmsEnabled, setDraftSmsEnabled] = useState<boolean>(true);
  const [draftEmailEnabled, setDraftEmailEnabled] = useState<boolean>(false);
  const [triggerReason, setTriggerReason] = useState<string>('');
  const [triggerValidationErrors, setTriggerValidationErrors] = useState<string[]>([]);
  const [triggerFeedback, setTriggerFeedback] = useState<{
    kind: 'success' | 'blocked' | 'error';
    message: string;
  } | null>(null);
  const [isSavingTrigger, setIsSavingTrigger] = useState<boolean>(false);

  // Approvals & Governance State (Capability 8)
  const [checkerApprovalId, setCheckerApprovalId] = useState<string>('');
  const [checkerComment, setCheckerComment] = useState<string>('');
  const [checkerFeedback, setCheckerFeedback] = useState<{
    kind: 'success' | 'blocked' | 'error';
    message: string;
  } | null>(null);
  const [isSubmittingChecker, setIsSubmittingChecker] = useState<boolean>(false);
  const [decidingChangeId, setDecidingChangeId] = useState<string | null>(null);
  const [executingApprovalId, setExecutingApprovalId] = useState<string | null>(null);
  const [queueDecisionComment, setQueueDecisionComment] = useState<string>('');

  // Deliveries, Retries & Outbox Receipts State (Capability 10)
  const [deliveryPageData, setDeliveryPageData] = useState<NotificationDeliveryPage | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState<boolean>(false);
  const [deliveryError, setDeliveryError] = useState<string>('');
  const [deliveryFilterError, setDeliveryFilterError] = useState<string>('');
  const deliveryReadGeneration = useRef(0);
  const outboxReadGeneration = useRef(0);
  const deliveryInspectorRef = useRef<HTMLElement | null>(null);
  const deliveryOriginRef = useRef<HTMLButtonElement | null>(null);
  const [deliveryChannelBlockedMsg, setDeliveryChannelBlockedMsg] = useState<string>('');
  const [deliveryPage, setDeliveryPage] = useState<number>(1);
  const [deliveryLimit, setDeliveryLimit] = useState<number>(20);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterChannel, setFilterChannel] = useState<string>('');
  const [filterRecipientType, setFilterRecipientType] = useState<string>('');
  const [filterEventType, setFilterEventType] = useState<string>('');
  const [filterRecipientId, setFilterRecipientId] = useState<string>('');
  const [appliedFilters, setAppliedFilters] = useState<{
    status: string;
    channel: string;
    recipientType: string;
    eventType: string;
    recipientId: string;
  }>({ status: '', channel: '', recipientType: '', eventType: '', recipientId: '' });
  const [selectedDelivery, setSelectedDelivery] = useState<NotificationDeliveryRecord | null>(null);
  const [manualRetryReason, setManualRetryReason] = useState<string>('');
  const [manualRetryFeedback, setManualRetryFeedback] = useState<{
    kind: 'success' | 'blocked' | 'error';
    message: string;
  } | null>(null);
  const [isRetryingDelivery, setIsRetryingDelivery] = useState<boolean>(false);

  const [outboxReceiptPageData, setOutboxReceiptPageData] =
    useState<NotificationOutboxReceiptPage | null>(null);
  const [outboxReceiptLoading, setOutboxReceiptLoading] = useState<boolean>(false);
  const [outboxReceiptError, setOutboxReceiptError] = useState<string>('');
  const [outboxReceiptBlockedMsg, setOutboxReceiptBlockedMsg] = useState<string>('');
  const [outboxReceiptPage, setOutboxReceiptPage] = useState<number>(1);
  const [outboxReceiptStatusFilter, setOutboxReceiptStatusFilter] = useState<string>('');

  // Controlled Test-Send State (Capability 11 — fixed connectivity probe contract)
  const [testChannel, setTestChannel] = useState<ManagedNotificationChannel>('SMS');
  const [testDestination, setTestDestination] = useState<string>('');
  const [testWorkforceConfirmed, setTestWorkforceConfirmed] = useState<boolean>(false);
  const [testValidationErrors, setTestValidationErrors] = useState<string[]>([]);
  const [testOutcome, setTestOutcome] = useState<ControlledTestSendOutcome | null>(null);
  const [testBlockedMsg, setTestBlockedMsg] = useState<string>('');
  const [testError, setTestError] = useState<string>('');
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);

  const fetchDeliveries = useCallback(async (preserveInspector = false) => {
    if (!permissions.canViewDeliveries) return;
    const generation = ++deliveryReadGeneration.current;
    setDeliveryLoading(true);
    setDeliveryPageData(null);
    if (!preserveInspector) setSelectedDelivery(null);
    setDeliveryError('');
    setDeliveryChannelBlockedMsg('');
    try {
      const res = await NotificationManagementApi.listDeliveries({
        page: deliveryPage,
        limit: deliveryLimit,
        status: appliedFilters.status || undefined,
        channel: appliedFilters.channel || undefined,
        recipientType: appliedFilters.recipientType || undefined,
        eventType: appliedFilters.eventType || undefined,
        recipientId: appliedFilters.recipientId || undefined,
      });
      if (generation !== deliveryReadGeneration.current) return;
      if (res.status === 'BLOCKED') {
        setDeliveryChannelBlockedMsg(res.message);
        setDeliveryPageData(null);
      } else {
        setDeliveryPageData(res.data);
      }
    } catch (err: any) {
      if (generation !== deliveryReadGeneration.current) return;
      setDeliveryPageData(null);
      setDeliveryError(err?.message || 'Failed to load notification deliveries.');
    } finally {
      if (generation === deliveryReadGeneration.current) setDeliveryLoading(false);
    }
  }, [permissions.canViewDeliveries, deliveryPage, deliveryLimit, appliedFilters]);

  const fetchOutboxReceipts = useCallback(async () => {
    if (!permissions.canViewDeliveries) return;
    const generation = ++outboxReadGeneration.current;
    setOutboxReceiptLoading(true);
    setOutboxReceiptPageData(null);
    setOutboxReceiptError('');
    setOutboxReceiptBlockedMsg('');
    try {
      const res = await NotificationManagementApi.listOutboxReceipts({
        page: outboxReceiptPage,
        limit: 20,
        status: outboxReceiptStatusFilter
          ? (outboxReceiptStatusFilter as any)
          : undefined,
      });
      if (generation !== outboxReadGeneration.current) return;
      if (res.status === 'BLOCKED') {
        setOutboxReceiptBlockedMsg(res.message);
        setOutboxReceiptPageData(null);
      } else {
        setOutboxReceiptPageData(res.data);
      }
    } catch (err: any) {
      if (generation !== outboxReadGeneration.current) return;
      setOutboxReceiptPageData(null);
      setOutboxReceiptError(err?.message || 'Failed to load notification outbox receipts.');
    } finally {
      if (generation === outboxReadGeneration.current) setOutboxReceiptLoading(false);
    }
  }, [permissions.canViewDeliveries, outboxReceiptPage, outboxReceiptStatusFilter]);

  const fetchTemplatesForChannel = useCallback(
    async (
      channel: ManagedNotificationChannel,
      catalogueEvents: NotificationEventCatalogueItem[],
      force = false,
    ) => {
      if (!permissions.canViewCatalogue) return;
      if (!force && loadedTemplateChannelsRef.current[channel]) return;

      const generation = ++templateGenerations.current[channel];
      setTemplateErrors(prev => ({...prev, [channel]: ''}));
      setTemplateBlocked(prev => ({...prev, [channel]: ''}));
      const editableEventTypes = catalogueEvents
        .filter(
          (item) =>
            item.templateEditable &&
            item.deliveryClass !== 'SECURITY' &&
            !SECURITY_LOCKED_EVENT_TYPES.has(item.eventType),
        )
        .map((item) => item.eventType);

      try {
        if (editableEventTypes.length === 0) throw new Error('No editable events available to check the template registry.');
        const res = await NotificationManagementApi.listTemplates({
          channel,
          includeHistory: true,
          editableEventTypes,
        });
        if (generation !== templateGenerations.current[channel]) return;
        if (res.status === 'BLOCKED') {
          setTemplateBlocked(prev => ({...prev, [channel]: res.message}));
          loadedTemplateChannelsRef.current = {
            ...loadedTemplateChannelsRef.current,
            [channel]: true,
          };
          setLoadedTemplateChannels((prev) => ({ ...prev, [channel]: true }));
        } else {
          const normalized = res.data.map((row) => ({
            ...row,
            sourceOrigin: row.sourceOrigin ?? ('DATABASE' as const),
          }));
          setTemplates((prev) => [
            ...prev.filter((item) => item.channel !== channel),
            ...(normalized.length > 0
              ? normalized
              : BASELINE_CODE_TEMPLATES.filter((item) => item.channel === channel)),
          ]);
          loadedTemplateChannelsRef.current = {
            ...loadedTemplateChannelsRef.current,
            [channel]: true,
          };
          setLoadedTemplateChannels((prev) => ({ ...prev, [channel]: true }));
        }
      } catch (err: any) {
        if (generation !== templateGenerations.current[channel]) return;
        setTemplateErrors(prev => ({ ...prev, [channel]: err?.message || `Failed to load ${channel} notification templates` }));
        loadedTemplateChannelsRef.current = { ...loadedTemplateChannelsRef.current, [channel]: true };
        setLoadedTemplateChannels(prev => ({ ...prev, [channel]: true }));
      }
    },
    [permissions.canViewCatalogue],
  );

  const fetchAllReadSurfaces = useCallback(async () => {
    if (!permissions.canAccessModule) {
      setLoadingInitial(false);
      return;
    }

    const generation = ++refreshGeneration.current;
    templateGenerations.current.SMS++; templateGenerations.current.EMAIL++;
    setTemplateErrors({ SMS: '', EMAIL: '' });
    setTemplateBlocked({ SMS: '', EMAIL: '' });
    setLoadingInitial(true);
    if (permissions.canViewCatalogue) { setEventsSource('LOADING'); setEventsBlockedMsg(''); }
    if (permissions.canViewProviderStatus) { setProviderStatus(null); setProviderBlockedMsg(''); }
    setDiagnostics(null); setOutboxRows(null);
    setGlobalLoadErrors({});
    loadedTemplateChannelsRef.current = { SMS: false, EMAIL: false };
    setLoadedTemplateChannels({ SMS: false, EMAIL: false });

    const tasks: Promise<void>[] = [];
    let resolvedEvents: NotificationEventCatalogueItem[] = BASELINE_CODE_EVENT_CATALOGUE;

    if (permissions.canViewCatalogue) {
      tasks.push(
        NotificationManagementApi.listEvents()
          .then((res) => {
            if (generation !== refreshGeneration.current) return;
            if (res.status === 'BLOCKED') {
              setEventsBlockedMsg(res.message);
              setEventsSource('OFFLINE_REFERENCE');
              setEvents(BASELINE_CODE_EVENT_CATALOGUE);
              resolvedEvents = BASELINE_CODE_EVENT_CATALOGUE;
            } else {
              setEventsBlockedMsg('');
              if (res.data.length > 0) {
                setEventsSource('LIVE');
                setEvents(res.data);
                resolvedEvents = res.data;
              } else {
                setEventsSource('OFFLINE_REFERENCE');
                setEvents(BASELINE_CODE_EVENT_CATALOGUE);
                resolvedEvents = BASELINE_CODE_EVENT_CATALOGUE;
              }
            }
          })
          .catch((err: any) => {
            if (generation !== refreshGeneration.current) return;
            setEventsSource('OFFLINE_REFERENCE');
            setEvents(BASELINE_CODE_EVENT_CATALOGUE);
            setGlobalLoadErrors((prev) => ({
              ...prev,
              events: err?.message || 'Failed to load notification events',
            }));
          }),
      );
    }

    if (permissions.canViewProviderStatus) {
      tasks.push(
        NotificationManagementApi.getProviderStatus()
          .then((res) => {
            if (generation !== refreshGeneration.current) return;
            if (res.status === 'BLOCKED') {
              setProviderBlockedMsg(res.message);
              setProviderStatus(null);
            } else {
              setProviderBlockedMsg('');
              setProviderStatus(res.data);
            }
          })
          .catch((err: any) => {
            if (generation !== refreshGeneration.current) return;
            setProviderStatus(null);
            setGlobalLoadErrors((prev) => ({
              ...prev,
              providerStatus: err?.message || 'Failed to load provider status',
            }));
          }),
      );
    }

    if (permissions.canViewDiagnostics) {
      tasks.push(
        NotificationManagementApi.getDiagnostics()
          .then((value) => { if (generation === refreshGeneration.current) setDiagnostics(value); })
          .catch((err: any) => {
            if (generation !== refreshGeneration.current) return;
            setDiagnostics(null);
            setGlobalLoadErrors((prev) => ({
              ...prev,
              diagnostics: err?.message || 'Diagnostics unavailable',
            }));
          }),
      );

      tasks.push(
        NotificationManagementApi.getSafeRuntimeConfig()
          .then((value) => { if (generation === refreshGeneration.current) setRuntimeConfig(value); })
          .catch(() => {
            // Non-fatal auxiliary metadata gated strictly by diagnostics.view
          }),
      );
    }

    if (permissions.canViewOutbox) {
      tasks.push(
        NotificationManagementApi.getOutboxEvents(25)
          .then((value) => { if (generation === refreshGeneration.current) setOutboxRows(value); })
          .catch((err: any) => {
            if (generation !== refreshGeneration.current) return;
            setOutboxRows(null);
            setGlobalLoadErrors((prev) => ({
              ...prev,
              outbox: err?.message || 'Outbox unavailable',
            }));
          }),
      );
    }

    if (
      permissions.canViewCatalogue ||
      permissions.canApproveTemplates ||
      permissions.canApproveConfiguration
    ) {
      tasks.push(
        NotificationManagementApi.listChangeRequests()
          .then((res) => {
            if (generation !== refreshGeneration.current) return;
            if (res.status === 'BLOCKED') {
              setChangeRequestsBlockedMsg(res.message);
              setChangeRequests([]);
            } else {
              setChangeRequestsBlockedMsg('');
              setChangeRequests(res.data);
              // Configuration receipts bridge submission to the next authoritative
              // queue load; don't continue presenting omitted/old statuses as current.
              setSessionSubmittedChanges((prev) =>
                prev.filter((item) => item.changeType !== 'EVENT_TRIGGER_CONFIG'),
              );
            }
          })
          .catch((err: any) => {
            if (generation !== refreshGeneration.current) return;
            setGlobalLoadErrors((prev) => ({
              ...prev,
              changeRequests: err?.message || 'Failed to load notification change requests',
            }));
          }),
      );
    }

    if (permissions.canViewAudit) {
      tasks.push(
        NotificationManagementApi.listNotificationGovernanceAudit(20)
          .then((value) => { if (generation === refreshGeneration.current) setAuditRows(value); })
          .catch(() => {
            // Non-fatal audit lookup
          }),
      );
    }

    await Promise.all(tasks);
    if (generation !== refreshGeneration.current) return;
    if (
      permissions.canViewCatalogue &&
      (activeTabRef.current === 'smsTemplates' || activeTabRef.current === 'emailTemplates')
    ) {
      await fetchTemplatesForChannel(
        activeTabRef.current === 'smsTemplates' ? 'SMS' : 'EMAIL',
        resolvedEvents,
        true,
      );
    }
    if (generation === refreshGeneration.current) setLoadingInitial(false);
  }, [permissions, fetchTemplatesForChannel]);

  useEffect(() => {
    void fetchAllReadSurfaces();
  }, [fetchAllReadSurfaces]);

  useEffect(() => {
    if (!permissions.canAccessModule || !permissions.canViewCatalogue || loadingInitial) return;
    if (activeTab === 'smsTemplates' && !loadedTemplateChannels.SMS) {
      void fetchTemplatesForChannel('SMS', events);
    } else if (activeTab === 'emailTemplates' && !loadedTemplateChannels.EMAIL) {
      void fetchTemplatesForChannel('EMAIL', events);
    }
  }, [
    activeTab,
    events,
    loadingInitial,
    loadedTemplateChannels.SMS,
    loadedTemplateChannels.EMAIL,
    permissions.canAccessModule,
    permissions.canViewCatalogue,
    fetchTemplatesForChannel,
  ]);

  useEffect(() => {
    if (permissions.canAccessModule && permissions.canViewDeliveries) {
      void fetchDeliveries();
    }
    return () => { deliveryReadGeneration.current += 1; };
  }, [permissions.canAccessModule, permissions.canViewDeliveries, fetchDeliveries]);

  useEffect(() => {
    if (
      permissions.canAccessModule &&
      permissions.canViewDeliveries &&
      (activeTab === 'deliveries' || activeTab === 'overview')
    ) {
      void fetchOutboxReceipts();
    }
    return () => { outboxReadGeneration.current += 1; };
  }, [permissions.canAccessModule, permissions.canViewDeliveries, activeTab, fetchOutboxReceipts]);

  useEffect(() => {
    if (selectedDelivery) deliveryInspectorRef.current?.focus();
  }, [selectedDelivery]);

  // Derived Overview Metrics (explicitly scoped to the loaded page slice vs total matching count)
  const deliveryRows = deliveryPageData?.data ?? [];
  const deliverySummary = useMemo(() => {
    let sent = 0;
    let failed = 0;
    let dead = 0;
    let unknown = 0;
    let skipped = 0;
    let pending = 0;
    let retried = 0;
    for (const row of deliveryRows) {
      if (row.status === 'SENT') sent += 1;
      else if (row.status === 'FAILED') failed += 1;
      else if (row.status === 'DEAD') dead += 1;
      else if (row.status === 'UNKNOWN') unknown += 1;
      else if (row.status === 'SKIPPED') skipped += 1;
      else if (row.status === 'PENDING') pending += 1;
      if (Number(row.attempts) > 1) retried += 1;
    }
    return {
      totalAllPages: deliveryPageData?.total ?? 0,
      loadedPageCount: deliveryRows.length,
      sent,
      failed,
      dead,
      unknown,
      skipped,
      pending,
      retried,
    };
  }, [deliveryRows, deliveryPageData?.total]);

  const eventStats = useMemo(() => {
    const security = events.filter((e) => e.deliveryClass === 'SECURITY').length;
    const transactional = events.filter((e) => e.deliveryClass === 'TRANSACTIONAL').length;
    const informational = events.filter((e) => e.deliveryClass === 'INFORMATIONAL').length;
    const eligibleToggle = events.filter(
      (event) =>
        !event.toggleLocked &&
        (['EVENT', 'SMS', 'EMAIL'] as const).some((target) =>
          canEditConfigurationTarget(event, target),
        ),
    ).length;
    const ordinary = events.filter((event) => event.deliveryClass !== 'SECURITY');
    const smsEnabledCount = ordinary.filter(
      (event) => event.eventEnabled === true && event.smsEnabled === true,
    ).length;
    const emailEnabledCount = ordinary.filter(
      (event) => event.eventEnabled === true && event.emailEnabled === true,
    ).length;
    const smsKnownCount = ordinary.filter(
      (event) =>
        event.eventEnabled === false ||
        (event.eventEnabled === true && typeof event.smsEnabled === 'boolean'),
    ).length;
    const emailKnownCount = ordinary.filter(
      (event) =>
        event.eventEnabled === false ||
        (event.eventEnabled === true && typeof event.emailEnabled === 'boolean'),
    ).length;
    return {
      total: events.length,
      security,
      transactional,
      informational,
      eligibleToggle,
      smsEnabledCount,
      emailEnabledCount,
      smsKnownCount,
      emailKnownCount,
    };
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase();
    return events.filter((item) => {
      if (
        q &&
        !item.eventType.toLowerCase().includes(q) &&
        !item.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (eventClassFilter !== 'ALL' && item.deliveryClass !== eventClassFilter) {
        return false;
      }
      if (
        eventGovernanceFilter === 'ELIGIBLE' &&
        (eventsSource !== 'LIVE' ||
          item.toggleLocked ||
          !(['EVENT', 'SMS', 'EMAIL'] as const).some((target) =>
            canEditConfigurationTarget(item, target),
          ))
      ) {
        return false;
      }
      if (eventGovernanceFilter === 'LOCKED' && !item.toggleLocked) return false;
      return true;
    });
  }, [events, eventsSource, eventSearch, eventClassFilter, eventGovernanceFilter]);

  const combinedChangeRequests = useMemo(() => {
    const seen = new Set(changeRequests.map((item) => item.id));
    const extras = sessionSubmittedChanges.filter((item) => !seen.has(item.id));
    return [...extras, ...changeRequests];
  }, [changeRequests, sessionSubmittedChanges]);
  const pendingConfigurationByEvent = useMemo(() => {
    const grouped = new Map<string, NotificationChangeRequestRecord[]>();
    for (const request of combinedChangeRequests) {
      if (
        request.changeType !== 'EVENT_TRIGGER_CONFIG' ||
        (request.status !== 'PENDING_APPROVAL' && request.status !== 'APPROVED')
      ) continue;
      const pending = grouped.get(request.eventType) ?? [];
      pending.push(request);
      grouped.set(request.eventType, pending);
    }
    return grouped;
  }, [combinedChangeRequests]);
  const pendingStatusWarning = loadingInitial
    ? 'Refreshing approval status; shown proposals are last known.'
    : changeRequestsBlockedMsg || globalLoadErrors.changeRequests
      ? 'Current approval status is unavailable; shown proposals are last known.'
      : '';

  const emailChannelBlocked = Boolean(
    providerBlockedMsg || (providerStatus !== null && !providerStatus.email.channelEnabledInSchema),
  );

  // Handlers — Event Trigger Configuration (Capability 2)
  const openTriggerConfigDrawer = (eventItem: NotificationEventCatalogueItem) => {
    if (!canProposeTriggerChange || eventsSource !== 'LIVE' || loadingInitial) return;
    setEditingTriggerEvent(eventItem);
    setDraftEventEnabled(eventItem.eventEnabled ?? false);
    setDraftSmsEnabled(eventItem.smsEnabled ?? false);
    setDraftEmailEnabled(eventItem.emailEnabled ?? false);
    setTriggerReason('');
    setTriggerValidationErrors([]);
    setTriggerFeedback(null);
  };

  const handleSubmitTriggerConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !canProposeTriggerChange ||
      !editingTriggerEvent ||
      eventsSource !== 'LIVE' ||
      loadingInitial ||
      isSavingTrigger
    ) return;

    setTriggerValidationErrors([]);
    setTriggerFeedback(null);
    const errors = validateTriggerConfigurationChange({
      event: editingTriggerEvent,
      eventEnabled: draftEventEnabled,
      smsEnabled: draftSmsEnabled,
      emailEnabled: draftEmailEnabled,
      reason: triggerReason,
    });
    if (errors.length > 0) {
      setTriggerValidationErrors(errors);
      return;
    }

    const desired: Array<{ channel: NotificationConfigurationTarget; enabled: boolean }> = [
      { channel: 'EVENT', enabled: draftEventEnabled },
      { channel: 'SMS', enabled: draftSmsEnabled },
      { channel: 'EMAIL', enabled: draftEmailEnabled },
    ];
    // Never submit untouched targets, and never replace the maker's snapshot version
    // with a later fetch: that could silently overwrite another administrator's work.
    const changes = desired.flatMap((target) => {
      const snapshot = getNotificationConfigurationSnapshot(editingTriggerEvent, target.channel);
      return snapshot && !snapshot.locked && snapshot.enabled !== target.enabled
        ? [{ ...target, expectedVersion: snapshot.version, previous: snapshot.enabled }]
        : [];
    });
    const created: Array<{ channel: NotificationConfigurationTarget; approvalId: string }> = [];
    let failure: { kind: 'blocked' | 'error'; message: string } | null = null;
    setIsSavingTrigger(true);
    try {
      for (const change of changes) {
        try {
          const result = await NotificationManagementApi.submitEventConfigurationChange(
            editingTriggerEvent.eventType,
            {
              channel: change.channel,
              enabled: change.enabled,
              expectedVersion: change.expectedVersion,
              reason: triggerReason.trim(),
            },
          );
          if (result.status === 'BLOCKED') {
            failure = { kind: 'blocked', message: `${change.channel}: ${result.message}` };
            break;
          }
          const approvalId = result.data.approvalId;
          if (!approvalId) {
            failure = {
              kind: 'error',
              message: `${change.channel} submission could not be confirmed. Check the approval queue before retrying.`,
            };
            break;
          }
          created.push({ channel: change.channel, approvalId });
          setSessionSubmittedChanges((prev) => [
            {
              id: approvalId,
              approvalId,
              changeType: 'EVENT_TRIGGER_CONFIG',
              eventType: editingTriggerEvent.eventType,
              channel: change.channel,
              summary: triggerReason.trim(),
              status: 'PENDING_APPROVAL',
              requestedBy: result.data.requestedBy ?? currentPrincipalId,
              requestedAt: result.data.updatedAt ?? new Date().toISOString(),
              proposedEventEnabled: change.channel === 'EVENT' ? change.enabled : undefined,
              proposedSmsEnabled: change.channel === 'SMS' ? change.enabled : undefined,
              proposedEmailEnabled: change.channel === 'EMAIL' ? change.enabled : undefined,
            },
            ...prev,
          ]);
          // A later target can fail independently. Reset only successful drafts so a
          // retry does not automatically create duplicate proposals for those targets.
          if (change.channel === 'EVENT') setDraftEventEnabled(change.previous);
          else if (change.channel === 'SMS') setDraftSmsEnabled(change.previous);
          else setDraftEmailEnabled(change.previous);
        } catch (err: unknown) {
          const status = err instanceof ApiError ? err.status : undefined;
          const detail = err instanceof Error ? err.message : '';
          const message = status === 409
            ? `Version conflict for ${change.channel}: the configuration changed since this drawer was opened. Close it, refresh the registry, and review the latest state before retrying.`
            : status === 403
              ? `Access denied (403) for ${change.channel}: ${detail || 'Not authorized to propose this change.'}`
              : status === 400 || status === 422
                ? `${change.channel} proposal was rejected: ${detail || 'Invalid request.'}`
                : `${change.channel} submission could not be confirmed${detail ? `: ${detail}` : '.'} Check the approval queue before retrying.`;
          failure = { kind: 'error', message };
          break;
        }
      }

      const receipts = created.length > 0
        ? `Created ${created.length} separate proposal${created.length === 1 ? '' : 's'} for maker-checker approval: ${created.map((item) => `${item.channel}=${item.approvalId}`).join(', ')}. `
        : '';
      if (failure) {
        setTriggerFeedback({
          kind: failure.kind,
          message: `${receipts}${failure.message} Remaining targets were not attempted. Proposals are not effective until approved and executed.`,
        });
      } else {
        setTriggerFeedback({
          kind: 'success',
          message: `${receipts}The effective configuration remains the registry state until each proposal is approved and executed.`,
        });
        setTriggerReason('');
      }
    } finally {
      setIsSavingTrigger(false);
    }
  };

  // Handlers — Approvals & Governance (Capability 8)
  const handleQueueDecision = async (
    record: NotificationChangeRequestRecord,
    decision: 'approve' | 'reject',
  ) => {
    const canDecide =
      record.changeType === 'EVENT_TRIGGER_CONFIG'
        ? permissions.canApproveConfiguration
        : permissions.canApproveTemplates;
    if (!canDecide || !hasNotificationCheckerIdentity || !permissions.hasMfaAssurance) return;

    if (record.requestedBy === currentPrincipalId) {
      setCheckerFeedback({
        kind: 'error',
        message: 'Self-approval prohibited: Maker and Checker must be distinct workforce principals.',
      });
      return;
    }
    if (decision === 'reject' && queueDecisionComment.trim().length < 5) {
      setCheckerFeedback({
        kind: 'error',
        message: 'Provide a rejection reason (at least 5 characters) before rejecting a change request.',
      });
      return;
    }

    const targetApprovalId = record.approvalId ?? record.id;
    setDecidingChangeId(record.id);
    setCheckerFeedback(null);
    try {
      const res = await NotificationManagementApi.decideNotificationChangeRequest(
        targetApprovalId,
        decision,
        queueDecisionComment.trim(),
      );
      if (res.status === 'BLOCKED') {
        setCheckerFeedback({ kind: 'blocked', message: res.message });
      } else {
        const status = res.data.status;
        setCheckerFeedback({
          kind: status === 'APPROVED' ? 'error' : 'success',
          message: res.data.message ?? `Change request ${targetApprovalId}: ${status}.`,
        });
        const updateReceipt = (item: NotificationChangeRequestRecord): NotificationChangeRequestRecord =>
          item.id === record.id ? { ...item, status, decidedBy: currentPrincipalId } : item;
        setSessionSubmittedChanges((prev) => prev.map(updateReceipt));
        setChangeRequests((prev) => prev.map(updateReceipt));
        setQueueDecisionComment('');
        await fetchAllReadSurfaces();
      }
    } catch (err: any) {
      setCheckerFeedback({
        kind: 'error',
        message: err?.message || `Failed to ${decision} notification change request.`,
      });
    } finally {
      setDecidingChangeId(null);
    }
  };

  const handleExecuteApprovedChange = async (
    approvalId: string,
    requestedBy?: string,
    rowId?: string,
  ) => {
    if (
      (!permissions.canApproveTemplates && !permissions.canApproveConfiguration) ||
      !hasNotificationCheckerIdentity ||
      !permissions.hasMfaAssurance
    ) {
      return;
    }
    if (!isUuidString(approvalId)) {
      setCheckerFeedback({
        kind: 'error',
        message: 'Enter a valid Workforce Approval ID (UUID) before executing an approved change.',
      });
      return;
    }
    if (requestedBy && requestedBy === currentPrincipalId) {
      setCheckerFeedback({
        kind: 'error',
        message: 'Self-execution prohibited: Maker and Checker must be distinct workforce principals.',
      });
      return;
    }
    if (executingApprovalId) return;

    const trackingKey = rowId ?? approvalId.trim();
    setExecutingApprovalId(trackingKey);
    setCheckerFeedback(null);
    try {
      const res = await NotificationManagementApi.executeApprovedNotificationChange(
        approvalId.trim(),
      );
      if (res.status === 'BLOCKED') {
        setCheckerFeedback({ kind: 'blocked', message: res.message });
      } else {
        setCheckerFeedback({
          kind: 'success',
          message:
            res.data.message ??
            `Approved notification change ${approvalId.trim()} executed (${res.data.status}).`,
        });
        setCheckerApprovalId('');
        await fetchAllReadSurfaces();
      }
    } catch (err: any) {
      setCheckerFeedback({
        kind: 'error',
        message: err?.message || 'Failed to execute approved notification change proposal.',
      });
    } finally {
      setExecutingApprovalId(null);
    }
  };

  const handleWorkforceApprovalSubmit = async (decision: 'approve' | 'reject') => {
    if (!permissions.canUseWorkforceApprovalEndpoint || !permissions.hasMfaAssurance) return;
    if (!isUuidString(checkerApprovalId)) {
      setCheckerFeedback({
        kind: 'error',
        message: 'Enter a valid Workforce Approval ID (UUID) to submit a checker decision.',
      });
      return;
    }
    if (decision === 'reject' && checkerComment.trim().length < 5) {
      setCheckerFeedback({
        kind: 'error',
        message: 'Enter a rejection comment (at least 5 characters) when rejecting an approval.',
      });
      return;
    }

    const trimmedApprovalId = checkerApprovalId.trim();
    setIsSubmittingChecker(true);
    setCheckerFeedback(null);
    try {
      await NotificationManagementApi.decideWorkforceApproval(
        trimmedApprovalId,
        decision,
        checkerComment,
      );
      setCheckerFeedback({
        kind: 'success',
        message:
          decision === 'approve'
            ? `Workforce approval ${trimmedApprovalId} signed and approved. If this is a notification proposal, execute it from the queue or via Execute Approved Proposal below to apply the change.`
            : `Workforce approval ${trimmedApprovalId} rejected.`,
      });
      if (decision === 'reject') {
        setCheckerApprovalId('');
      }
      setCheckerComment('');
      await fetchAllReadSurfaces();
    } catch (err: any) {
      setCheckerFeedback({
        kind: 'error',
        message: err?.message || `Failed to ${decision} workforce approval.`,
      });
    } finally {
      setIsSubmittingChecker(false);
    }
  };

  // Handlers — Deliveries Filtering & Retry (Capability 10)
  const handleApplyDeliveryFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setDeliveryFilterError('');
    if (filterRecipientId.trim() && !isUuidString(filterRecipientId)) {
      setDeliveryFilterError('Recipient ID filter must be a valid UUID.');
      return;
    }
    if (filterEventType.trim().length > 180) {
      setDeliveryFilterError('Event type filter must be at most 180 characters.');
      return;
    }
    setDeliveryPage(1);
    setAppliedFilters({
      status: filterStatus,
      channel: filterChannel,
      recipientType: filterRecipientType,
      eventType: filterEventType.trim(),
      recipientId: filterRecipientId.trim(),
    });
  };

  const handleManualDeliveryRetry = async (delivery: NotificationDeliveryRecord) => {
    if (!permissions.canManageConfiguration && !permissions.canTestSend) return;
    if (manualRetryReason.trim().length < 10) {
      setManualRetryFeedback({
        kind: 'error',
        message: 'Provide an operational reason (at least 10 characters) before requesting manual retry.',
      });
      return;
    }
    setIsRetryingDelivery(true);
    setManualRetryFeedback(null);
    try {
      const res = await NotificationManagementApi.requestManualDeliveryRetry(
        delivery.id,
        manualRetryReason.trim(),
      );
      if (res.status === 'BLOCKED') {
        setManualRetryFeedback({ kind: 'blocked', message: res.message });
      } else {
        setManualRetryFeedback({
          kind: 'success',
          message: `Manual retry queued (${res.data.status}). Financial ledger state is never re-executed on notification retry.`,
        });
        setManualRetryReason('');
        await fetchDeliveries(true);
      }
    } catch (err: any) {
      setManualRetryFeedback({
        kind: 'error',
        message: err?.message || 'Manual delivery retry failed.',
      });
    } finally {
      setIsRetryingDelivery(false);
    }
  };

  // Handlers — Controlled Test-Send (Capability 11 — fixed connectivity probe)
  const handleTestSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissions.canTestSend) return;

    setTestValidationErrors([]);
    setTestError('');
    setTestBlockedMsg('');
    setTestOutcome(null);

    const { errors, normalizedDestination } = validateTestSendRequest({
      channel: testChannel,
      destination: testDestination,
      workforceDestinationConfirmed: testWorkforceConfirmed,
    });

    if (errors.length > 0 || !normalizedDestination) {
      setTestValidationErrors(errors);
      return;
    }

    setIsSendingTest(true);
    try {
      const res = await NotificationManagementApi.submitTestSend({
        channel: testChannel,
        destination: normalizedDestination,
        workforceDestinationConfirmed: true,
      });

      if (res.status === 'BLOCKED') {
        setTestBlockedMsg(res.message);
        return;
      }

      setTestOutcome(res.data);
    } catch (err: any) {
      if (err?.status === 429) {
        setTestError(
          `Rate limit exceeded (429): ${err.message || 'Controlled test-send quota reached for this workforce principal. Wait before retrying.'}`,
        );
      } else if (err?.status === 403) {
        setTestError(
          `Access denied (403): ${err.message || 'Workforce principal lacks dual-control permission for test-send.'}`,
        );
      } else {
        setTestError(`Test-send outcome not confirmed. Check delivery records before retrying. ${err?.message || 'Service unavailable.'}`);
      }
    } finally {
      setIsSendingTest(false);
    }
  };

  // Capability 12: Top-level fail-closed guard when principal holds zero notification.* scopes
  if (!principal || !permissions.canAccessModule) {
    return (
      <div className="mn-operational" style={styles.container} role="alert" data-testid="notification-module-access-denied">
        <div style={styles.deniedBox}>
          <strong>Access Denied — Notification Management Scope Required</strong>
          <p style={{ margin: '6px 0 0 0', fontSize: 13 }}>
            This console requires at least one notification authorization function (such as{' '}
            <code>notification.view_deliveries</code>, <code>notification.view_events</code>,{' '}
            <code>notification.manage_templates</code>,{' '}
            <code>notification.manage_configuration</code>, or <code>notification.test_send</code>).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mn-operational notification-redesign" style={styles.container} data-testid="notification-management-screen">
      <div className="notification-redesign__header">
        <PageHeader eyebrow="System administration" title="SMS & Email Notification Management" description="Review event triggers, templates, provider configuration and delivery diagnostics under the existing governance controls." />
        <Button data-testid="refresh-notifications-console-btn" disabled={loadingInitial || isSavingTrigger} onClick={() => {
          void fetchAllReadSurfaces();
          if (permissions.canViewDeliveries) { void fetchDeliveries(); void fetchOutboxReceipts(); }
        }}>{loadingInitial ? 'Refreshing…' : 'Refresh Console'}</Button>
      </div>
      <div className="notification-redesign__boundary" role="note"><strong>Governed operations</strong><span>Changes require their existing authorization and approval steps. Reference data, provider configuration and delivery outcomes are distinct; opening this workspace does not start workers or send tests.</span></div>

      {/* Global partial-failure alerts */}
      {Object.keys(globalLoadErrors).length > 0 && (
        <div style={styles.errorAlert} role="alert" data-testid="notification-global-load-errors">
          {Object.entries(globalLoadErrors).map(([surface, msg]) => (
            <div key={surface}>
              <strong>{surface}:</strong> {msg}
            </div>
          ))}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="notification-redesign__tab-scroll"><div className="notification-redesign__tabs" role="tablist" aria-label="Notification management sections">
        {visibleTabs.map((tabItem, index) => (
          <button
            key={tabItem.key}
            id={`notification-tab-${tabItem.key}`}
            type="button"
            role="tab"
            data-testid={`notif-tab-${tabItem.key}`}
            aria-selected={activeTab === tabItem.key}
            aria-controls={`notification-panel-${tabItem.key}`}
            tabIndex={activeTab === tabItem.key ? 0 : -1}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % visibleTabs.length;
              else if (event.key === 'ArrowLeft') next = (index + visibleTabs.length - 1) % visibleTabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = visibleTabs.length - 1;
              else return;
              event.preventDefault();
              document.getElementById(`notification-tab-${visibleTabs[next].key}`)?.focus();
            }}
            onClick={() => setActiveTab(tabItem.key)}
          >
            {tabItem.label}
          </button>
        ))}
      </div></div>
      <p className="notification-redesign__tab-hint">Scroll to see all sections. Use arrow keys to move between tabs, then Enter or Space to open one.</p>
      {visibleTabs.filter((tabItem) => tabItem.key !== activeTab).map((tabItem) => (
        <div key={tabItem.key} id={`notification-panel-${tabItem.key}`} role="tabpanel" aria-labelledby={`notification-tab-${tabItem.key}`} hidden />
      ))}
      <div className="notification-redesign__panel" role="tabpanel" tabIndex={0} id={`notification-panel-${activeTab}`} aria-labelledby={`notification-tab-${activeTab}`}>
      {/* TAB 1: OVERVIEW (Capability 1) */}
      {activeTab === 'overview' && (
        <div style={styles.sectionStack} data-testid="notif-panel-overview">
          <div className="notification-redesign__section-heading"><p>WORKSPACE OVERVIEW</p><h2>Channel and service signals</h2><span>Read each source independently. A configured provider or enabled trigger does not guarantee a delivery.</span></div>
          {/* Channel Status Cards */}
          <div style={styles.cardGrid3}>
            <section style={styles.card} aria-label="SMS channel status">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>SMS Channel</h3>
                <span style={providerStatus?.sms?.operationalStatus === 'READY' ? styles.liveBadge : providerStatus?.sms?.operationalStatus === 'DEGRADED' || providerStatus?.sms?.operationalStatus === 'MISCONFIGURED' ? styles.blockedBadge : styles.mutedBadge}>
                  {providerStatus?.sms?.operationalStatus ?? (!permissions.canViewProviderStatus ? 'SCOPE RESTRICTED' : loadingInitial ? 'LOADING…' : 'STATUS UNAVAILABLE')}
                </span>
              </div>
              <p style={styles.cardDesc}>
                Outbox-driven transactional SMS via <code>NotificationDispatcherService</code> &{' '}
                <code>NotificationWorkerService</code> (Robase / Console provider seam).
              </p>
              <div style={styles.kvList}>
                <div>
                  <strong>Ordinary events with SMS gate enabled:</strong>{' '}
                  {eventsSource === 'LIVE'
                    ? `${eventStats.smsEnabledCount} / ${eventStats.smsKnownCount} with known state`
                    : 'Registry unavailable'}
                </div>
                <div>
                  <strong>Security events in catalogue:</strong> {eventStats.security} (direct-send flows are managed separately)
                </div>
                <div>
                  <strong>Agent SMS Note:</strong> Agent leg skipped until authoritative Agent phone model (D-N6)
                </div>
              </div>
            </section>

            <section style={styles.card} aria-label="Email channel status">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>Email Channel</h3>
                {emailChannelBlocked ? (
                  <span style={styles.blockedBadge} data-testid="overview-email-blocked-badge">
                    BLOCKED (ARENA 3)
                  </span>
                ) : !permissions.canViewProviderStatus ? (
                  <span style={styles.mutedBadge} data-testid="overview-email-restricted-badge">
                    SCOPE RESTRICTED
                  </span>
                ) : loadingInitial && !providerStatus ? (
                  <span style={styles.mutedBadge} data-testid="overview-email-loading-badge">
                    LOADING…
                  </span>
                ) : !providerStatus ? (
                  <span style={styles.blockedBadge} data-testid="overview-email-unavailable-badge">
                    STATUS UNAVAILABLE
                  </span>
                ) : providerStatus.email.operationalStatus === 'NOT_CONFIGURED' ||
                  String(providerStatus.email.provider).toUpperCase() === 'NONE' ? (
                  <span style={styles.mutedBadge} data-testid="overview-email-disabled-badge">
                    NOT CONFIGURED (DARK)
                  </span>
                ) : (
                  <span style={providerStatus.email.operationalStatus === 'READY' ? styles.liveBadge : providerStatus.email.operationalStatus === 'DEGRADED' ? styles.blockedBadge : styles.mutedBadge} data-testid="overview-email-live-badge">
                    {providerStatus.email.operationalStatus}
                  </span>
                )}
              </div>
              <p style={styles.cardDesc}>
                Transactional Email with subject + body templates and verified{' '}
                <code>customer_contact_methods</code> EMAIL resolution.
              </p>
              <div style={styles.kvList}>
                <div>
                  <strong>Ordinary events with Email gate enabled:</strong>{' '}
                  {eventsSource === 'LIVE'
                    ? `${eventStats.emailEnabledCount} / ${eventStats.emailKnownCount} with known state`
                    : 'Registry unavailable'}
                </div>
                <div>
                  <strong>Customer Preference Column:</strong> <code>notification_email_enabled</code>
                </div>
                <div>
                  <strong>Runtime Status:</strong>{' '}
                  {emailChannelBlocked
                    ? 'Pending ARENA 3 schema & provider adapter integration'
                    : !permissions.canViewProviderStatus
                      ? 'Requires notification.provider.view or notification.view_deliveries'
                      : !providerStatus
                        ? loadingInitial
                          ? 'Loading provider readiness…'
                          : 'Provider status not loaded (unavailable)'
                        : providerStatus.email.operationalStatus === 'NOT_CONFIGURED' ||
                            String(providerStatus.email.provider).toUpperCase() === 'NONE'
                          ? `Confirmed disabled / dark (${providerStatus.email.provider || 'NONE'})`
                          : `Provider: ${providerStatus.email.provider}`}
                </div>
              </div>
            </section>

            <section style={styles.card} aria-label="Event catalogue and outbox health">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>Event & Outbox Health</h3>
                <span
                  style={
                    eventsSource === 'LIVE' ? styles.liveBadge : styles.mutedBadge
                  }
                >
                  {!permissions.canViewCatalogue ? 'SCOPE RESTRICTED' : eventsSource === 'LOADING' ? 'CHECKING REGISTRY' : eventsSource === 'LIVE' ? 'DB REGISTRY READ' : 'STATIC REFERENCE'}
                </span>
              </div>
              <div style={styles.kvList}>
                <div>
                  <strong>Catalogue Events:</strong> {permissions.canViewCatalogue && eventsSource === 'LOADING' ? 'Checking registry…' : <>{eventStats.total} ({eventStats.security}{' '}Security · {eventStats.transactional} Transactional · {eventStats.informational}{' '}Informational)</>}
                </div>
                <div>
                  <strong>Eligible Editable Triggers:</strong>{' '}
                  {eventsSource === 'LIVE' ? `${eventStats.eligibleToggle} events` : 'Registry unavailable'}
                </div>
                <div>
                  <strong>Outbox Worker Posture:</strong>{' '}
                  {providerStatus ? (
                    providerStatus.projectionScope === 'MINIMAL' || providerStatus.worker.redacted ? (
                      <span data-testid="overview-worker-redacted-badge">
                        REDACTED (MINIMAL PROJECTION)
                      </span>
                    ) : providerStatus.worker.enabled ? (
                      'ENABLED'
                    ) : (
                      'DISABLED'
                    )
                  ) : permissions.canViewProviderStatus ? (
                    'Unloaded'
                  ) : (
                    'Requires provider status scope'
                  )}
                </div>
                <div>
                  <strong>Pending Shared Outbox:</strong>{' '}
                  {diagnostics?.pendingOutbox !== undefined
                    ? diagnostics.pendingOutbox
                    : outboxRows
                      ? `Unavailable; ${outboxRows.filter((r) => r.status === 'PENDING' || r.status === 'FAILED').length} pending or failed in loaded outbox sample (up to 25)`
                      : permissions.canViewDiagnostics || permissions.canViewOutbox
                        ? 'Unavailable'
                        : 'Requires diagnostics.view / outbox.view'}
                </div>
                <div>
                  <strong>Total Recorded Deliveries:</strong>{' '}
                  {permissions.canViewDeliveries
                    ? deliveryPageData && !deliveryError && !deliveryChannelBlockedMsg && !deliveryLoading
                      ? `${deliverySummary.totalAllPages} matching current filters`
                      : deliveryLoading ? 'Loading…' : 'Unavailable'
                    : 'Requires notification.view_deliveries'}
                </div>
              </div>
            </section>
          </div>

          {/* Backend Coordination & Readiness Matrix (F-13 reconciled contracts) */}
          <section
            style={styles.card}
            aria-label="Backend integration readiness matrix"
            data-testid="backend-readiness-matrix"
          >
            <h3 style={styles.cardTitle}>Backend API Contract Reference</h3>
            <p style={styles.cardDesc}>
              Contract reference, not a live health check for every endpoint. Policy-deferred capabilities
              (manual delivery retry and single-step template activation without proposal) remain explicitly disabled.
            </p>
            <div style={{ overflowX: 'auto' }} role="region" aria-label="Notification records table" tabIndex={0}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Capability / Surface</th>
                    <th style={styles.th}>Current Backend Contract</th>
                    <th style={styles.th}>Governance / Scope</th>
                    <th style={styles.th}>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={styles.td}>Delivery Diagnostics & Outbox Materialization Receipts</td>
                    <td style={styles.td}>
                      <code>GET /internal/notifications/deliveries</code> ·{' '}
                      <code>GET /internal/notifications/outbox-receipts</code>
                    </td>
                    <td style={styles.td}>
                      <code>notification.view_deliveries</code>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.mutedBadge}>CONTRACT LISTED</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Shared Outbox, Diagnostics & Safe Runtime Config</td>
                    <td style={styles.td}>
                      <code>GET /internal/outbox</code> · <code>GET /internal/diagnostics</code> ·{' '}
                      <code>GET /internal/configuration</code>
                    </td>
                    <td style={styles.td}>
                      <code>outbox.view</code> · <code>diagnostics.view</code>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.mutedBadge}>CONTRACT LISTED</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Two-Step Maker-Checker Approval & Proposal Execution</td>
                    <td style={styles.td}>
                      <code>GET /internal/notifications/changes</code> ·{' '}
                      <code>POST /internal/a2/workforce/approvals/:approvalId/approve|reject</code> ·{' '}
                      <code>POST /internal/notifications/changes/:approvalId/execute</code>
                    </td>
                    <td style={styles.td}>
                      <code>privileged:approve</code> (MFA, Maker ≠ Checker)
                    </td>
                    <td style={styles.td}>
                      {changeRequestsBlockedMsg ? <span style={styles.blockedBadge}>BLOCKED</span> : globalLoadErrors.changeRequests ? <span style={styles.blockedBadge}>UNAVAILABLE</span> : loadingInitial ? <span style={styles.mutedBadge}>CHECKING</span> : (permissions.canViewCatalogue || permissions.canApproveTemplates || permissions.canApproveConfiguration) ? <span style={styles.mutedBadge}>QUEUE READ</span> : <span style={styles.mutedBadge}>NOT CHECKED</span>}
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>DB Event Catalogue & Eligible Trigger Proposals</td>
                    <td style={styles.td}>
                      <code>GET /internal/notifications/events</code> ·{' '}
                      <code>POST /internal/notifications/changes</code>
                    </td>
                    <td style={styles.td}>
                      <code>SUPER_ADMIN</code> · <code>notification.view_deliveries</code> · MFA
                    </td>
                    <td style={styles.td}>
                      {eventsBlockedMsg ? <span style={styles.blockedBadge}>BLOCKED</span> : !permissions.canViewCatalogue ? <span style={styles.mutedBadge}>NOT CHECKED</span> : eventsSource === 'LOADING' ? <span style={styles.mutedBadge}>CHECKING</span> : eventsSource === 'LIVE' ? <span style={styles.mutedBadge}>REGISTRY READ</span> : <span style={styles.mutedBadge}>REFERENCE ONLY</span>}
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Editable SMS & Email Template Registry & Fixed-Sample Preview</td>
                    <td style={styles.td}>
                      <code>GET /internal/notifications/templates</code> · <code>POST /internal/notifications/changes</code> ·{' '}
                      <code>POST /internal/notifications/templates/preview</code>
                    </td>
                    <td style={styles.td}>
                      <code>notification.view_events</code> ·{' '}
                      <code>notification.manage_templates</code>
                    </td>
                    <td style={styles.td}>
                      {templateBlocked.SMS || templateBlocked.EMAIL ? (
                        <span style={styles.blockedBadge}>BLOCKED</span>
                      ) : templateErrors.SMS || templateErrors.EMAIL ? (
                        <span style={styles.blockedBadge}>UNAVAILABLE</span>
                      ) : loadedTemplateChannels.SMS && loadedTemplateChannels.EMAIL ? (
                        <span style={styles.mutedBadge}>REGISTRY READ</span>
                      ) : <span>NOT FULLY CHECKED</span>}
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Non-Secret Provider Status & Governed Provider Configs</td>
                    <td style={styles.td}>
                      <code>GET /internal/notifications/provider-status</code> ·{' '}
                      <code>GET /internal/notifications/provider-config</code> · <code>POST /internal/notifications/provider-config/proposals</code>
                    </td>
                    <td style={styles.td}>
                      <code>notification.provider.view</code> ·{' '}
                      <code>notification.provider.configure</code>
                    </td>
                    <td style={styles.td}>
                      {providerBlockedMsg ? <span style={styles.blockedBadge}>BLOCKED</span> : providerStatus ? <span style={styles.mutedBadge}>STATUS READ</span> : loadingInitial && permissions.canViewProviderStatus ? <span style={styles.mutedBadge}>CHECKING</span> : <span style={styles.mutedBadge}>NOT VERIFIED</span>}
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Controlled Connectivity Probe Test-Send</td>
                    <td style={styles.td}>
                      <code>POST /internal/notifications/test-send</code> (<code>channel</code> +{' '}
                      <code>destination</code>)
                    </td>
                    <td style={styles.td}>
                      <code>notification.test_send</code> (MFA)
                    </td>
                    <td style={styles.td}>
                      <span style={styles.mutedBadge}>CONTRACT LISTED</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: EVENT CATALOGUE & ELIGIBLE TRIGGERS (Capability 2) */}
      {activeTab === 'events' && (
        <div style={styles.sectionStack} data-testid="notif-panel-events">
          <div className="notification-redesign__section-heading"><p>EVENT GOVERNANCE</p><h2>Event Catalogue &amp; Triggers</h2><span>Search the loaded catalogue, review saved gates and prepare versioned changes for approval.</span></div>
          {eventsBlockedMsg && (
            <div
              style={styles.blockedBanner}
              role="status"
              data-testid="events-catalogue-blocked-banner"
            >
              <span style={styles.blockedBadge}>BLOCKED</span>{' '}
              <strong>Event Configuration Persistence Pending ARENA 1 Integration:</strong>{' '}
              {eventsBlockedMsg} Displaying read-only code-derived catalogue reference.
            </div>
          )}

          {!eventsBlockedMsg && eventsSource === 'OFFLINE_REFERENCE' && !loadingInitial && (
            <div
              style={styles.infoBanner}
              role="status"
              data-testid="catalogue-offline-reference-banner"
            >
              <strong>Static V1 Defaults Reference:</strong> Live event registry data was not
              returned; displaying static read-only defaults aligned with{' '}
              <code>NOTIFICATION_DEFAULTS_V1</code>.
            </div>
          )}

          {!canProposeTriggerChange && (
            <div data-testid="events-readonly-scope-notice">
              <Alert tone="info">
                Read-only catalogue view. Proposals require a non-read-only SUPER_ADMIN workforce
                session with notification.view_deliveries and MFA; the server makes the final
                authorization decision. SECURITY events remain locked.
              </Alert>
            </div>
          )}

          {/* Filter Bar */}
          <section className="notification-redesign__event-filters" aria-label="Event catalogue filters">
            <div className="notification-redesign__event-filter-heading"><div><p className="notification-redesign__eyebrow">FIND EVENTS</p><h3>Filter catalogue</h3><p>Filters apply to the currently loaded catalogue.</p></div><Button size="sm" onClick={() => { setEventSearch(''); setEventClassFilter('ALL'); setEventGovernanceFilter('ALL'); }}>Reset filters</Button></div>
            <div style={styles.filterGrid}>
              <div>
                <label htmlFor="event-search-input" style={styles.label}>
                  Search Event or Description
                </label>
                <input
                  id="event-search-input"
                  aria-label="Search event or description"
                  type="text"
                  style={styles.input}
                  placeholder="e.g. funding, cash_to_cash, support…"
                  value={eventSearch}
                  onChange={(e) => setEventSearch(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="event-class-filter" style={styles.label}>
                  Delivery Class
                </label>
                <select
                  id="event-class-filter"
                  aria-label="Delivery class filter"
                  style={styles.select}
                  value={eventClassFilter}
                  onChange={(e) => setEventClassFilter(e.target.value)}
                >
                  <option value="ALL">All classes</option>
                  <option value="SECURITY">SECURITY (Mandatory Direct-Send)</option>
                  <option value="TRANSACTIONAL">TRANSACTIONAL</option>
                  <option value="INFORMATIONAL">INFORMATIONAL</option>
                </select>
              </div>
              <div>
                <label htmlFor="event-governance-filter" style={styles.label}>
                  Trigger Governance
                </label>
                <select
                  id="event-governance-filter"
                  aria-label="Trigger governance filter"
                  style={styles.select}
                  value={eventGovernanceFilter}
                  onChange={(e) => setEventGovernanceFilter(e.target.value)}
                >
                  <option value="ALL">All events</option>
                  <option value="ELIGIBLE">Eligible editable triggers only</option>
                  <option value="LOCKED">Locked triggers only</option>
                </select>
              </div>
            </div>
            <p className="notification-redesign__event-count" role="status">Showing {filteredEvents.length} of {events.length} catalogue events.</p>
          </section>

          {/* Eligible Trigger Configuration Form Drawer */}
          {editingTriggerEvent && (
            <section
              ref={triggerDrawerRef}
              tabIndex={-1}
              className="notification-redesign__trigger-drawer"
              style={styles.drawerCard}
              aria-label="Configure event triggers"
              data-testid="event-trigger-config-panel"
            >
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>
                  Configure Eligible Triggers — <code>{editingTriggerEvent.eventType}</code>
                </h3>
                <Button size="sm" disabled={isSavingTrigger} onClick={() => { setEditingTriggerEvent(null); if (triggerOriginRef.current?.isConnected) triggerOriginRef.current.focus(); }}>
                  Close
                </Button>
              </div>
              <p style={styles.cardDesc}>{editingTriggerEvent.description}</p>
              {editingTriggerEvent.eventEnabled === false && (
                <div data-testid="event-master-disabled-notice">
                  <Alert tone="info">
                    This event is disabled. Enabling a channel alone will not send notifications;
                    saved channel choices are preserved when the event is disabled or re-enabled.
                  </Alert>
                </div>
              )}
              <p>
                Disabling the event suppresses both channels without changing their saved choices;
                re-enabling it uses those choices. These controls are drafts from the effective
                registry snapshot. Each changed control creates a separate proposal requiring
                approval and execution before it takes effect.
              </p>
              {(pendingConfigurationByEvent.get(editingTriggerEvent.eventType) ?? []).length > 0 && (
                <div data-testid={`event-pending-drawer-${editingTriggerEvent.eventType}`}>
                  {pendingStatusWarning && <p>{pendingStatusWarning}</p>}
                  {(pendingConfigurationByEvent.get(editingTriggerEvent.eventType) ?? []).map((request) => (
                    <div key={request.id}>{describePendingConfigurationChange(request)}</div>
                  ))}
                </div>
              )}

              {(loadingInitial || eventsSource !== 'LIVE') && <p role="status">The registry is not currently available. Your draft remains open, but submission is paused until a live read returns.</p>}
              <form onSubmit={(event) => void handleSubmitTriggerConfig(event)} noValidate>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--mn-space-6)',
                    flexWrap: 'wrap',
                    marginBottom: 'var(--mn-space-4)',
                  }}
                >
                  {[
                    {
                      channel: 'EVENT' as const,
                      label: 'Event master enabled',
                      testId: 'toggle-event-enabled-checkbox',
                      value: draftEventEnabled,
                      setValue: setDraftEventEnabled,
                    },
                    {
                      channel: 'SMS' as const,
                      label: 'SMS enabled',
                      testId: 'toggle-sms-enabled-checkbox',
                      value: draftSmsEnabled,
                      setValue: setDraftSmsEnabled,
                    },
                    {
                      channel: 'EMAIL' as const,
                      label: 'Email enabled',
                      testId: 'toggle-email-enabled-checkbox',
                      value: draftEmailEnabled,
                      setValue: setDraftEmailEnabled,
                    },
                  ].map((control) => {
                    const snapshot = getNotificationConfigurationSnapshot(
                      editingTriggerEvent,
                      control.channel,
                    );
                    const id = `notification-config-${control.channel}`;
                    const hint = !snapshot
                      ? 'Versioned configuration unavailable; refresh the registry.'
                      : snapshot.locked
                        ? 'This control is locked.'
                        : `Effective when opened: ${snapshot.enabled ? 'enabled' : 'disabled'}.`;
                    return (
                      <Field key={control.channel} label={control.label} htmlFor={id} hint={hint}>
                        <input
                          id={id}
                          type="checkbox"
                          aria-describedby={`${id}-hint`}
                          data-testid={control.testId}
                          checked={control.value}
                          onChange={(event) => control.setValue(event.target.checked)}
                          disabled={!canProposeTriggerChange || !snapshot || snapshot.locked || isSavingTrigger}
                        />
                      </Field>
                    );
                  })}
                </div>

                <div style={{ marginBottom: 'var(--mn-space-4)' }}>
                  <Field
                    label="Operational audit reason (required)"
                    htmlFor="trigger-audit-reason"
                    hint="10 to 500 characters; recorded with each proposal."
                  >
                    <input
                      id="trigger-audit-reason"
                      data-testid="trigger-reason-input"
                      type="text"
                      className="mn-input"
                      aria-describedby="trigger-audit-reason-hint"
                      placeholder="Explain why this configuration is changing"
                      value={triggerReason}
                      onChange={(event) => setTriggerReason(event.target.value)}
                      disabled={!canProposeTriggerChange || isSavingTrigger}
                    />
                  </Field>
                </div>

                {triggerValidationErrors.length > 0 && (
                  <div data-testid="trigger-validation-errors">
                    <Alert tone="danger">
                      <ul>
                        {triggerValidationErrors.map((err, idx) => <li key={idx}>{err}</li>)}
                      </ul>
                    </Alert>
                  </div>
                )}
                {triggerFeedback && (
                  <div data-testid={`trigger-submit-${triggerFeedback.kind}`}>
                    <Alert
                      tone={
                        triggerFeedback.kind === 'success'
                          ? 'success'
                          : triggerFeedback.kind === 'blocked'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {triggerFeedback.message}
                    </Alert>
                  </div>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  data-testid="submit-trigger-config-btn"
                  disabled={!canProposeTriggerChange || eventsSource !== 'LIVE' || loadingInitial || isSavingTrigger}
                >
                  {isSavingTrigger ? 'Submitting…' : 'Submit changes for approval'}
                </Button>
              </form>
            </section>
          )}

          {/* Event Catalogue Table */}
          <section className="notification-redesign__event-results" style={styles.card} aria-label="Event catalogue results">
            <p className="notification-redesign__eyebrow">LOADED CATALOGUE</p><h3>Event and channel settings</h3>
            <p>
              Event and saved channel settings are the last loaded registry state. Effective
              channels show configuration gates, not a delivery guarantee: recipient eligibility,
              preferences and provider state also apply. Proposals show only the loaded approval
              queue (and this session's new receipts); refresh for current status.
            </p>
            {filteredEvents.length === 0 && <div className="notification-redesign__event-empty">No catalogue events match these filters.</div>}
            <div style={{ overflowX: 'auto' }} role="region" aria-label="Event catalogue table" tabIndex={0}>
              <table style={styles.table} data-testid="notification-events-table">
                <thead>
                  <tr>
                    <th style={styles.th}>Event Type</th>
                    <th style={styles.th}>Class</th>
                    <th style={styles.th}>Recipient</th>
                    <th style={styles.th}>Runtime Wiring</th>
                    <th style={styles.th}>Event</th>
                    <th style={styles.th}>SMS saved</th>
                    <th style={styles.th}>Email saved</th>
                    <th style={styles.th}>Effective channels</th>
                    <th style={styles.th}>Loaded proposals</th>
                    <th style={styles.th}>Governance</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((row) => {
                    const isLocked =
                      row.toggleLocked ||
                      row.deliveryClass === 'SECURITY' ||
                      SECURITY_LOCKED_EVENT_TYPES.has(row.eventType);
                    const hasEditableTarget = (['EVENT', 'SMS', 'EMAIL'] as const)
                      .some((target) => canEditConfigurationTarget(row, target));
                    const configureDisabled = isLocked || !hasEditableTarget ||
                      !canProposeTriggerChange || eventsSource !== 'LIVE' || loadingInitial || isSavingTrigger;
                    const pending = pendingConfigurationByEvent.get(row.eventType) ?? [];

                    return (
                      <tr key={row.eventType} data-testid={`event-row-${row.eventType}`}>
                        <td style={styles.td}>
                          <div>
                            <code>{row.eventType}</code>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--mn-text-secondary, #52655f)', marginTop: 2 }}>
                            {row.description}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <span
                            style={
                              row.deliveryClass === 'SECURITY'
                                ? styles.securityChip
                                : row.deliveryClass === 'TRANSACTIONAL'
                                  ? styles.transactionalChip
                                  : styles.infoChip
                            }
                          >
                            {row.deliveryClass}
                          </span>
                        </td>
                        <td style={styles.td}>{row.recipientTarget}</td>
                        <td style={styles.td}>
                          <span style={{ fontSize: 12 }}>{row.runtimeTriggerState}</span>
                        </td>
                        <td style={styles.td} data-testid={`event-master-${row.eventType}`}>
                          {eventsSource !== 'LIVE' ? 'UNAVAILABLE' : row.eventEnabled === undefined
                            ? row.deliveryClass === 'SECURITY' ? 'NOT APPLICABLE' : 'UNAVAILABLE'
                            : row.eventEnabled ? 'ENABLED' : 'DISABLED'}
                        </td>
                        <td style={styles.td} data-testid={`saved-sms-${row.eventType}`}>
                          {eventsSource !== 'LIVE' || row.smsEnabled === undefined
                            ? 'UNAVAILABLE' : row.smsEnabled ? 'ENABLED' : 'DISABLED'}
                        </td>
                        <td style={styles.td} data-testid={`saved-email-${row.eventType}`}>
                          {eventsSource !== 'LIVE' || row.emailEnabled === undefined
                            ? 'UNAVAILABLE' : row.emailEnabled ? 'ENABLED' : 'DISABLED'}
                        </td>
                        <td style={styles.td} data-testid={`effective-channels-${row.eventType}`}>
                          {eventsSource === 'LIVE' ? effectiveConfiguredChannels(row) : 'Unavailable'}
                        </td>
                        <td style={styles.td} data-testid={`event-pending-${row.eventType}`}>
                          {pending.length > 0 ? (
                            <>
                              {pendingStatusWarning && <div>{pendingStatusWarning}</div>}
                              {pending.map((request) => (
                                <div key={request.id} title={request.approvalId ?? undefined}>
                                  {describePendingConfigurationChange(request)}
                                </div>
                              ))}
                            </>
                          ) : loadingInitial ? 'Loading' : changeRequestsBlockedMsg || globalLoadErrors.changeRequests
                            ? 'Approval status unavailable' : 'None in loaded queue'}
                        </td>
                        <td style={styles.td}>
                          {isLocked ? (
                            <span title={row.lockReason ?? undefined} style={styles.lockedChip}>
                              LOCKED
                            </span>
                          ) : eventsSource !== 'LIVE' || !hasEditableTarget ? (
                            'UNAVAILABLE'
                          ) : (
                            <span style={styles.eligibleChip}>ELIGIBLE</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <Button
                              size="sm"
                              data-testid={`configure-trigger-${row.eventType}`}
                              disabled={configureDisabled}
                              title={
                                isLocked ? row.lockReason ?? 'Trigger is locked by policy'
                                  : !canProposeTriggerChange ? 'Requires SUPER_ADMIN, notification.view_deliveries and MFA'
                                    : eventsSource !== 'LIVE' || !hasEditableTarget ? 'Live, unlocked versioned configuration is required'
                                      : undefined
                              }
                              aria-label={`${isLocked ? 'Locked' : 'Configure Triggers'} for ${row.eventType}`}
                              onClick={(event) => { triggerOriginRef.current = event.currentTarget; openTriggerConfigDrawer(row); }}
                            >
                              {isLocked ? 'Locked' : 'Configure Triggers'}
                            </Button>
                            {row.templateEditable && (
                              <>
                                <button
                                  type="button"
                                  style={styles.secondarySmallBtn}
                                  aria-label={`SMS Template for ${row.eventType}`}
                                  onClick={() => {
                                    setTemplateJumpEventType(row.eventType);
                                    setActiveTab('smsTemplates');
                                  }}
                                >
                                  SMS Template
                                </button>
                                <button
                                  type="button"
                                  style={styles.secondarySmallBtn}
                                  aria-label={`Email Template for ${row.eventType}`}
                                  onClick={() => {
                                    setTemplateJumpEventType(row.eventType);
                                    setActiveTab('emailTemplates');
                                  }}
                                >
                                  Email Template
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="notification-redesign__table-hint">Scroll horizontally to inspect all event and action columns.</p>
          </section>
        </div>
      )}

      {/* TAB 3: SMS TEMPLATES (Capabilities 3, 5, 6, 7) */}
      {activeTab === 'smsTemplates' && (
        <NotificationTemplateWorkspace
          channel="SMS"
          events={events}
          templates={templates}
          templatesRegistryBlocked={Boolean(templateBlocked.SMS)}
          templatesReadPending={!loadedTemplateChannels.SMS && !templateErrors.SMS}
          templatesReadError={templateErrors.SMS}
          emailChannelBlocked={emailChannelBlocked}
          permissions={permissions}
          currentPrincipalId={currentPrincipalId}
          initialEventType={templateJumpEventType}
          onTemplateSubmitted={(_outcome, record) => {
            setSessionSubmittedChanges((prev) => [record, ...prev]);
          }}
          onRefreshRequested={fetchAllReadSurfaces}
        />
      )}

      {/* TAB 4: EMAIL TEMPLATES (Capabilities 4, 5, 6, 7) */}
      {activeTab === 'emailTemplates' && (
        <NotificationTemplateWorkspace
          channel="EMAIL"
          events={events}
          templates={templates}
          templatesRegistryBlocked={Boolean(templateBlocked.EMAIL)}
          templatesReadPending={!loadedTemplateChannels.EMAIL && !templateErrors.EMAIL}
          templatesReadError={templateErrors.EMAIL}
          emailChannelBlocked={emailChannelBlocked}
          permissions={permissions}
          currentPrincipalId={currentPrincipalId}
          initialEventType={templateJumpEventType}
          onTemplateSubmitted={(_outcome, record) => {
            setSessionSubmittedChanges((prev) => [record, ...prev]);
          }}
          onRefreshRequested={fetchAllReadSurfaces}
        />
      )}

      {/* TAB 5: APPROVALS & GOVERNANCE (Capability 8) */}
      {activeTab === 'approvals' && (
        <div style={styles.sectionStack} data-testid="notif-panel-approvals">
          {/* Operator Governance Posture */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>⚖️ Maker-Checker Governance Posture</h3>
            <div style={styles.kvList}>
              <div>
                <strong>Authenticated Principal:</strong> <code>{currentPrincipalId}</code> · Roles:{' '}
                <code>{principal.roles.join(', ') || 'NONE'}</code> · Session Assurance:{' '}
                <strong style={{ color: permissions.hasMfaAssurance ? '#166534' : '#B45309' }}>
                  {principal.assuranceLevel}
                </strong>
              </div>
              <div>
                <strong>Maker Capabilities:</strong> Templates (
                {permissions.canManageTemplates ? 'Granted' : 'Not granted'}) · Event Triggers (
                {canProposeTriggerChange ? 'Granted' : 'Not granted'})
              </div>
              <div>
                <strong>Checker Capabilities:</strong> Approve Templates (
                {permissions.canApproveTemplates ? 'Granted' : 'Not granted'}) · Approve Triggers (
                {hasNotificationCheckerIdentity && permissions.hasMfaAssurance ? 'Granted' : 'Not granted'}) · Separation of
                Duties: <strong>Maker ≠ Checker strictly enforced</strong>
              </div>
            </div>
            {!permissions.hasMfaAssurance &&
              (permissions.canApproveTemplates || permissions.canApproveConfiguration) && (
                <div
                  style={{ ...styles.blockedBanner, marginTop: 10 }}
                  role="alert"
                  data-testid="approvals-mfa-required-banner"
                >
                  MFA session assurance is required to approve or reject governed notification
                  template or configuration changes.
                </div>
              )}
          </div>

          {checkerFeedback && (
            <div
              style={
                checkerFeedback.kind === 'success'
                  ? styles.successAlert
                  : checkerFeedback.kind === 'blocked'
                    ? styles.blockedBanner
                    : styles.errorAlert
              }
              role={checkerFeedback.kind === 'error' ? 'alert' : 'status'}
              data-testid={`checker-feedback-${checkerFeedback.kind}`}
            >
              {checkerFeedback.message}
            </div>
          )}

          {/* Notification Change Requests Queue */}
          <section style={styles.card} aria-label="Notification change requests queue">
            <div style={styles.cardTitleRow}>
              <h3 style={styles.cardTitle}>
                📋 Notification Configuration & Template Change Requests ({combinedChangeRequests.length})
              </h3>
              {changeRequestsBlockedMsg && (
                <span style={styles.blockedBadge} data-testid="change-requests-blocked-badge">
                  QUEUE API BLOCKED (ARENA 3)
                </span>
              )}
            </div>
            {changeRequestsBlockedMsg && (
              <p style={{ ...styles.cardDesc, color: '#92400E' }}>{changeRequestsBlockedMsg}</p>
            )}

            {(permissions.canApproveTemplates || permissions.canApproveConfiguration) && (
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="queue-decision-comment" style={styles.label}>
                  Checker Verification / Rejection Comment
                </label>
                <input
                  id="queue-decision-comment"
                  aria-label="Queue checker decision comment"
                  data-testid="queue-decision-comment-input"
                  type="text"
                  style={styles.input}
                  placeholder="Required for rejection (min 5 chars); optional audit note for approval…"
                  value={queueDecisionComment}
                  onChange={(e) => setQueueDecisionComment(e.target.value)}
                />
              </div>
            )}

            {combinedChangeRequests.length === 0 ? (
              <div style={styles.emptyBox}>
                No pending or recent notification change requests returned.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }} role="region" aria-label="Notification records table" tabIndex={0}>
                <table style={styles.table} data-testid="notification-change-requests-table">
                  <thead>
                    <tr>
                      <th style={styles.th}>Request / Approval ID</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Event & Channel</th>
                      <th style={styles.th}>Summary</th>
                      <th style={styles.th}>Requested By</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Checker Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinedChangeRequests.map((reqRow) => {
                      const isSelf = reqRow.requestedBy === currentPrincipalId;
                      const hasCheckerScope = hasNotificationCheckerIdentity &&
                        (reqRow.changeType === 'EVENT_TRIGGER_CONFIG'
                          ? permissions.canApproveConfiguration
                          : permissions.canApproveTemplates);
                      const canAct =
                        reqRow.status === 'PENDING_APPROVAL' &&
                        hasCheckerScope &&
                        permissions.hasMfaAssurance &&
                        !isSelf;

                      return (
                        <tr key={reqRow.id} data-testid={`change-request-row-${reqRow.id}`}>
                          <td style={styles.td}>
                            <code>{reqRow.approvalId ?? reqRow.id}</code>
                          </td>
                          <td style={styles.td}>{reqRow.changeType}</td>
                          <td style={styles.td}>
                            <code>{reqRow.eventType}</code> ({reqRow.channel})
                          </td>
                          <td style={styles.td}>{reqRow.summary}</td>
                          <td style={styles.td}>
                            <code>{reqRow.requestedBy}</code>
                          </td>
                          <td style={styles.td}>
                            <span
                              style={
                                reqRow.status === 'APPROVED' || reqRow.status === 'APPLIED'
                                  ? styles.liveBadge
                                  : reqRow.status === 'PENDING_APPROVAL'
                                    ? styles.blockedBadge
                                    : styles.mutedBadge
                              }
                            >
                              {reqRow.status}
                            </span>
                          </td>
                          <td style={styles.td}>
                            {reqRow.status === 'PENDING_APPROVAL' && hasCheckerScope ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  data-testid={`approve-change-${reqRow.id}`}
                                  disabled={!canAct || decidingChangeId === reqRow.id}
                                  title={
                                    isSelf
                                      ? 'Self-approval prohibited (Maker ≠ Checker)'
                                      : !permissions.hasMfaAssurance
                                        ? 'MFA session assurance required'
                                        : undefined
                                  }
                                  style={canAct ? styles.approveSmallBtn : styles.disabledSmallBtn}
                                  onClick={() => void handleQueueDecision(reqRow, 'approve')}
                                >
                                  {isSelf ? 'Maker ≠ Checker' : 'Approve'}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`reject-change-${reqRow.id}`}
                                  disabled={!canAct || decidingChangeId === reqRow.id}
                                  style={canAct ? styles.rejectSmallBtn : styles.disabledSmallBtn}
                                  onClick={() => void handleQueueDecision(reqRow, 'reject')}
                                >
                                  Reject
                                </button>
                              </div>
                            ) : reqRow.status === 'APPROVED' && hasCheckerScope ? (
                              <button
                                type="button"
                                data-testid={`execute-change-${reqRow.id}`}
                                disabled={
                                  isSelf ||
                                  !permissions.hasMfaAssurance ||
                                  executingApprovalId !== null
                                }
                                title={
                                  isSelf
                                    ? 'Self-execution prohibited (Maker ≠ Checker)'
                                    : !permissions.hasMfaAssurance
                                      ? 'MFA session assurance required'
                                      : 'Execute approved proposal via POST /internal/notifications/changes/:approvalId/execute'
                                }
                                style={
                                  !isSelf &&
                                  permissions.hasMfaAssurance &&
                                  executingApprovalId === null
                                    ? styles.approveSmallBtn
                                    : styles.disabledSmallBtn
                                }
                                onClick={() =>
                                  void handleExecuteApprovedChange(
                                    reqRow.approvalId ?? reqRow.id,
                                    reqRow.requestedBy,
                                    reqRow.id,
                                  )
                                }
                              >
                                {isSelf
                                  ? 'Maker ≠ Checker'
                                  : executingApprovalId === reqRow.id
                                    ? 'Executing…'
                                    : 'Execute Approved'}
                              </button>
                            ) : (
                              <span style={{ fontSize: 12, color: 'var(--mn-text-secondary, #52655f)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* LIVE Generic Workforce Approval Decision & Approved Proposal Execution Form */}
          <section
            style={styles.card}
            aria-label="Direct workforce approval decision"
            data-testid="live-workforce-approval-section"
          >
            <div style={styles.cardTitleRow}>
              <h3 style={styles.cardTitle}>
                ✅ Direct Workforce Approval & Two-Step Execution (
                <code>/internal/a2/workforce/approvals/:id</code> ·{' '}
                <code>/internal/notifications/changes/:approvalId/execute</code>)
              </h3>
              <span style={styles.liveBadge}>LIVE ENDPOINTS</span>
            </div>
            <p style={styles.cardDesc}>
              Authorized <code>FINANCE_CONTROLLER</code> checkers with <code>privileged:approve</code>{' '}
              and <code>MFA</code> assurance can approve or reject governed Approval IDs directly,
              and execute notification proposals already in <code>APPROVED</code> state (recovering
              proposals approved in the generic Workforce Approvals queue).
            </p>
            <div style={styles.filterGrid}>
              <div>
                <label htmlFor="direct-approval-id" style={styles.label}>
                  Pending or Approved Approval ID (UUID)
                </label>
                <input
                  id="direct-approval-id"
                  aria-label="Pending approval ID"
                  data-testid="direct-workforce-approval-id-input"
                  type="text"
                  style={styles.input}
                  placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                  value={checkerApprovalId}
                  onChange={(e) => setCheckerApprovalId(e.target.value)}
                  disabled={
                    !permissions.canUseWorkforceApprovalEndpoint ||
                    !permissions.hasMfaAssurance ||
                    isSubmittingChecker ||
                    executingApprovalId !== null
                  }
                />
              </div>
              <div>
                <label htmlFor="direct-approval-comment" style={styles.label}>
                  Audit Comment / Rejection Reason
                </label>
                <input
                  id="direct-approval-comment"
                  aria-label="Approval decision comment"
                  data-testid="direct-workforce-approval-comment-input"
                  type="text"
                  style={styles.input}
                  placeholder="Verification note or rejection reason…"
                  value={checkerComment}
                  onChange={(e) => setCheckerComment(e.target.value)}
                  disabled={
                    !permissions.canUseWorkforceApprovalEndpoint ||
                    !permissions.hasMfaAssurance ||
                    isSubmittingChecker ||
                    executingApprovalId !== null
                  }
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                data-testid="direct-workforce-approve-btn"
                disabled={
                  !permissions.canUseWorkforceApprovalEndpoint ||
                  !permissions.hasMfaAssurance ||
                  isSubmittingChecker ||
                  executingApprovalId !== null
                }
                style={
                  permissions.canUseWorkforceApprovalEndpoint && permissions.hasMfaAssurance
                    ? styles.primaryBtn
                    : styles.primaryBtnDisabled
                }
                onClick={() => void handleWorkforceApprovalSubmit('approve')}
              >
                Sign & Approve Action
              </button>
              <button
                type="button"
                data-testid="direct-execute-approved-btn"
                disabled={
                  (!permissions.canApproveTemplates && !permissions.canApproveConfiguration) ||
                  !permissions.hasMfaAssurance ||
                  isSubmittingChecker ||
                  executingApprovalId !== null
                }
                style={
                  (permissions.canApproveTemplates || permissions.canApproveConfiguration) &&
                  permissions.hasMfaAssurance &&
                  executingApprovalId === null
                    ? styles.secondaryBtn
                    : styles.primaryBtnDisabled
                }
                onClick={() => void handleExecuteApprovedChange(checkerApprovalId)}
              >
                {executingApprovalId !== null
                  ? 'Executing…'
                  : 'Execute Approved Proposal'}
              </button>
              <button
                type="button"
                data-testid="direct-workforce-reject-btn"
                disabled={
                  !permissions.canUseWorkforceApprovalEndpoint ||
                  !permissions.hasMfaAssurance ||
                  isSubmittingChecker ||
                  executingApprovalId !== null
                }
                style={
                  permissions.canUseWorkforceApprovalEndpoint && permissions.hasMfaAssurance
                    ? styles.rejectBtn
                    : styles.primaryBtnDisabled
                }
                onClick={() => void handleWorkforceApprovalSubmit('reject')}
              >
                Reject Action
              </button>
            </div>
          </section>

          {/* Governance Audit Trail (F-02 — normalized actor + full non-provider notification governance entity coverage) */}
          {permissions.canViewAudit && (
            <section
              style={styles.card}
              aria-label="Notification governance audit records"
              data-testid="notification-governance-audit-section"
            >
              <h3 style={styles.cardTitle}>📜 Recent Notification Governance Audit Events</h3>
              <p style={styles.cardDesc}>
                Covers <code>NOTIFICATION_TEMPLATE</code>, <code>NOTIFICATION_CHANGE</code>,{' '}
                <code>NOTIFICATION_EVENT_CONFIGURATION</code>, and{' '}
                <code>NOTIFICATION_TEST_SEND</code>. Provider credential configuration audit
                remains isolated to Tab 9 (<code>SUPER_ADMIN</code> & <code>FINANCE_AUDITOR</code>{' '}
                only).
              </p>
              {auditRows.length === 0 ? (
                <div style={styles.emptyBox}>
                  No notification governance audit events recorded yet.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }} role="region" aria-label="Notification records table" tabIndex={0}>
                  <table style={styles.table} data-testid="notification-governance-audit-table">
                    <thead>
                      <tr>
                        <th style={styles.th}>Entity Type</th>
                        <th style={styles.th}>Action</th>
                        <th style={styles.th}>Entity ID</th>
                        <th style={styles.th}>Actor</th>
                        <th style={styles.th}>Occurred At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditRows.map((row, idx) => (
                        <tr key={String(row.id ?? idx)}>
                          <td style={styles.td}>
                            <code>{String(row.entityType ?? 'NOTIFICATION_TEMPLATE')}</code>
                          </td>
                          <td style={styles.td}>{String(row.action ?? '—')}</td>
                          <td style={styles.td}>
                            <code>{String(row.entityId ?? '—')}</code>
                          </td>
                          <td style={styles.td}>
                            <code data-testid={`governance-audit-actor-${idx}`}>
                              {String(row.actor ?? row.actorId ?? 'SYSTEM')}
                            </code>
                          </td>
                          <td style={styles.td}>{String(row.occurredAt ?? row.createdAt ?? '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* TAB 6: PROVIDER STATUS WITHOUT EXPOSING SECRETS (Capability 9) */}
      {activeTab === 'providers' && (
        <div style={styles.sectionStack} data-testid="notif-panel-providers">
          <div style={styles.infoBanner} data-testid="provider-secret-free-banner">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>🔐 Secret-Free Provider Status & Governance:</strong> Stored provider API
                keys are encrypted at rest with AES-256-GCM and are NEVER returned in GET responses,
                logs, or audit trails. Only truthful lifecycle states, readiness gates, and masked
                4-character fingerprints are displayed here.
              </div>
              {permissions.canViewProviderConfig && (
                <button
                  type="button"
                  data-testid="jump-to-provider-config-btn"
                  onClick={() => setActiveTab('providerConfig')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #0f172a',
                    background: '#0f172a',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Configure Robase & Brevo →
                </button>
              )}
            </div>
          </div>

          {providerBlockedMsg && (
            <div
              style={styles.blockedBanner}
              role="status"
              data-testid="provider-status-blocked-banner"
            >
              <span style={styles.blockedBadge}>BLOCKED</span>{' '}
              <strong>Provider Telemetry Endpoint Pending ARENA 3 Integration:</strong>{' '}
              {providerBlockedMsg} Live runtime & outbox settings from{' '}
              <code>GET /internal/configuration</code> and <code>GET /internal/diagnostics</code>{' '}
              are shown below.
            </div>
          )}

          <div style={styles.cardGrid3}>
            {/* SMS Provider Card */}
            <section style={styles.card} aria-label="SMS provider configuration status">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>📱 SMS Provider Posture</h3>
                <span style={providerStatus ? styles.liveBadge : styles.blockedBadge}>
                  {providerStatus ? providerStatus.sms.operationalStatus : 'BLOCKED (ARENA 3)'}
                </span>
              </div>
              {providerStatus ? (
                <div style={styles.kvList} data-testid="sms-provider-status-details">
                  <div>
                    <strong>Selected Provider:</strong> <code>{providerStatus.sms.provider}</code>
                  </div>
                  <div>
                    <strong>API Base URL:</strong>{' '}
                    <code>{providerStatus.sms.baseUrl || 'Console local memory'}</code>
                  </div>
                  <div>
                    <strong>API Key Configured:</strong>{' '}
                    {providerStatus.sms.apiKeyConfigured ? 'Yes' : 'No'}
                  </div>
                  <div>
                    <strong>Live Prefix (robe_) Valid:</strong>{' '}
                    {providerStatus.sms.apiKeyPrefixValid ? 'Verified' : 'Not applicable / Invalid'}
                  </div>
                  <div>
                    <strong>Key Fingerprint (Masked):</strong>{' '}
                    <code>
                      {providerStatus.sms.apiKeyLast4Fingerprint
                        ? `••••${providerStatus.sms.apiKeyLast4Fingerprint}`
                        : 'Not set'}
                    </code>
                  </div>
                  <div>
                    <strong>Request Timeout:</strong> {providerStatus.sms.requestTimeoutMs} ms
                  </div>
                  <div>
                    <strong>Production Console Guard:</strong>{' '}
                    {providerStatus.sms.productionGuardSatisfied ? 'Satisfied' : 'Fails startup in prod'}
                  </div>
                  <div>
                    <strong>Sender Identity Mode:</strong>{' '}
                    {providerStatus.sms.senderIdentitySummary ||
                      'Workspace-level on Robase account (no per-message sender_id field)'}
                  </div>
                  <div>
                    <strong>Receipt Tracking:</strong> {providerStatus.sms.deliveryReceiptTracking}
                  </div>
                </div>
              ) : (
                <div style={styles.kvList}>
                  <div>
                    <strong>Architecture:</strong> Env-configured <code>NOTIFICATION_SMS_PROVIDER</code>{' '}
                    (<code>console</code> dev default | <code>robase</code> required in production).
                  </div>
                  <div>
                    <strong>Sender Identity:</strong> Configured at Robase workspace account level
                    (<code>POST /v1/sms/send</code> carries no per-message sender ID field).
                  </div>
                  <div>
                    <strong>Live Status Inspection:</strong> Awaiting{' '}
                    <code>GET /internal/notifications/provider-status</code> (ARENA 3).
                  </div>
                </div>
              )}
            </section>

            {/* Email Provider Card */}
            <section style={styles.card} aria-label="Email provider configuration status">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>📧 Email Provider & Sender Identity</h3>
                <span
                  style={
                    providerStatus?.email?.channelEnabledInSchema
                      ? styles.liveBadge
                      : styles.blockedBadge
                  }
                >
                  {providerStatus?.email
                    ? providerStatus.email.operationalStatus
                    : 'BLOCKED (ARENA 3)'}
                </span>
              </div>
              {providerStatus ? (
                <div style={styles.kvList} data-testid="email-provider-status-details">
                  <div>
                    <strong>DB Schema Widened (EMAIL):</strong>{' '}
                    {providerStatus.email.channelEnabledInSchema ? 'Yes' : 'No'}
                  </div>
                  <div>
                    <strong>Selected Provider:</strong>{' '}
                    <code>{providerStatus.email.provider || 'Not configured'}</code>
                  </div>
                  <div>
                    <strong>Credentials Configured:</strong>{' '}
                    {providerStatus.email.credentialsConfigured ? 'Yes' : 'No'}
                  </div>
                  <div>
                    <strong>Credential Fingerprint:</strong>{' '}
                    <code>
                      {providerStatus.email.credentialFingerprint
                        ? `••••${providerStatus.email.credentialFingerprint}`
                        : 'None'}
                    </code>
                  </div>
                  <div>
                    <strong>Verified Sender Identity:</strong>{' '}
                    {providerStatus.email.fromName
                      ? `${providerStatus.email.fromName} <${providerStatus.email.fromAddress ?? ''}>`
                      : providerStatus.email.fromAddress || 'Not configured'}
                  </div>
                  <div>
                    <strong>Domain DKIM/SPF Status:</strong>{' '}
                    {providerStatus.email.domainVerificationStatus}
                  </div>
                  <div>
                    <strong>Honors Customer Email Preference:</strong>{' '}
                    {providerStatus.email.honorsCustomerEmailPreference ? 'Yes' : 'No'}
                  </div>
                </div>
              ) : (
                <div style={styles.kvList}>
                  <div>
                    <strong>Channel Readiness:</strong> Pending ARENA 3{' '}
                    <code>NotificationChannel</code> EMAIL widening & provider adapter (Decision D-N4).
                  </div>
                  <div>
                    <strong>Destination Source:</strong> Verified{' '}
                    <code>customer_contact_methods</code> EMAIL records.
                  </div>
                  <div>
                    <strong>Customer Opt-Out Column:</strong>{' '}
                    <code>notification_preferences.notification_email_enabled</code>.
                  </div>
                </div>
              )}
            </section>

            {/* Worker & Live Runtime Config Card (F-12 MINIMAL projection honest display) */}
            <section style={styles.card} aria-label="Worker and retry runtime posture">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>⚙️ Worker & Retry Policy</h3>
                {providerStatus &&
                (providerStatus.projectionScope === 'MINIMAL' || providerStatus.worker.redacted) ? (
                  <span style={styles.mutedBadge} data-testid="provider-worker-redacted-badge">
                    MINIMAL PROJECTION
                  </span>
                ) : (
                  <span style={styles.liveBadge}>RUNTIME READ-ONLY</span>
                )}
              </div>
              <div style={styles.kvList} data-testid="worker-runtime-status-details">
                <div>
                  <strong>Projection Scope:</strong>{' '}
                  <code>{providerStatus?.projectionScope ?? 'UNLOADED'}</code>
                </div>
                <div>
                  <strong>Environment:</strong>{' '}
                  <code>
                    {providerStatus?.environment ??
                      runtimeConfig?.environment ??
                      (permissions.canViewDiagnostics ? 'unknown' : 'Redacted (MINIMAL projection)')}
                  </code>
                </div>
                <div>
                  <strong>App / API Version:</strong>{' '}
                  <code>
                    {permissions.canViewDiagnostics
                      ? `${runtimeConfig?.version ?? diagnostics?.version ?? '0.1.0'} (${
                          runtimeConfig?.apiVersion ?? 'v1'
                        })`
                      : 'Requires diagnostics.view'}
                  </code>
                </div>
                <div>
                  <strong>Worker Poller Enabled:</strong>{' '}
                  {providerStatus ? (
                    providerStatus.projectionScope === 'MINIMAL' || providerStatus.worker.redacted ? (
                      <span data-testid="provider-worker-redacted-value">
                        REDACTED (requires notification.view_deliveries — not disabled)
                      </span>
                    ) : providerStatus.worker.enabled ? (
                      'ENABLED'
                    ) : (
                      'DISABLED (NOTIFICATION_WORKER_ENABLED=false)'
                    )
                  ) : (
                    'Unloaded'
                  )}
                </div>
                <div>
                  <strong>SMS Retry Policy:</strong>{' '}
                  {providerStatus
                    ? providerStatus.projectionScope === 'MINIMAL' || providerStatus.worker.redacted
                      ? 'REDACTED in MINIMAL projection (requires notification.view_deliveries)'
                      : `Max ${providerStatus.worker.smsRetryMaxAttempts} attempts · Base ${providerStatus.worker.smsRetryBaseDelaySeconds}s exponential backoff`
                    : 'Bounded exponential backoff (FOR UPDATE SKIP LOCKED)'}
                </div>
                <div>
                  <strong>Outbox Retry Delay:</strong>{' '}
                  {runtimeConfig?.outboxRetryDelaySeconds !== undefined
                    ? `${runtimeConfig.outboxRetryDelaySeconds}s`
                    : permissions.canViewDiagnostics
                      ? '60s'
                      : 'Requires diagnostics.view'}
                </div>
                <div>
                  <strong>Live Pending Outbox:</strong>{' '}
                  {diagnostics?.pendingOutbox !== undefined
                    ? diagnostics.pendingOutbox
                    : 'Requires diagnostics.view'}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 7: DELIVERIES, FAILURES & RETRIES (Capability 10) */}
      {activeTab === 'deliveries' && (
        <div style={styles.sectionStack} data-testid="notif-panel-deliveries">
          <div className="notification-redesign__section-heading"><p>DELIVERY OPERATIONS</p><h2>Deliveries &amp; receipts</h2><span>Filter recorded deliveries, inspect an individual outcome and review outbox materialization receipts separately. Opening this view does not retry or send notifications.</span></div>
          {!permissions.canViewDeliveries ? (
            <div style={styles.deniedBox} role="alert" data-testid="deliveries-scope-denied">
              Viewing notification delivery history requires{' '}
              <code>notification.view_deliveries</code>.
            </div>
          ) : (
            <>
              {/* Summary Strip — explicitly distinguishes total matching count across all pages from current loaded page sample */}
              {deliveryPageData && !deliveryError && !deliveryChannelBlockedMsg && !deliveryLoading && <>
              <div
                style={{ fontSize: 12, color: 'var(--mn-text-secondary, #52655f)', marginBottom: -4 }}
                data-testid="delivery-summary-scope-note"
              >
                Status counts below summarize the{' '}
                <strong>
                  currently loaded page ({deliverySummary.loadedPageCount} of{' '}
                  {deliverySummary.totalAllPages} matching records
                </strong>
                , Page {deliveryPageData?.page ?? deliveryPage} of{' '}
                {Math.max(1, deliveryPageData?.totalPages ?? 1)}). Use filters below for full-dataset
                status queries.
              </div>
              <div style={styles.kpiRow} data-testid="delivery-summary-cards">
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>Total Matching Records (All Pages)</div>
                  <div style={styles.kpiValue} data-testid="delivery-total-matching-count">
                    {deliverySummary.totalAllPages}
                  </div>
                </div>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>
                    Current Page ({deliverySummary.loadedPageCount} rows) · SENT
                  </div>
                  <div style={{ ...styles.kpiValue, color: '#166534' }}>{deliverySummary.sent}</div>
                </div>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>
                    Current Page ({deliverySummary.loadedPageCount} rows) · FAILED / DEAD
                  </div>
                  <div style={{ ...styles.kpiValue, color: '#DC2626' }}>
                    {deliverySummary.failed + deliverySummary.dead}
                  </div>
                </div>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>
                    Current Page ({deliverySummary.loadedPageCount} rows) · UNKNOWN / PENDING
                  </div>
                  <div style={{ ...styles.kpiValue, color: '#92400E' }}>
                    {deliverySummary.unknown + deliverySummary.pending}
                  </div>
                </div>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>
                    Current Page ({deliverySummary.loadedPageCount} rows) · Retried (&gt;1)
                  </div>
                  <div style={{ ...styles.kpiValue, color: '#D97706' }}>
                    {deliverySummary.retried}
                  </div>
                </div>
              </div>

              </>}
              {/* Filter Form */}
              <form
                onSubmit={handleApplyDeliveryFilters}
                className="notification-redesign__delivery-filters"
                style={styles.card}
                aria-label="Filter notification deliveries"
              >
                <p className="notification-redesign__eyebrow">SEARCH RECORDED DELIVERIES</p>
                <h3>Delivery filters</h3>
                <p>Changes apply only when you select Apply Filters. Page size applies immediately.</p>
                <div style={styles.filterGrid}>
                  <div>
                    <label htmlFor="deliv-status-filter" style={styles.label}>
                      Status
                    </label>
                    <select
                      id="deliv-status-filter"
                      aria-label="Delivery status"
                      style={styles.select}
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                    >
                      <option value="">All statuses</option>
                      <option value="PENDING">PENDING</option>
                      <option value="SENT">SENT</option>
                      <option value="FAILED">FAILED</option>
                      <option value="DEAD">DEAD (Retry Exhausted)</option>
                      <option value="UNKNOWN">UNKNOWN (Ambiguous Dispatch)</option>
                      <option value="SKIPPED">SKIPPED</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="deliv-channel-filter" style={styles.label}>
                      Channel
                    </label>
                    <select
                      id="deliv-channel-filter"
                      aria-label="Delivery channel"
                      style={styles.select}
                      value={filterChannel}
                      onChange={(e) => setFilterChannel(e.target.value)}
                    >
                      <option value="">All channels</option>
                      <option value="SMS">SMS</option>
                      <option value="EMAIL">EMAIL</option>
                      <option value="PUSH">PUSH</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="deliv-recipient-type" style={styles.label}>
                      Recipient Type
                    </label>
                    <select
                      id="deliv-recipient-type"
                      aria-label="Recipient type"
                      style={styles.select}
                      value={filterRecipientType}
                      onChange={(e) => setFilterRecipientType(e.target.value)}
                    >
                      <option value="">All recipients</option>
                      <option value="CUSTOMER">CUSTOMER</option>
                      <option value="AGENT">AGENT</option>
                      <option value="PHONE">PHONE (Direct / Non-Account)</option>
                      <option value="WORKFORCE">WORKFORCE</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="deliv-event-type" style={styles.label}>
                      Event Type
                    </label>
                    <input
                      id="deliv-event-type"
                      aria-label="Event type filter"
                      type="text"
                      style={styles.input}
                      placeholder="e.g. customer.funding.approved"
                      value={filterEventType}
                      onChange={(e) => setFilterEventType(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="deliv-recipient-id" style={styles.label}>
                      Recipient ID (UUID)
                    </label>
                    <input
                      id="deliv-recipient-id"
                      aria-label="Recipient UUID filter"
                      type="text"
                      style={styles.input}
                      placeholder="Customer or Agent UUID"
                      value={filterRecipientId}
                      onChange={(e) => setFilterRecipientId(e.target.value)}
                    />
                  </div>
                </div>
                <div className="notification-redesign__delivery-actions" style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="submit" style={styles.primaryBtn} data-testid="apply-delivery-filters-btn">
                    Apply Filters
                  </button>
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    onClick={() => {
                      setFilterStatus('');
                      setFilterChannel('');
                      setFilterRecipientType('');
                      setFilterEventType('');
                      setFilterRecipientId('');
                      setDeliveryFilterError('');
                      setDeliveryPage(1);
                      setAppliedFilters({
                        status: '',
                        channel: '',
                        recipientType: '',
                        eventType: '',
                        recipientId: '',
                      });
                    }}
                  >
                    Clear Filters
                  </button>
                  <label htmlFor="deliveries-page-size" style={styles.label}>Rows per page</label>
                  <select
                    id="deliveries-page-size"
                    aria-label="Deliveries page size"
                    style={{ ...styles.select, width: 120 }}
                    value={String(deliveryLimit)}
                    onChange={(e) => {
                      setDeliveryPage(1);
                      setDeliveryLimit(Number(e.target.value));
                    }}
                  >
                    <option value="10">10 / page</option>
                    <option value="20">20 / page</option>
                    <option value="50">50 / page</option>
                  </select>
                </div>
              </form>

              {deliveryChannelBlockedMsg && (
                <div
                  style={styles.blockedBanner}
                  role="status"
                  data-testid="delivery-email-filter-blocked"
                >
                  <span style={styles.blockedBadge}>BLOCKED</span> {deliveryChannelBlockedMsg}
                </div>
              )}

              {(deliveryFilterError || deliveryError) && (
                <div style={styles.errorAlert} role="alert" data-testid="delivery-filter-error">
                  {deliveryFilterError || deliveryError}
                </div>
              )}

              {/* Delivery Inspector Drawer */}
              {selectedDelivery && (
                <section
                  ref={deliveryInspectorRef} tabIndex={-1} className="notification-redesign__delivery-inspector"
                  style={styles.drawerCard}
                  aria-label="Delivery diagnostic inspector"
                  data-testid="delivery-inspector-panel"
                >
                  <div style={styles.cardTitleRow}>
                    <h3 style={styles.cardTitle}>
                      Delivery & Retry Diagnostics — <code>{selectedDelivery.id}</code>
                    </h3>
                    <button
                      type="button"
                      style={styles.secondarySmallBtn}
                      onClick={() => {
                        setSelectedDelivery(null);
                        setManualRetryFeedback(null);
                        setManualRetryReason('');
                        if (deliveryOriginRef.current?.isConnected) deliveryOriginRef.current.focus();
                      }}
                    >
                      Close Inspector
                    </button>
                  </div>
                  <p className="notification-redesign__inspector-note">This is the delivery snapshot captured when the inspector opened. Refresh the list and reopen it to inspect newer data.</p>
                  <div style={styles.kvList}>
                    <div>
                      <strong>Event:</strong> <code>{selectedDelivery.eventType}</code> · Event Key:{' '}
                      <code>{selectedDelivery.eventKey}</code>
                    </div>
                    <div>
                      <strong>Channel & Status:</strong> <code>{selectedDelivery.channel}</code> ·{' '}
                      <strong>{selectedDelivery.status}</strong> (Note: <code>SENT</code> indicates
                      accepted by provider; destination phone/email is redacted by backend privacy policy)
                    </div>
                    <div>
                      <strong>Recipient:</strong> {selectedDelivery.recipientType}{' '}
                      <code>{selectedDelivery.recipientId}</code>
                    </div>
                    <div>
                      <strong>Attempts & Retry Isolation:</strong> {selectedDelivery.attempts}{' '}
                      attempt(s) · Provider Ref:{' '}
                      <code>{selectedDelivery.providerRef || 'None'}</code> · Correlation ID:{' '}
                      <code>{selectedDelivery.correlationId || 'None'}</code> (Retries never re-run
                      committed financial operations)
                    </div>
                    <div>
                      <strong>Timestamps:</strong> Created{' '}
                      {new Date(selectedDelivery.createdAt).toLocaleString()}
                      {selectedDelivery.sentAt
                        ? ` · Sent ${new Date(selectedDelivery.sentAt).toLocaleString()}`
                        : ''}
                      {selectedDelivery.failedAt
                        ? ` · Failed ${new Date(selectedDelivery.failedAt).toLocaleString()}`
                        : ''}
                    </div>
                    {selectedDelivery.errorCode && (
                      <div style={{ color: '#991B1B' }}>
                        <strong>Error / Skip Code:</strong>{' '}
                        <code>{selectedDelivery.errorCode}</code>
                      </div>
                    )}
                    {/* SPRINT1-P0-02: rendered message content is no longer returned by the
                        diagnostics API (data minimization) and is never displayed here. */}
                  </div>

                  {selectedDelivery.status === 'FAILED' &&
                    (permissions.canManageConfiguration || permissions.canTestSend) && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #CBD5E1' }}>
                        <label htmlFor="manual-retry-reason" style={styles.label}>
                          Request Manual Delivery Retry (ARENA 3 Boundary)
                        </label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                          <input
                            id="manual-retry-reason"
                            aria-label="Manual retry reason"
                            data-testid="manual-retry-reason-input"
                            type="text"
                            style={{ ...styles.input, maxWidth: 420 }}
                            placeholder="Operational reason for manual retry (min 10 chars)…"
                            value={manualRetryReason}
                            onChange={(e) => setManualRetryReason(e.target.value)}
                          />
                          <button
                            type="button"
                            data-testid="request-manual-retry-btn"
                            disabled={isRetryingDelivery}
                            style={styles.secondaryBtn}
                            onClick={() => void handleManualDeliveryRetry(selectedDelivery)}
                          >
                            {isRetryingDelivery ? 'Requesting…' : 'Request Manual Retry'}
                          </button>
                        </div>
                        {manualRetryFeedback && (
                          <div
                            style={{
                              ...(manualRetryFeedback.kind === 'success'
                                ? styles.successAlert
                                : manualRetryFeedback.kind === 'blocked'
                                  ? styles.blockedBanner
                                  : styles.errorAlert),
                              marginTop: 10,
                            }}
                            role={manualRetryFeedback.kind === 'error' ? 'alert' : 'status'}
                            data-testid={`manual-retry-${manualRetryFeedback.kind}`}
                          >
                            {manualRetryFeedback.message}
                          </div>
                        )}
                      </div>
                    )}
                </section>
              )}

              {/* Deliveries Table */}
              <section style={styles.card} className="notification-redesign__delivery-results" aria-label="Delivery results">
                <p className="notification-redesign__eyebrow">RECORDED DELIVERIES</p><h3>Delivery results</h3>
                <p>Filters applied: {appliedFilters.status || 'All statuses'} · {appliedFilters.channel || 'All channels'} · {appliedFilters.recipientType || 'All recipient types'}{appliedFilters.eventType ? ` · ${appliedFilters.eventType}` : ''}{appliedFilters.recipientId ? ` · ${appliedFilters.recipientId}` : ''}</p>
                {deliveryLoading ? (
                  <div style={styles.emptyBox}>Loading notification deliveries…</div>
                ) : deliveryError || deliveryChannelBlockedMsg || !deliveryPageData ? (
                  <div style={styles.emptyBox}>Delivery records unavailable.</div>
                ) : deliveryRows.length === 0 ? (
                  <div style={styles.emptyBox}>
                    No notification delivery records matched the selected filters.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }} role="region" aria-label="Delivery records table" tabIndex={0}>
                    <table style={styles.table} data-testid="notification-deliveries-table">
                      <thead>
                        <tr>
                          <th style={styles.th}>Event</th>
                          <th style={styles.th}>Channel</th>
                          <th style={styles.th}>Recipient</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Attempts</th>
                          <th style={styles.th}>Provider Ref</th>
                          <th style={styles.th}>Error / Skip Code</th>
                          <th style={styles.th}>Created</th>
                          <th style={styles.th}>Inspect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveryRows.map((row) => (
                          <tr key={row.id} data-testid={`delivery-row-${row.id}`}>
                            <td style={styles.td}>
                              <code>{row.eventType}</code>
                            </td>
                            <td style={styles.td}>{row.channel}</td>
                            <td style={styles.td}>
                              {row.recipientType} <code>{row.recipientId.slice(0, 8)}…</code>
                            </td>
                            <td style={styles.td}>
                              <span
                                style={
                                  row.status === 'SENT'
                                    ? styles.liveBadge
                                    : row.status === 'FAILED' || row.status === 'DEAD'
                                      ? styles.securityChip
                                      : row.status === 'UNKNOWN'
                                        ? styles.blockedBadge
                                        : styles.mutedBadge
                                }
                              >
                                {row.status}
                              </span>
                            </td>
                            <td style={styles.td}>{row.attempts}</td>
                            <td style={styles.td}>
                              <code>{row.providerRef || '—'}</code>
                            </td>
                            <td style={styles.td}>
                              <code>{row.errorCode || '—'}</code>
                            </td>
                            <td style={styles.td}>
                              {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                            </td>
                            <td style={styles.td}>
                              <button
                                type="button"
                                data-testid={`inspect-delivery-${row.id}`}
                                aria-label={`Inspect delivery ${row.id}`}
                                style={styles.secondarySmallBtn}
                                onClick={(event) => {
                                  deliveryOriginRef.current = event.currentTarget;
                                  setSelectedDelivery(row);
                                  setManualRetryReason('');
                                  setManualRetryFeedback(null);
                                }}
                              >
                                Inspect
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination */}
                {deliveryPageData && !deliveryError && !deliveryChannelBlockedMsg && <div style={styles.pagerRow} data-testid="notification-deliveries-pager">
                  <button
                    type="button"
                    style={
                      deliveryPage <= 1 ? styles.disabledSmallBtn : styles.secondarySmallBtn
                    }
                    disabled={deliveryPage <= 1 || deliveryLoading}
                    onClick={() => setDeliveryPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--mn-text-secondary, #52655f)' }}>
                    Page {deliveryPageData?.page ?? deliveryPage} of{' '}
                    {Math.max(1, deliveryPageData?.totalPages ?? 1)} · Total{' '}
                    {deliveryPageData?.total ?? 0}
                  </span>
                  <button
                    type="button"
                    style={
                      !deliveryPageData?.hasNextPage
                        ? styles.disabledSmallBtn
                        : styles.secondarySmallBtn
                    }
                    disabled={!deliveryPageData?.hasNextPage || deliveryLoading}
                    onClick={() => setDeliveryPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>}
                <p className="notification-redesign__table-hint">Scroll horizontally to inspect all delivery columns.</p>
              </section>

              {/* Outbox Materialization Receipts Section (F-04 — QUARANTINED / FAILED / SUPPRESSED / MATERIALIZED / UNSUPPORTED) */}
              <section
                style={styles.card}
                className="notification-redesign__outbox-results"
                aria-label="Notification outbox materialization receipts"
                data-testid="outbox-receipts-section"
              >
                <div style={styles.cardTitleRow}>
                  <div>
                    <h3 style={styles.cardTitle}>
                      Outbox Materialization Receipts
                    </h3>
                    <p style={styles.cardDesc}>
                      Tracks outbox-to-notification materialization outcomes, including{' '}
                      <code>QUARANTINED</code> and <code>FAILED</code> receipts that never became
                      outbound delivery rows.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label htmlFor="outbox-receipt-status-filter" style={styles.label}>
                      Receipt Status
                    </label>
                    <select
                      id="outbox-receipt-status-filter"
                      aria-label="Outbox receipt status"
                      data-testid="outbox-receipt-status-select"
                      style={{ ...styles.select, width: 190 }}
                      value={outboxReceiptStatusFilter}
                      onChange={(e) => {
                        setOutboxReceiptPage(1);
                        setOutboxReceiptStatusFilter(e.target.value);
                      }}
                    >
                      <option value="">All receipt statuses</option>
                      <option value="QUARANTINED">QUARANTINED</option>
                      <option value="FAILED">FAILED</option>
                      <option value="SUPPRESSED">SUPPRESSED</option>
                      <option value="UNSUPPORTED">UNSUPPORTED</option>
                      <option value="MATERIALIZED">MATERIALIZED</option>
                    </select>
                  </div>
                </div>

                {outboxReceiptBlockedMsg && (
                  <div style={styles.blockedBanner} role="status" data-testid="outbox-receipts-blocked">
                    <span style={styles.blockedBadge}>BLOCKED</span> {outboxReceiptBlockedMsg}
                  </div>
                )}

                {outboxReceiptError && (
                  <div style={styles.errorAlert} role="alert" data-testid="outbox-receipts-error">
                    {outboxReceiptError}
                  </div>
                )}

                {outboxReceiptLoading ? (
                  <div style={styles.emptyBox}>Loading outbox materialization receipts…</div>
                ) : outboxReceiptError || outboxReceiptBlockedMsg || !outboxReceiptPageData ? (
                  <div style={styles.emptyBox}>Outbox receipts unavailable.</div>
                ) : outboxReceiptPageData.data.length === 0 ? (
                  <div style={styles.emptyBox}>
                    No notification outbox receipts matched the selected status filter.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }} role="region" aria-label="Outbox receipts table" tabIndex={0}>
                    <table style={styles.table} data-testid="outbox-receipts-table">
                      <thead>
                        <tr>
                          <th style={styles.th}>Outbox Event ID</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Reason</th>
                          <th style={styles.th}>Attempts</th>
                          <th style={styles.th}>Next Attempt</th>
                          <th style={styles.th}>Updated At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(outboxReceiptPageData?.data ?? []).map((receipt) => (
                          <tr
                            key={receipt.outboxEventId}
                            data-testid={`outbox-receipt-row-${receipt.outboxEventId}`}
                          >
                            <td style={styles.td}>
                              <code>{receipt.outboxEventId}</code>
                            </td>
                            <td style={styles.td}>
                              <span
                                style={
                                  receipt.status === 'MATERIALIZED'
                                    ? styles.liveBadge
                                    : receipt.status === 'QUARANTINED' ||
                                        receipt.status === 'FAILED'
                                      ? styles.securityChip
                                      : styles.mutedBadge
                                }
                              >
                                {receipt.status}
                              </span>
                            </td>
                            <td style={styles.td}>
                              <code>{receipt.reason || '—'}</code>
                            </td>
                            <td style={styles.td}>{receipt.attempts}</td>
                            <td style={styles.td}>
                              {receipt.nextAttemptAt
                                ? new Date(receipt.nextAttemptAt).toLocaleString()
                                : '—'}
                            </td>
                            <td style={styles.td}>
                              {receipt.updatedAt
                                ? new Date(receipt.updatedAt).toLocaleString()
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {outboxReceiptPageData && !outboxReceiptError && !outboxReceiptBlockedMsg && !outboxReceiptLoading && <div style={styles.pagerRow} data-testid="outbox-receipts-pager">
                  <button
                    type="button"
                    style={
                      outboxReceiptPage <= 1 ? styles.disabledSmallBtn : styles.secondarySmallBtn
                    }
                    disabled={outboxReceiptPage <= 1 || outboxReceiptLoading}
                    onClick={() => setOutboxReceiptPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--mn-text-secondary, #52655f)' }}>
                    Page {outboxReceiptPageData?.page ?? outboxReceiptPage} of{' '}
                    {Math.max(1, outboxReceiptPageData?.totalPages ?? 1)} · Total{' '}
                    {outboxReceiptPageData?.total ?? 0}
                  </span>
                  <button
                    type="button"
                    style={
                      !outboxReceiptPageData?.hasNextPage
                        ? styles.disabledSmallBtn
                        : styles.secondarySmallBtn
                    }
                    disabled={!outboxReceiptPageData?.hasNextPage || outboxReceiptLoading}
                    onClick={() => setOutboxReceiptPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>}
                <p className="notification-redesign__table-hint">Scroll horizontally to inspect all receipt columns.</p>
              </section>
            </>
          )}
        </div>
      )}

      {/* TAB 8: CONTROLLED TEST-SEND (Capability 11 — Fixed Connectivity Probe Contract) */}
      {activeTab === 'testSend' && (
        <div style={styles.sectionStack} data-testid="notif-panel-test-send">
          {!permissions.canTestSend && (
            <div
              style={styles.infoBanner}
              role="status"
              data-testid="test-send-scope-restricted-banner"
            >
              <strong>Permission Required:</strong> Controlled test-send requires the{' '}
              <code>notification.test_send</code> authorization function and MFA session assurance.
              Submission controls are disabled for the current principal.
            </div>
          )}

          <section style={styles.card} aria-label="Controlled test notification form">
            <h3 style={styles.cardTitle}>🧪 Controlled Connectivity Probe Test-Send</h3>
            <p style={styles.cardDesc} data-testid="test-send-contract-notice">
              Dispatches a fixed non-financial connectivity probe via{' '}
              <code>POST /internal/notifications/test-send</code> accepting{' '}
              <code>{'{ channel, destination }'}</code> only. Event-specific template rendering is
              verified separately in Tabs 3 & 4 via non-sending Server Preview. Destinations are
              restricted strictly to verified workforce-owned phone numbers or email addresses.
            </p>

            <form onSubmit={handleTestSendSubmit} noValidate>
              <div style={styles.filterGrid}>
                <div>
                  <label htmlFor="test-send-channel" style={styles.label}>
                    Channel <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <select
                    id="test-send-channel"
                    aria-label="Test send channel"
                    data-testid="test-send-channel-select"
                    style={styles.select}
                    value={testChannel}
                    onChange={(e) =>
                      setTestChannel(e.target.value as ManagedNotificationChannel)
                    }
                    disabled={!permissions.canTestSend || isSendingTest}
                  >
                    <option value="SMS">SMS</option>
                    <option value="EMAIL">EMAIL</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="test-send-destination" style={styles.label}>
                    Workforce-Owned Destination ({testChannel === 'SMS' ? 'E.164 / NG Phone' : 'Email'}){' '}
                    <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <input
                    id="test-send-destination"
                    aria-label="Workforce destination"
                    data-testid="test-send-destination-input"
                    type="text"
                    style={styles.input}
                    placeholder={
                      testChannel === 'SMS'
                        ? '+2348030000100 or 08030000100'
                        : 'ops.tester@monienaija.internal'
                    }
                    value={testDestination}
                    onChange={(e) => setTestDestination(e.target.value)}
                    disabled={!permissions.canTestSend || isSendingTest}
                  />
                </div>
              </div>

              <div style={{ marginTop: 12, marginBottom: 14 }}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    aria-label="Confirm workforce-owned destination"
                    data-testid="test-send-workforce-attestation"
                    checked={testWorkforceConfirmed}
                    onChange={(e) => setTestWorkforceConfirmed(e.target.checked)}
                    disabled={!permissions.canTestSend || isSendingTest}
                  />
                  <span>
                    I attest that this destination belongs to an authorized MonieNaija workforce
                    operator and is <strong>not</strong> a customer phone number or email address.
                  </span>
                </label>
              </div>

              {testValidationErrors.length > 0 && (
                <div
                  style={styles.errorAlert}
                  role="alert"
                  data-testid="test-send-validation-errors"
                >
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {testValidationErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {testBlockedMsg && (
                <div
                  style={styles.blockedBanner}
                  role="alert"
                  data-testid="test-send-blocked-banner"
                >
                  <strong>BLOCKED — Controlled Test-Send Pending ARENA 3 Integration</strong>
                  <p style={{ margin: '4px 0 0 0' }}>{testBlockedMsg}</p>
                </div>
              )}

              {testError && (
                <div style={styles.errorAlert} role="alert" data-testid="test-send-error-banner">
                  {testError}
                </div>
              )}

              {testOutcome && (
                <div
                  style={
                    testOutcome.status === 'FAILED' ? styles.errorAlert : styles.successAlert
                  }
                  role="status"
                  data-testid="test-send-outcome-banner"
                >
                  <strong>Test-Send Status: {testOutcome.status}</strong>
                  {testOutcome.status === 'SENT' && testOutcome.provider === 'console' && <p>Console simulation only; no live provider delivery was confirmed.</p>}
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    {testOutcome.deliveryId && (
                      <span>
                        Delivery ID: <code>{testOutcome.deliveryId}</code> ·{' '}
                      </span>
                    )}
                    {testOutcome.approvalId && (
                      <span>
                        Approval ID: <code>{testOutcome.approvalId}</code> ·{' '}
                      </span>
                    )}
                    {testOutcome.providerRef && (
                      <span>
                        Provider Ref: <code>{testOutcome.providerRef}</code> ·{' '}
                      </span>
                    )}
                    {testOutcome.correlationId && (
                      <span>
                        Correlation ID: <code>{testOutcome.correlationId}</code>
                      </span>
                    )}
                  </div>
                </div>
              )}

              <button
                type="submit"
                data-testid="submit-test-send-btn"
                disabled={!permissions.canTestSend || isSendingTest}
                style={
                  !permissions.canTestSend || isSendingTest
                    ? styles.primaryBtnDisabled
                    : styles.primaryBtn
                }
              >
                {isSendingTest
                  ? 'Submitting Test-Send…'
                  : `Submit Controlled ${testChannel} Test-Send`}
              </button>
            </form>
          </section>
        </div>
      )}

      {/* TAB 9: GOVERNED PROVIDER CONFIGURATION (Robase SMS & Brevo Transactional Email) */}
      {activeTab === 'providerConfig' && permissions.canViewProviderConfig && (
        <div style={styles.sectionStack} data-testid="notif-panel-providerConfig">
          <ProviderConfigurationWorkspace
            principalId={currentPrincipalId || null}
            principalRoles={principal?.roles ?? []}
            permissions={permissions}
            onRefreshParentStatus={() => void fetchAllReadSurfaces()}
          />
        </div>
      )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1440, margin: '0 auto' },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--mn-text-primary, #132b25)' },
  subtitle: { margin: '4px 0 0 0', fontSize: 13, color: 'var(--mn-text-secondary, #52655f)', maxWidth: 820 },
  tabBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
    borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
    paddingBottom: 12,
  },
  tabBtn: {
    background: '#FFFFFF',
    color: 'var(--mn-text-primary, #132b25)',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
    padding: '8px 13px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  activeTabBtn: {
    background: 'var(--mn-text-primary, #132b25)',
    color: '#FFFFFF',
    border: '1px solid var(--mn-text-primary, #132b25)',
    borderRadius: 8,
    padding: '8px 13px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  sectionStack: { display: 'flex', flexDirection: 'column', gap: 16 },
  cardGrid3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: 16,
  },
  card: {
    background: '#FFFFFF',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 10,
    padding: 18,
  },
  drawerCard: {
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    border: '2px solid var(--mn-text-primary, #132b25)',
    borderRadius: 10,
    padding: 18,
  },
  cardTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--mn-text-primary, #132b25)' },
  cardDesc: { margin: '0 0 12px 0', fontSize: 13, color: 'var(--mn-text-secondary, #52655f)', lineHeight: 1.45 },
  kvList: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--mn-text-primary, #132b25)' },
  liveBadge: {
    background: '#DCFCE7',
    color: '#166534',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  blockedBadge: {
    background: 'var(--mn-status-warning-bg, #fff3d9)',
    color: '#92400E',
    border: '1px solid var(--mn-status-warning, #8c5600)',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  mutedBadge: {
    background: 'var(--mn-surface-sunken, #eef3f0)',
    color: 'var(--mn-text-secondary, #52655f)',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  },
  securityChip: {
    background: 'var(--mn-status-danger-bg, #fdebe9)',
    color: '#991B1B',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  transactionalChip: {
    background: '#DBEAFE',
    color: '#1E40AF',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  infoChip: {
    background: 'var(--mn-surface-sunken, #eef3f0)',
    color: 'var(--mn-text-primary, #132b25)',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  },
  lockedChip: {
    background: '#FEF2F2',
    color: '#991B1B',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  eligibleChip: {
    background: '#DCFCE7',
    color: '#166534',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  blockedBanner: {
    background: '#FFFBEB',
    border: '1px solid var(--mn-status-warning, #8c5600)',
    color: '#92400E',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    marginBottom: 8,
  },
  infoBanner: {
    background: '#EFF6FF',
    border: '1px solid #93C5FD',
    color: '#1E3A8A',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
  },
  errorAlert: {
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    color: '#991B1B',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    marginBottom: 10,
  },
  successAlert: {
    background: '#F0FDF4',
    border: '1px solid #BBF7D0',
    color: '#166534',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    marginBottom: 10,
  },
  deniedBox: {
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    color: '#991B1B',
    borderRadius: 10,
    padding: 18,
  },
  filterGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
    gap: 12,
  },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--mn-text-primary, #132b25)', marginBottom: 4 },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 11px',
    borderRadius: 8,
    border: '1px solid #CBD5E1',
    fontSize: 13,
  },
  select: {
    width: '100%',
    padding: '8px 11px',
    borderRadius: 8,
    border: '1px solid #CBD5E1',
    fontSize: 13,
    background: '#FFFFFF',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--mn-text-primary, #132b25)',
    cursor: 'pointer',
  },
  primaryBtn: {
    background: 'var(--mn-text-primary, #132b25)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    padding: '9px 15px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  primaryBtnDisabled: {
    background: 'var(--mn-text-muted, #5b6b66)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    padding: '9px 15px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'not-allowed',
  },
  rejectBtn: {
    background: '#B91C1C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    padding: '9px 15px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    background: '#FFFFFF',
    color: 'var(--mn-text-primary, #132b25)',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondarySmallBtn: {
    background: '#FFFFFF',
    color: 'var(--mn-text-primary, #132b25)',
    border: '1px solid #CBD5E1',
    borderRadius: 6,
    padding: '4px 9px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  approveSmallBtn: {
    background: '#047857',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 6,
    padding: '4px 9px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  rejectSmallBtn: {
    background: '#B91C1C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 6,
    padding: '4px 9px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  disabledSmallBtn: {
    background: 'var(--mn-surface-sunken, #eef3f0)',
    color: 'var(--mn-text-muted, #5b6b66)',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 6,
    padding: '4px 9px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'not-allowed',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    padding: '9px 10px',
    borderBottom: '2px solid var(--mn-border-subtle, #dde7e2)',
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: 12,
    fontWeight: 700,
  },
  td: {
    padding: '9px 10px',
    borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
    verticalAlign: 'top',
  },
  emptyBox: {
    padding: 14,
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    border: '1px dashed #CBD5E1',
    borderRadius: 8,
    fontSize: 13,
    color: 'var(--mn-text-secondary, #52655f)',
  },
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
    gap: 12,
  },
  kpiCard: {
    background: '#FFFFFF',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 10,
    padding: '12px 16px',
  },
  kpiLabel: { fontSize: 12, color: 'var(--mn-text-secondary, #52655f)', fontWeight: 600 },
  kpiValue: { fontSize: 22, fontWeight: 700, color: 'var(--mn-text-primary, #132b25)', marginTop: 4 },
  pagerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTop: '1px solid var(--mn-border-subtle, #dde7e2)',
  },
};
