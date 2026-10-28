import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NotificationTemplateWorkspace } from '../../components/NotificationTemplateWorkspace';
import {
  BASELINE_CODE_EVENT_CATALOGUE,
  BASELINE_CODE_TEMPLATES,
  deriveNotificationPermissions,
  isUuidString,
  ManagedNotificationChannel,
  NotificationChangeRequestRecord,
  NotificationDeliveryPage,
  NotificationDeliveryRecord,
  NotificationEventCatalogueItem,
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
import { useAuthStore } from '../../store/auth-store';

export type NotificationAdminTab =
  | 'overview'
  | 'events'
  | 'smsTemplates'
  | 'emailTemplates'
  | 'approvals'
  | 'providers'
  | 'deliveries'
  | 'testSend';

interface TabDefinition {
  key: NotificationAdminTab;
  label: string;
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
];

export const NotificationManagementScreen: React.FC<{ initialTab?: NotificationAdminTab }> = ({
  initialTab = 'overview',
}) => {
  const { principal } = useAuthStore();
  const permissions = useMemo(() => deriveNotificationPermissions(principal), [principal]);
  const currentPrincipalId = principal?.principalId ?? '';

  const [activeTab, setActiveTab] = useState<NotificationAdminTab>(initialTab);
  const [templateJumpEventType, setTemplateJumpEventType] = useState<string | undefined>(undefined);

  // Core data & boundary state
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [events, setEvents] = useState<NotificationEventCatalogueItem[]>(
    BASELINE_CODE_EVENT_CATALOGUE,
  );
  const [eventsBlockedMsg, setEventsBlockedMsg] = useState<string>('');
  const [templates, setTemplates] = useState<NotificationTemplateVersion[]>(BASELINE_CODE_TEMPLATES);
  const [templatesBlockedMsg, setTemplatesBlockedMsg] = useState<string>('');
  const [providerStatus, setProviderStatus] = useState<NotificationProviderStatus | null>(null);
  const [providerBlockedMsg, setProviderBlockedMsg] = useState<string>('');
  const [runtimeConfig, setRuntimeConfig] = useState<SafeRuntimeConfiguration | null>(null);
  const [diagnostics, setDiagnostics] = useState<LiveDiagnosticsSummary | null>(null);
  const [outboxRows, setOutboxRows] = useState<Array<Record<string, unknown>>>([]);
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
  const [draftSmsEnabled, setDraftSmsEnabled] = useState<boolean>(true);
  const [draftEmailEnabled, setDraftEmailEnabled] = useState<boolean>(false);
  const [triggerReason, setTriggerReason] = useState<string>('');
  const [triggerApprovalId, setTriggerApprovalId] = useState<string>('');
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
  const [queueDecisionComment, setQueueDecisionComment] = useState<string>('');

  // Deliveries & Retries State (Capability 10)
  const [deliveryPageData, setDeliveryPageData] = useState<NotificationDeliveryPage | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState<boolean>(false);
  const [deliveryError, setDeliveryError] = useState<string>('');
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

  // Controlled Test-Send State (Capability 11)
  const [testChannel, setTestChannel] = useState<ManagedNotificationChannel>('SMS');
  const [testEventType, setTestEventType] = useState<string>('customer.funding.approved');
  const [testDestination, setTestDestination] = useState<string>('');
  const [testReason, setTestReason] = useState<string>('');
  const [testApprovalId, setTestApprovalId] = useState<string>('');
  const [testWorkforceConfirmed, setTestWorkforceConfirmed] = useState<boolean>(false);
  const [testValidationErrors, setTestValidationErrors] = useState<string[]>([]);
  const [testOutcome, setTestOutcome] = useState<ControlledTestSendOutcome | null>(null);
  const [testBlockedMsg, setTestBlockedMsg] = useState<string>('');
  const [testError, setTestError] = useState<string>('');
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);

  const fetchDeliveries = useCallback(async () => {
    if (!permissions.canViewDeliveries) return;
    setDeliveryLoading(true);
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
      if (res.status === 'BLOCKED') {
        setDeliveryChannelBlockedMsg(res.message);
        setDeliveryPageData({
          data: [],
          total: 0,
          page: 1,
          limit: deliveryLimit,
          totalPages: 0,
          hasNextPage: false,
        });
      } else {
        setDeliveryPageData(res.data);
      }
    } catch (err: any) {
      setDeliveryError(err?.message || 'Failed to load notification deliveries.');
    } finally {
      setDeliveryLoading(false);
    }
  }, [permissions.canViewDeliveries, deliveryPage, deliveryLimit, appliedFilters]);

  const fetchAllReadSurfaces = useCallback(async () => {
    if (!permissions.canAccessModule) {
      setLoadingInitial(false);
      return;
    }

    setLoadingInitial(true);
    setGlobalLoadErrors({});

    const tasks: Promise<void>[] = [];

    if (permissions.canViewCatalogue) {
      tasks.push(
        NotificationManagementApi.listEvents()
          .then((res) => {
            if (res.status === 'BLOCKED') {
              setEventsBlockedMsg(res.message);
              setEvents(BASELINE_CODE_EVENT_CATALOGUE);
            } else {
              setEventsBlockedMsg('');
              setEvents(res.data.length > 0 ? res.data : BASELINE_CODE_EVENT_CATALOGUE);
            }
          })
          .catch((err: any) => {
            setGlobalLoadErrors((prev) => ({
              ...prev,
              events: err?.message || 'Failed to load notification events',
            }));
          }),
      );

      tasks.push(
        NotificationManagementApi.listTemplates({ includeHistory: true })
          .then((res) => {
            if (res.status === 'BLOCKED') {
              setTemplatesBlockedMsg(res.message);
              setTemplates(BASELINE_CODE_TEMPLATES);
            } else {
              setTemplatesBlockedMsg('');
              setTemplates(
                res.data.map((row) => ({ ...row, sourceOrigin: row.sourceOrigin ?? 'DATABASE' })),
              );
            }
          })
          .catch((err: any) => {
            setGlobalLoadErrors((prev) => ({
              ...prev,
              templates: err?.message || 'Failed to load notification templates',
            }));
          }),
      );
    }

    if (permissions.canViewProviderStatus) {
      tasks.push(
        NotificationManagementApi.getProviderStatus()
          .then((res) => {
            if (res.status === 'BLOCKED') {
              setProviderBlockedMsg(res.message);
              setProviderStatus(null);
            } else {
              setProviderBlockedMsg('');
              setProviderStatus(res.data);
            }
          })
          .catch((err: any) => {
            setGlobalLoadErrors((prev) => ({
              ...prev,
              providerStatus: err?.message || 'Failed to load provider status',
            }));
          }),
      );

      tasks.push(
        NotificationManagementApi.getSafeRuntimeConfig()
          .then(setRuntimeConfig)
          .catch(() => {
            // Non-fatal auxiliary metadata
          }),
      );
    }

    if (permissions.canViewDiagnostics) {
      tasks.push(
        NotificationManagementApi.getDiagnostics()
          .then(setDiagnostics)
          .catch((err: any) => {
            setGlobalLoadErrors((prev) => ({
              ...prev,
              diagnostics: err?.message || 'Diagnostics unavailable',
            }));
          }),
      );
    }

    if (permissions.canViewOutbox) {
      tasks.push(
        NotificationManagementApi.getOutboxEvents(25)
          .then(setOutboxRows)
          .catch((err: any) => {
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
            if (res.status === 'BLOCKED') {
              setChangeRequestsBlockedMsg(res.message);
              setChangeRequests([]);
            } else {
              setChangeRequestsBlockedMsg('');
              setChangeRequests(res.data);
            }
          })
          .catch((err: any) => {
            setGlobalLoadErrors((prev) => ({
              ...prev,
              changeRequests: err?.message || 'Failed to load notification change requests',
            }));
          }),
      );
    }

    if (permissions.canViewAudit) {
      tasks.push(
        NotificationManagementApi.listAuditEvents('NOTIFICATION_TEMPLATE', 10)
          .then(setAuditRows)
          .catch(() => {
            // Non-fatal audit lookup
          }),
      );
    }

    await Promise.all(tasks);
    setLoadingInitial(false);
  }, [permissions]);

  useEffect(() => {
    void fetchAllReadSurfaces();
  }, [fetchAllReadSurfaces]);

  useEffect(() => {
    if (permissions.canAccessModule && permissions.canViewDeliveries) {
      void fetchDeliveries();
    }
  }, [permissions.canAccessModule, permissions.canViewDeliveries, fetchDeliveries]);

  // Derived Overview Metrics
  const deliveryRows = deliveryPageData?.data ?? [];
  const deliverySummary = useMemo(() => {
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let pending = 0;
    let retried = 0;
    for (const row of deliveryRows) {
      if (row.status === 'SENT') sent += 1;
      else if (row.status === 'FAILED') failed += 1;
      else if (row.status === 'SKIPPED') skipped += 1;
      else if (row.status === 'PENDING') pending += 1;
      if (Number(row.attempts) > 1) retried += 1;
    }
    return {
      totalAllPages: deliveryPageData?.total ?? 0,
      sent,
      failed,
      skipped,
      pending,
      retried,
    };
  }, [deliveryRows, deliveryPageData?.total]);

  const eventStats = useMemo(() => {
    const security = events.filter((e) => e.deliveryClass === 'SECURITY').length;
    const transactional = events.filter((e) => e.deliveryClass === 'TRANSACTIONAL').length;
    const informational = events.filter((e) => e.deliveryClass === 'INFORMATIONAL').length;
    const eligibleToggle = events.filter((e) => !e.toggleLocked).length;
    const smsEnabledCount = events.filter((e) => e.smsEnabled).length;
    const emailEnabledCount = events.filter((e) => e.emailEnabled).length;
    return {
      total: events.length,
      security,
      transactional,
      informational,
      eligibleToggle,
      smsEnabledCount,
      emailEnabledCount,
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
      if (eventGovernanceFilter === 'ELIGIBLE' && item.toggleLocked) return false;
      if (eventGovernanceFilter === 'LOCKED' && !item.toggleLocked) return false;
      return true;
    });
  }, [events, eventSearch, eventClassFilter, eventGovernanceFilter]);

  const combinedChangeRequests = useMemo(() => {
    const seen = new Set(changeRequests.map((item) => item.id));
    const extras = sessionSubmittedChanges.filter((item) => !seen.has(item.id));
    return [...extras, ...changeRequests];
  }, [changeRequests, sessionSubmittedChanges]);

  const emailChannelBlocked = Boolean(
    providerBlockedMsg || !providerStatus?.email?.channelEnabledInSchema,
  );

  // Handlers — Event Trigger Configuration (Capability 2)
  const openTriggerConfigDrawer = (eventItem: NotificationEventCatalogueItem) => {
    setEditingTriggerEvent(eventItem);
    setDraftSmsEnabled(eventItem.smsEnabled);
    setDraftEmailEnabled(eventItem.emailEnabled);
    setTriggerReason('');
    setTriggerApprovalId('');
    setTriggerValidationErrors([]);
    setTriggerFeedback(null);
  };

  const handleSubmitTriggerConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissions.canManageConfiguration || !editingTriggerEvent) return;

    setTriggerValidationErrors([]);
    setTriggerFeedback(null);

    const errors = validateTriggerConfigurationChange({
      event: editingTriggerEvent,
      smsEnabled: draftSmsEnabled,
      emailEnabled: draftEmailEnabled,
      reason: triggerReason,
      approvalId: triggerApprovalId,
    });
    if (errors.length > 0) {
      setTriggerValidationErrors(errors);
      return;
    }

    setIsSavingTrigger(true);
    try {
      const result = await NotificationManagementApi.submitEventConfigurationChange(
        editingTriggerEvent.eventType,
        {
          smsEnabled: draftSmsEnabled,
          emailEnabled: draftEmailEnabled,
          reason: triggerReason.trim(),
          ...(triggerApprovalId.trim() ? { approvalIds: [triggerApprovalId.trim()] } : {}),
        },
      );

      if (result.status === 'BLOCKED') {
        setTriggerFeedback({ kind: 'blocked', message: result.message });
        return;
      }

      const approvalSuffix = result.data.approvalId
        ? ` Approval ID: ${result.data.approvalId}.`
        : '';
      setTriggerFeedback({
        kind: 'success',
        message:
          result.data.status === 'PENDING_APPROVAL'
            ? `Trigger configuration change submitted for maker-checker approval.${approvalSuffix}${
                result.data.message ? ` ${result.data.message}` : ''
              }`
            : (result.data.message ??
              `Trigger configuration updated (${result.data.status}).${approvalSuffix}`),
      });

      setSessionSubmittedChanges((prev) => [
        {
          id:
            result.data.changeRequestId ??
            result.data.approvalId ??
            `trigger-change-${Date.now()}`,
          approvalId: result.data.approvalId ?? null,
          changeType: 'EVENT_TRIGGER_CONFIG',
          eventType: editingTriggerEvent.eventType,
          channel: 'MULTI',
          summary: triggerReason.trim(),
          status: result.data.status === 'APPLIED' ? 'APPLIED' : 'PENDING_APPROVAL',
          requestedBy: result.data.requestedBy ?? currentPrincipalId,
          requestedAt: result.data.updatedAt ?? new Date().toISOString(),
          proposedSmsEnabled: draftSmsEnabled,
          proposedEmailEnabled: draftEmailEnabled,
        },
        ...prev,
      ]);

      if (result.data.status === 'APPLIED') {
        setEvents((prev) =>
          prev.map((row) =>
            row.eventType === editingTriggerEvent.eventType
              ? { ...row, smsEnabled: draftSmsEnabled, emailEnabled: draftEmailEnabled }
              : row,
          ),
        );
      }
      setTriggerReason('');
      setTriggerApprovalId('');
    } catch (err: any) {
      setTriggerFeedback({
        kind: 'error',
        message:
          err?.status === 403
            ? `Access denied (403): ${err.message || 'Not authorized to modify notification trigger configuration.'}`
            : err?.message || 'Failed to submit trigger configuration change.',
      });
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
    if (!canDecide || !permissions.hasMfaAssurance) return;

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

    setDecidingChangeId(record.id);
    setCheckerFeedback(null);
    try {
      const res = await NotificationManagementApi.decideNotificationChangeRequest(
        record.id,
        decision,
        queueDecisionComment.trim(),
      );
      if (res.status === 'BLOCKED') {
        setCheckerFeedback({ kind: 'blocked', message: res.message });
      } else {
        setCheckerFeedback({
          kind: 'success',
          message: `Change request ${record.id} ${decision === 'approve' ? 'approved' : 'rejected'} (${res.data.status}).`,
        });
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

    setIsSubmittingChecker(true);
    setCheckerFeedback(null);
    try {
      await NotificationManagementApi.decideWorkforceApproval(
        checkerApprovalId.trim(),
        decision,
        checkerComment,
      );
      setCheckerFeedback({
        kind: 'success',
        message:
          decision === 'approve'
            ? `Workforce approval ${checkerApprovalId.trim()} signed and approved.`
            : `Workforce approval ${checkerApprovalId.trim()} rejected.`,
      });
      setCheckerApprovalId('');
      setCheckerComment('');
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
    setDeliveryError('');
    if (filterRecipientId.trim() && !isUuidString(filterRecipientId)) {
      setDeliveryError('Recipient ID filter must be a valid UUID.');
      return;
    }
    if (filterEventType.trim().length > 180) {
      setDeliveryError('Event type filter must be at most 180 characters.');
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
        await fetchDeliveries();
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

  // Handlers — Controlled Test-Send (Capability 11)
  const handleTestSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissions.canTestSend) return;

    setTestValidationErrors([]);
    setTestError('');
    setTestBlockedMsg('');
    setTestOutcome(null);

    const { errors, normalizedDestination } = validateTestSendRequest({
      channel: testChannel,
      eventType: testEventType,
      destination: testDestination,
      reason: testReason,
      workforceDestinationConfirmed: testWorkforceConfirmed,
      approvalId: testApprovalId,
    });

    if (errors.length > 0 || !normalizedDestination) {
      setTestValidationErrors(errors);
      return;
    }

    setIsSendingTest(true);
    try {
      const res = await NotificationManagementApi.submitTestSend({
        channel: testChannel,
        eventType: testEventType,
        destination: normalizedDestination,
        reason: testReason.trim(),
        workforceDestinationConfirmed: true,
        ...(testApprovalId.trim() ? { approvalId: testApprovalId.trim() } : {}),
      });

      if (res.status === 'BLOCKED') {
        setTestBlockedMsg(res.message);
        return;
      }

      setTestOutcome(res.data);
      setTestReason('');
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
        setTestError(err?.message || 'Controlled test-send request failed.');
      }
    } finally {
      setIsSendingTest(false);
    }
  };

  // Capability 12: Top-level fail-closed guard when principal holds zero notification.* scopes
  if (!principal || !permissions.canAccessModule) {
    return (
      <div style={styles.container} role="alert" data-testid="notification-module-access-denied">
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
    <div style={styles.container} data-testid="notification-management-screen">
      {/* Header */}
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>🔔 SMS & Email Notification Management</h2>
          <p style={styles.subtitle}>
            Governed event triggers, versioned SMS & Email templates, safe variable browser,
            non-secret provider status, delivery diagnostics, and dual-control test sends.
          </p>
        </div>
        <button
          type="button"
          data-testid="refresh-notifications-console-btn"
          style={styles.secondaryBtn}
          disabled={loadingInitial}
          onClick={() => {
            void fetchAllReadSurfaces();
            if (permissions.canViewDeliveries) void fetchDeliveries();
          }}
        >
          {loadingInitial ? 'Refreshing…' : 'Refresh Console'}
        </button>
      </div>

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
      <div style={styles.tabBar} role="tablist" aria-label="Notification management sections">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            role="tab"
            data-testid={`notif-tab-${tabItem.key}`}
            aria-selected={activeTab === tabItem.key}
            style={activeTab === tabItem.key ? styles.activeTabBtn : styles.tabBtn}
            onClick={() => setActiveTab(tabItem.key)}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW (Capability 1) */}
      {activeTab === 'overview' && (
        <div style={styles.sectionStack} data-testid="notif-panel-overview">
          {/* Channel Status Cards */}
          <div style={styles.cardGrid3}>
            <section style={styles.card} aria-label="SMS channel status">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>📱 SMS Channel</h3>
                <span style={styles.liveBadge}>
                  {providerStatus?.sms?.operationalStatus ?? 'PIPELINE ACTIVE'}
                </span>
              </div>
              <p style={styles.cardDesc}>
                Outbox-driven transactional SMS via <code>NotificationDispatcherService</code> &{' '}
                <code>NotificationWorkerService</code> (Robase / Console provider seam).
              </p>
              <div style={styles.kvList}>
                <div>
                  <strong>Enabled Events:</strong> {eventStats.smsEnabledCount} / {eventStats.total}
                </div>
                <div>
                  <strong>Direct-Send OTP Flows:</strong> {eventStats.security} mandatory (never persisted)
                </div>
                <div>
                  <strong>Agent SMS Note:</strong> Agent leg skipped until authoritative Agent phone model (D-N6)
                </div>
              </div>
            </section>

            <section style={styles.card} aria-label="Email channel status">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>📧 Email Channel</h3>
                {emailChannelBlocked ? (
                  <span style={styles.blockedBadge} data-testid="overview-email-blocked-badge">
                    BLOCKED (ARENA 3)
                  </span>
                ) : (
                  <span style={styles.liveBadge}>
                    {providerStatus?.email?.operationalStatus ?? 'READY'}
                  </span>
                )}
              </div>
              <p style={styles.cardDesc}>
                Transactional Email with subject + body templates and verified{' '}
                <code>customer_contact_methods</code> EMAIL resolution.
              </p>
              <div style={styles.kvList}>
                <div>
                  <strong>Enabled Events:</strong> {eventStats.emailEnabledCount} / {eventStats.total}
                </div>
                <div>
                  <strong>Customer Preference Column:</strong> <code>notification_email_enabled</code>
                </div>
                <div>
                  <strong>Runtime Status:</strong>{' '}
                  {emailChannelBlocked
                    ? 'Pending ARENA 3 schema & provider adapter integration'
                    : `Provider: ${providerStatus?.email?.provider || 'Configured'}`}
                </div>
              </div>
            </section>

            <section style={styles.card} aria-label="Event catalogue and outbox health">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>⚡ Event & Outbox Health</h3>
                <span style={eventsBlockedMsg ? styles.blockedBadge : styles.liveBadge}>
                  {eventsBlockedMsg ? 'CODE BASELINE' : 'DB REGISTRY LIVE'}
                </span>
              </div>
              <div style={styles.kvList}>
                <div>
                  <strong>Catalogue Events:</strong> {eventStats.total} ({eventStats.security}{' '}
                  Security · {eventStats.transactional} Transactional · {eventStats.informational}{' '}
                  Informational)
                </div>
                <div>
                  <strong>Eligible Editable Triggers:</strong> {eventStats.eligibleToggle} events
                </div>
                <div>
                  <strong>Pending Shared Outbox:</strong>{' '}
                  {diagnostics?.pendingOutbox !== undefined
                    ? diagnostics.pendingOutbox
                    : permissions.canViewOutbox
                      ? outboxRows.filter((r) => r.status === 'PENDING' || r.status === 'FAILED').length
                      : 'Requires diagnostics.view / outbox.view'}
                </div>
                <div>
                  <strong>Total Recorded Deliveries:</strong>{' '}
                  {permissions.canViewDeliveries
                    ? deliverySummary.totalAllPages
                    : 'Requires notification.view_deliveries'}
                </div>
              </div>
            </section>
          </div>

          {/* Backend Coordination & Readiness Matrix */}
          <section
            style={styles.card}
            aria-label="Backend integration readiness matrix"
            data-testid="backend-readiness-matrix"
          >
            <h3 style={styles.cardTitle}>🔗 Backend API Integration & Dependency Status</h3>
            <p style={styles.cardDesc}>
              Truthful live integration status across existing MonieNaija services, ARENA 1
              (templates & event catalogue), and ARENA 3 (email runtime, provider status & test-send).
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Capability / Surface</th>
                    <th style={styles.th}>Endpoint Boundary</th>
                    <th style={styles.th}>Owner</th>
                    <th style={styles.th}>Runtime State</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={styles.td}>SMS Delivery Diagnostics & Retry Telemetry</td>
                    <td style={styles.td}>
                      <code>GET /internal/notifications/deliveries</code>
                    </td>
                    <td style={styles.td}>Baseline Core</td>
                    <td style={styles.td}>
                      <span style={styles.liveBadge}>LIVE</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Shared Outbox, Diagnostics & Safe Runtime Config</td>
                    <td style={styles.td}>
                      <code>GET /internal/outbox</code> · <code>/internal/diagnostics</code> ·{' '}
                      <code>/internal/configuration</code>
                    </td>
                    <td style={styles.td}>Baseline Core</td>
                    <td style={styles.td}>
                      <span style={styles.liveBadge}>LIVE</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Workforce Maker-Checker Approval Decisions</td>
                    <td style={styles.td}>
                      <code>POST /internal/a2/workforce/approvals/:id/approve|reject</code>
                    </td>
                    <td style={styles.td}>Baseline Core</td>
                    <td style={styles.td}>
                      <span style={styles.liveBadge}>LIVE</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>DB Event Catalogue & Eligible Trigger Toggles</td>
                    <td style={styles.td}>
                      <code>GET /internal/notifications/events</code> ·{' '}
                      <code>PATCH .../configuration</code>
                    </td>
                    <td style={styles.td}>ARENA 1</td>
                    <td style={styles.td}>
                      {eventsBlockedMsg ? (
                        <span style={styles.blockedBadge}>BLOCKED</span>
                      ) : (
                        <span style={styles.liveBadge}>LIVE</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>SMS & Email Template Registry, Versioning & Server Preview</td>
                    <td style={styles.td}>
                      <code>GET/POST /internal/notifications/templates</code> ·{' '}
                      <code>POST .../preview</code>
                    </td>
                    <td style={styles.td}>ARENA 1</td>
                    <td style={styles.td}>
                      {templatesBlockedMsg ? (
                        <span style={styles.blockedBadge}>BLOCKED</span>
                      ) : (
                        <span style={styles.liveBadge}>LIVE</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Non-Secret SMS & Email Provider Readiness Status</td>
                    <td style={styles.td}>
                      <code>GET /internal/notifications/provider-status</code>
                    </td>
                    <td style={styles.td}>ARENA 3</td>
                    <td style={styles.td}>
                      {providerBlockedMsg ? (
                        <span style={styles.blockedBadge}>BLOCKED</span>
                      ) : (
                        <span style={styles.liveBadge}>LIVE</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Notification Change-Request Queue & Controlled Test-Send</td>
                    <td style={styles.td}>
                      <code>GET /internal/notifications/change-requests</code> ·{' '}
                      <code>POST /internal/notifications/test-send</code>
                    </td>
                    <td style={styles.td}>ARENA 3</td>
                    <td style={styles.td}>
                      {changeRequestsBlockedMsg ? (
                        <span style={styles.blockedBadge}>BLOCKED</span>
                      ) : (
                        <span style={styles.liveBadge}>LIVE</span>
                      )}
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

          {!permissions.canManageConfiguration && (
            <div style={styles.infoBanner} data-testid="events-readonly-scope-notice">
              Read-only catalogue view: Grant <code>notification.manage_configuration</code> to
              propose trigger state changes on eligible events. Mandatory <code>SECURITY</code> and{' '}
              <code>toggleLocked</code> events remain permanently non-toggleable for all roles.
            </div>
          )}

          {/* Filter Bar */}
          <div style={styles.card}>
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
          </div>

          {/* Eligible Trigger Configuration Form Drawer */}
          {editingTriggerEvent && (
            <section
              style={styles.drawerCard}
              aria-label="Configure event triggers"
              data-testid="event-trigger-config-panel"
            >
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>
                  ⚙️ Configure Eligible Triggers — <code>{editingTriggerEvent.eventType}</code>
                </h3>
                <button
                  type="button"
                  style={styles.secondarySmallBtn}
                  onClick={() => setEditingTriggerEvent(null)}
                >
                  Close
                </button>
              </div>
              <p style={styles.cardDesc}>{editingTriggerEvent.description}</p>

              <form onSubmit={handleSubmitTriggerConfig} noValidate>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14 }}>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      aria-label="Enable SMS trigger"
                      data-testid="toggle-sms-enabled-checkbox"
                      checked={draftSmsEnabled}
                      onChange={(e) => setDraftSmsEnabled(e.target.checked)}
                      disabled={!permissions.canManageConfiguration || isSavingTrigger}
                    />
                    <span>
                      <strong>SMS Trigger Enabled</strong> (currently{' '}
                      {editingTriggerEvent.smsEnabled ? 'ON' : 'OFF'})
                    </span>
                  </label>

                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      aria-label="Enable Email trigger"
                      data-testid="toggle-email-enabled-checkbox"
                      checked={draftEmailEnabled}
                      onChange={(e) => setDraftEmailEnabled(e.target.checked)}
                      disabled={!permissions.canManageConfiguration || isSavingTrigger}
                    />
                    <span>
                      <strong>Email Trigger Enabled</strong> (currently{' '}
                      {editingTriggerEvent.emailEnabled ? 'ON' : 'OFF'})
                    </span>
                  </label>
                </div>

                <div style={styles.filterGrid}>
                  <div>
                    <label htmlFor="trigger-audit-reason" style={styles.label}>
                      Operational Audit Reason <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <input
                      id="trigger-audit-reason"
                      aria-label="Operational audit reason"
                      data-testid="trigger-reason-input"
                      type="text"
                      style={styles.input}
                      placeholder="Explain why this trigger configuration is changing (min 10 chars)…"
                      value={triggerReason}
                      onChange={(e) => setTriggerReason(e.target.value)}
                      disabled={!permissions.canManageConfiguration || isSavingTrigger}
                    />
                  </div>
                  <div>
                    <label htmlFor="trigger-approval-id" style={styles.label}>
                      Pre-Approved Checker Approval ID (Optional UUID)
                    </label>
                    <input
                      id="trigger-approval-id"
                      aria-label="Checker approval ID"
                      type="text"
                      style={styles.input}
                      placeholder="Optional UUID when executing an approved change…"
                      value={triggerApprovalId}
                      onChange={(e) => setTriggerApprovalId(e.target.value)}
                      disabled={!permissions.canManageConfiguration || isSavingTrigger}
                    />
                  </div>
                </div>

                {triggerValidationErrors.length > 0 && (
                  <div
                    style={styles.errorAlert}
                    role="alert"
                    data-testid="trigger-validation-errors"
                  >
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {triggerValidationErrors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {triggerFeedback && (
                  <div
                    style={
                      triggerFeedback.kind === 'success'
                        ? styles.successAlert
                        : triggerFeedback.kind === 'blocked'
                          ? styles.blockedBanner
                          : styles.errorAlert
                    }
                    role={triggerFeedback.kind === 'error' ? 'alert' : 'status'}
                    data-testid={`trigger-submit-${triggerFeedback.kind}`}
                  >
                    {triggerFeedback.message}
                  </div>
                )}

                <button
                  type="submit"
                  data-testid="submit-trigger-config-btn"
                  disabled={!permissions.canManageConfiguration || isSavingTrigger}
                  style={
                    !permissions.canManageConfiguration || isSavingTrigger
                      ? styles.primaryBtnDisabled
                      : styles.primaryBtn
                  }
                >
                  {isSavingTrigger
                    ? 'Submitting…'
                    : eventsBlockedMsg
                      ? 'Validate & Submit Trigger Change (Backend BLOCKED)'
                      : 'Submit Trigger Change for Approval'}
                </button>
              </form>
            </section>
          )}

          {/* Event Catalogue Table */}
          <div style={styles.card}>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table} data-testid="notification-events-table">
                <thead>
                  <tr>
                    <th style={styles.th}>Event Type</th>
                    <th style={styles.th}>Class</th>
                    <th style={styles.th}>Recipient</th>
                    <th style={styles.th}>Runtime Wiring</th>
                    <th style={styles.th}>SMS</th>
                    <th style={styles.th}>Email</th>
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

                    return (
                      <tr key={row.eventType} data-testid={`event-row-${row.eventType}`}>
                        <td style={styles.td}>
                          <div>
                            <code>{row.eventType}</code>
                          </div>
                          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
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
                        <td style={styles.td}>
                          <span style={row.smsEnabled ? styles.liveBadge : styles.mutedBadge}>
                            {row.smsEnabled ? 'ENABLED' : 'DISABLED'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={row.emailEnabled ? styles.liveBadge : styles.mutedBadge}>
                            {row.emailEnabled ? 'ENABLED' : 'DISABLED'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {isLocked ? (
                            <span title={row.lockReason ?? undefined} style={styles.lockedChip}>
                              🔒 LOCKED
                            </span>
                          ) : (
                            <span style={styles.eligibleChip}>✓ ELIGIBLE</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              data-testid={`configure-trigger-${row.eventType}`}
                              disabled={isLocked || !permissions.canManageConfiguration}
                              title={
                                isLocked
                                  ? row.lockReason ?? 'Trigger is locked by policy'
                                  : !permissions.canManageConfiguration
                                    ? 'Requires notification.manage_configuration'
                                    : undefined
                              }
                              style={
                                isLocked || !permissions.canManageConfiguration
                                  ? styles.disabledSmallBtn
                                  : styles.secondarySmallBtn
                              }
                              onClick={() => openTriggerConfigDrawer(row)}
                            >
                              {isLocked ? 'Locked' : 'Configure Triggers'}
                            </button>
                            {row.templateEditable && (
                              <>
                                <button
                                  type="button"
                                  style={styles.secondarySmallBtn}
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
          </div>
        </div>
      )}

      {/* TAB 3: SMS TEMPLATES (Capabilities 3, 5, 6, 7) */}
      {activeTab === 'smsTemplates' && (
        <NotificationTemplateWorkspace
          channel="SMS"
          events={events}
          templates={templates}
          templatesRegistryBlocked={Boolean(templatesBlockedMsg)}
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
          templatesRegistryBlocked={Boolean(templatesBlockedMsg)}
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
                {permissions.canManageConfiguration ? 'Granted' : 'Not granted'})
              </div>
              <div>
                <strong>Checker Capabilities:</strong> Approve Templates (
                {permissions.canApproveTemplates ? 'Granted' : 'Not granted'}) · Approve Triggers (
                {permissions.canApproveConfiguration ? 'Granted' : 'Not granted'}) · Separation of
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
              <div style={{ overflowX: 'auto' }}>
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
                      const hasCheckerScope =
                        reqRow.changeType === 'EVENT_TRIGGER_CONFIG'
                          ? permissions.canApproveConfiguration
                          : permissions.canApproveTemplates;
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
                            ) : (
                              <span style={{ fontSize: 12, color: '#64748B' }}>—</span>
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

          {/* LIVE Generic Workforce Approval Decision Form */}
          <section
            style={styles.card}
            aria-label="Direct workforce approval decision"
            data-testid="live-workforce-approval-section"
          >
            <div style={styles.cardTitleRow}>
              <h3 style={styles.cardTitle}>
                ✅ Direct Workforce Approval Decision (<code>/internal/a2/workforce/approvals/:id</code>)
              </h3>
              <span style={styles.liveBadge}>LIVE ENDPOINT</span>
            </div>
            <p style={styles.cardDesc}>
              Authorized <code>FINANCE_CONTROLLER</code> checkers with <code>privileged:approve</code>{' '}
              and <code>MFA</code> assurance can approve or reject governed Approval IDs directly.
            </p>
            <div style={styles.filterGrid}>
              <div>
                <label htmlFor="direct-approval-id" style={styles.label}>
                  Pending Approval ID (UUID)
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
                    isSubmittingChecker
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
                    isSubmittingChecker
                  }
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button
                type="button"
                data-testid="direct-workforce-approve-btn"
                disabled={
                  !permissions.canUseWorkforceApprovalEndpoint ||
                  !permissions.hasMfaAssurance ||
                  isSubmittingChecker
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
                data-testid="direct-workforce-reject-btn"
                disabled={
                  !permissions.canUseWorkforceApprovalEndpoint ||
                  !permissions.hasMfaAssurance ||
                  isSubmittingChecker
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

          {/* Governance Audit Trail */}
          {permissions.canViewAudit && (
            <section style={styles.card} aria-label="Notification governance audit records">
              <h3 style={styles.cardTitle}>📜 Recent Notification Template Audit Events</h3>
              {auditRows.length === 0 ? (
                <div style={styles.emptyBox}>
                  No <code>NOTIFICATION_TEMPLATE</code> audit events recorded yet.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Action</th>
                        <th style={styles.th}>Entity ID</th>
                        <th style={styles.th}>Actor</th>
                        <th style={styles.th}>Occurred At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditRows.map((row, idx) => (
                        <tr key={String(row.id ?? idx)}>
                          <td style={styles.td}>{String(row.action ?? '—')}</td>
                          <td style={styles.td}>
                            <code>{String(row.entityId ?? '—')}</code>
                          </td>
                          <td style={styles.td}>
                            <code>{String(row.actorId ?? '—')}</code>
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
            <strong>🔐 Secret-Free Provider Governance (Audit Finding F-S5):</strong> Provider
            credentials (<code>ROBASE_API_KEY</code>, SMTP secrets, bearer keys) are managed strictly
            via validated environment configuration and are NEVER transmitted, accepted, or rendered
            in Admin Web. Only boolean readiness flags and masked 4-character fingerprints are shown.
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

            {/* Worker & Live Runtime Config Card */}
            <section style={styles.card} aria-label="Worker and retry runtime posture">
              <div style={styles.cardTitleRow}>
                <h3 style={styles.cardTitle}>⚙️ Worker & Retry Policy</h3>
                <span style={styles.liveBadge}>RUNTIME READ-ONLY</span>
              </div>
              <div style={styles.kvList}>
                <div>
                  <strong>Environment:</strong>{' '}
                  <code>{providerStatus?.environment ?? runtimeConfig?.environment ?? 'unknown'}</code>
                </div>
                <div>
                  <strong>App / API Version:</strong>{' '}
                  <code>
                    {runtimeConfig?.version ?? diagnostics?.version ?? '0.1.0'} (
                    {runtimeConfig?.apiVersion ?? 'v1'})
                  </code>
                </div>
                <div>
                  <strong>Worker Poller Enabled:</strong>{' '}
                  {providerStatus
                    ? providerStatus.worker.enabled
                      ? 'ENABLED'
                      : 'DISABLED (NOTIFICATION_WORKER_ENABLED=false)'
                    : 'Pending provider-status (default false)'}
                </div>
                <div>
                  <strong>SMS Retry Policy:</strong>{' '}
                  {providerStatus
                    ? `Max ${providerStatus.worker.smsRetryMaxAttempts} attempts · Base ${providerStatus.worker.smsRetryBaseDelaySeconds}s exponential backoff`
                    : 'Bounded exponential backoff (FOR UPDATE SKIP LOCKED)'}
                </div>
                <div>
                  <strong>Outbox Retry Delay:</strong>{' '}
                  {runtimeConfig?.outboxRetryDelaySeconds !== undefined
                    ? `${runtimeConfig.outboxRetryDelaySeconds}s`
                    : '60s'}
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
          {!permissions.canViewDeliveries ? (
            <div style={styles.deniedBox} role="alert" data-testid="deliveries-scope-denied">
              Viewing notification delivery history requires{' '}
              <code>notification.view_deliveries</code>.
            </div>
          ) : (
            <>
              {/* Summary Strip */}
              <div style={styles.kpiRow}>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>Total Matching Records</div>
                  <div style={styles.kpiValue}>{deliverySummary.totalAllPages}</div>
                </div>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>Page SENT (Accepted)</div>
                  <div style={{ ...styles.kpiValue, color: '#166534' }}>{deliverySummary.sent}</div>
                </div>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>Page FAILED</div>
                  <div style={{ ...styles.kpiValue, color: '#DC2626' }}>
                    {deliverySummary.failed}
                  </div>
                </div>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>Page SKIPPED</div>
                  <div style={{ ...styles.kpiValue, color: '#64748B' }}>
                    {deliverySummary.skipped}
                  </div>
                </div>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>Retried (Attempts &gt; 1)</div>
                  <div style={{ ...styles.kpiValue, color: '#D97706' }}>
                    {deliverySummary.retried}
                  </div>
                </div>
              </div>

              {/* Filter Form */}
              <form
                onSubmit={handleApplyDeliveryFilters}
                style={styles.card}
                aria-label="Filter notification deliveries"
              >
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
                      <option value="SENT">SENT</option>
                      <option value="FAILED">FAILED</option>
                      <option value="PENDING">PENDING</option>
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
                <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
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
                      setDeliveryError('');
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
                  <select
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

              {deliveryError && (
                <div style={styles.errorAlert} role="alert" data-testid="delivery-filter-error">
                  {deliveryError}
                </div>
              )}

              {/* Delivery Inspector Drawer */}
              {selectedDelivery && (
                <section
                  style={styles.drawerCard}
                  aria-label="Delivery diagnostic inspector"
                  data-testid="delivery-inspector-panel"
                >
                  <div style={styles.cardTitleRow}>
                    <h3 style={styles.cardTitle}>
                      🔎 Delivery & Retry Diagnostics — <code>{selectedDelivery.id}</code>
                    </h3>
                    <button
                      type="button"
                      style={styles.secondarySmallBtn}
                      onClick={() => {
                        setSelectedDelivery(null);
                        setManualRetryFeedback(null);
                      }}
                    >
                      Close Inspector
                    </button>
                  </div>
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
                    {selectedDelivery.lastError && (
                      <div style={{ color: '#991B1B' }}>
                        <strong>Last Error / Skip Reason:</strong>{' '}
                        <code>{selectedDelivery.lastError}</code>
                      </div>
                    )}
                    <div>
                      <strong>Rendered Safe Message:</strong>{' '}
                      <span>{selectedDelivery.message || '(empty)'}</span>
                    </div>
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
              <div style={styles.card}>
                {deliveryLoading ? (
                  <div style={styles.emptyBox}>Loading notification deliveries…</div>
                ) : deliveryRows.length === 0 ? (
                  <div style={styles.emptyBox}>
                    No notification delivery records matched the selected filters.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={styles.table} data-testid="notification-deliveries-table">
                      <thead>
                        <tr>
                          <th style={styles.th}>Event</th>
                          <th style={styles.th}>Channel</th>
                          <th style={styles.th}>Recipient</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Attempts</th>
                          <th style={styles.th}>Provider Ref</th>
                          <th style={styles.th}>Last Error / Skip</th>
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
                                    : row.status === 'FAILED'
                                      ? styles.securityChip
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
                              <code>{row.lastError || '—'}</code>
                            </td>
                            <td style={styles.td}>
                              {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                            </td>
                            <td style={styles.td}>
                              <button
                                type="button"
                                data-testid={`inspect-delivery-${row.id}`}
                                style={styles.secondarySmallBtn}
                                onClick={() => {
                                  setSelectedDelivery(row);
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
                <div style={styles.pagerRow} data-testid="notification-deliveries-pager">
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
                  <span style={{ fontSize: 13, color: '#475569' }}>
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
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 8: CONTROLLED TEST-SEND (Capability 11) */}
      {activeTab === 'testSend' && (
        <div style={styles.sectionStack} data-testid="notif-panel-test-send">
          {!permissions.canTestSend && (
            <div
              style={styles.infoBanner}
              role="status"
              data-testid="test-send-scope-restricted-banner"
            >
              <strong>Permission Required:</strong> Controlled test-send requires the{' '}
              <code>notification.test_send</code> authorization function and dual-control governance.
              Submission controls are disabled for the current principal.
            </div>
          )}

          <section style={styles.card} aria-label="Controlled test notification form">
            <h3 style={styles.cardTitle}>🧪 Controlled Test-Send Interface (Dual Control)</h3>
            <p style={styles.cardDesc}>
              Validates live provider configuration using the active template version rendered with
              safe sample variables. Destinations are restricted strictly to verified workforce-owned
              phone numbers or email addresses — never customer contact details.
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
                  <label htmlFor="test-send-event" style={styles.label}>
                    Active Event Template <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <select
                    id="test-send-event"
                    aria-label="Test send event"
                    data-testid="test-send-event-select"
                    style={styles.select}
                    value={testEventType}
                    onChange={(e) => setTestEventType(e.target.value)}
                    disabled={!permissions.canTestSend || isSendingTest}
                  >
                    {events
                      .filter((item) => item.templateEditable)
                      .map((item) => (
                        <option key={item.eventType} value={item.eventType}>
                          {item.eventType}
                        </option>
                      ))}
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

                <div>
                  <label htmlFor="test-send-approval-id" style={styles.label}>
                    Dual-Control Approval ID (Optional UUID)
                  </label>
                  <input
                    id="test-send-approval-id"
                    aria-label="Test send approval ID"
                    data-testid="test-send-approval-id-input"
                    type="text"
                    style={styles.input}
                    placeholder="Provide pre-approved UUID or omit to initiate approval…"
                    value={testApprovalId}
                    onChange={(e) => setTestApprovalId(e.target.value)}
                    disabled={!permissions.canTestSend || isSendingTest}
                  />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label htmlFor="test-send-reason" style={styles.label}>
                  Operational Verification Reason <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  id="test-send-reason"
                  aria-label="Test send reason"
                  data-testid="test-send-reason-input"
                  type="text"
                  style={styles.input}
                  placeholder="Describe provider verification purpose (10..300 chars)…"
                  value={testReason}
                  onChange={(e) => setTestReason(e.target.value)}
                  disabled={!permissions.canTestSend || isSendingTest}
                />
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
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, maxWidth: 1280, margin: '0 auto' },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700, color: '#0F172A' },
  subtitle: { margin: '4px 0 0 0', fontSize: 13, color: '#64748B', maxWidth: 820 },
  tabBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
    borderBottom: '1px solid #E2E8F0',
    paddingBottom: 12,
  },
  tabBtn: {
    background: '#FFFFFF',
    color: '#334155',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
    padding: '8px 13px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  activeTabBtn: {
    background: '#0F172A',
    color: '#FFFFFF',
    border: '1px solid #0F172A',
    borderRadius: 8,
    padding: '8px 13px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  sectionStack: { display: 'flex', flexDirection: 'column', gap: 16 },
  cardGrid3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 16,
  },
  card: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: 18,
  },
  drawerCard: {
    background: '#F8FAFC',
    border: '2px solid #0F172A',
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
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A' },
  cardDesc: { margin: '0 0 12px 0', fontSize: 13, color: '#475569', lineHeight: 1.45 },
  kvList: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: '#1E293B' },
  liveBadge: {
    background: '#DCFCE7',
    color: '#166534',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  blockedBadge: {
    background: '#FEF3C7',
    color: '#92400E',
    border: '1px solid #F59E0B',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  mutedBadge: {
    background: '#F1F5F9',
    color: '#475569',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  },
  securityChip: {
    background: '#FEE2E2',
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
    background: '#F1F5F9',
    color: '#334155',
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
    border: '1px solid #F59E0B',
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 12,
  },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 },
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
    color: '#1E293B',
    cursor: 'pointer',
  },
  primaryBtn: {
    background: '#0F172A',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    padding: '9px 15px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  primaryBtnDisabled: {
    background: '#94A3B8',
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
    color: '#0F172A',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondarySmallBtn: {
    background: '#FFFFFF',
    color: '#0F172A',
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
    background: '#F1F5F9',
    color: '#94A3B8',
    border: '1px solid #E2E8F0',
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
    borderBottom: '2px solid #E2E8F0',
    color: '#475569',
    fontSize: 12,
    fontWeight: 700,
  },
  td: {
    padding: '9px 10px',
    borderBottom: '1px solid #E2E8F0',
    verticalAlign: 'top',
  },
  emptyBox: {
    padding: 14,
    background: '#F8FAFC',
    border: '1px dashed #CBD5E1',
    borderRadius: 8,
    fontSize: 13,
    color: '#64748B',
  },
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 12,
  },
  kpiCard: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: '12px 16px',
  },
  kpiLabel: { fontSize: 12, color: '#64748B', fontWeight: 600 },
  kpiValue: { fontSize: 22, fontWeight: 700, color: '#0F172A', marginTop: 4 },
  pagerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTop: '1px solid #E2E8F0',
  },
};
