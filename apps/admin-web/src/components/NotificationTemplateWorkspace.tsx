import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApprovedTemplateVariable,
  EMAIL_BODY_MAX_LENGTH,
  EMAIL_SUBJECT_MAX_LENGTH,
  estimateSmsSegments,
  extractTemplateVariables,
  ManagedNotificationChannel,
  NotificationChangeRequestRecord,
  NotificationEventCatalogueItem,
  NotificationPermissions,
  NotificationTemplateVersion,
  renderSafeTemplatePreview,
  SafePreviewResult,
  SECURITY_LOCKED_EVENT_TYPES,
  SMS_BODY_MAX_LENGTH,
  validateTemplateDraft,
} from '../services/notification-domain';
import {
  NotificationManagementApi,
  NotificationMutationOutcome,
} from '../services/notification-management-api';

interface NotificationTemplateWorkspaceProps {
  channel: ManagedNotificationChannel;
  events: NotificationEventCatalogueItem[];
  templates: NotificationTemplateVersion[];
  templatesRegistryBlocked: boolean;
  emailChannelBlocked: boolean;
  permissions: NotificationPermissions;
  currentPrincipalId: string;
  initialEventType?: string;
  onTemplateSubmitted?: (
    outcome: NotificationMutationOutcome,
    changeRecord: NotificationChangeRequestRecord,
  ) => void;
  onRefreshRequested?: () => Promise<void> | void;
}

export const NotificationTemplateWorkspace: React.FC<NotificationTemplateWorkspaceProps> = ({
  channel,
  events,
  templates,
  templatesRegistryBlocked,
  emailChannelBlocked,
  permissions,
  currentPrincipalId,
  initialEventType,
  onTemplateSubmitted,
  onRefreshRequested,
}) => {
  const defaultEventType = useMemo(() => {
    if (initialEventType && events.some((item) => item.eventType === initialEventType)) {
      return initialEventType;
    }
    const firstEditable = events.find((item) => item.templateEditable);
    return firstEditable?.eventType ?? events[0]?.eventType ?? 'customer.funding.approved';
  }, [events, initialEventType]);

  const [selectedEventType, setSelectedEventType] = useState<string>(defaultEventType);
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [changeSummary, setChangeSummary] = useState<string>('');
  const [sampleOverrides, setSampleOverrides] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string>('');
  const [submitBlockedMessage, setSubmitBlockedMessage] = useState<string>('');
  const [submitSuccessMessage, setSubmitSuccessMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [serverPreview, setServerPreview] = useState<SafePreviewResult | null>(null);
  const [previewBlockedMessage, setPreviewBlockedMessage] = useState<string>('');
  const [previewError, setPreviewError] = useState<string>('');
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  const [comparedVersion, setComparedVersion] = useState<NotificationTemplateVersion | null>(null);
  const [activatingTemplateId, setActivatingTemplateId] = useState<string | null>(null);
  const [activationComment, setActivationComment] = useState<string>('');
  const [activationFeedback, setActivationFeedback] = useState<{
    kind: 'success' | 'blocked' | 'error';
    message: string;
  } | null>(null);

  const subjectInputRef = useRef<HTMLInputElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedEvent = useMemo(
    () => events.find((item) => item.eventType === selectedEventType) ?? null,
    [events, selectedEventType],
  );

  const matchingVersions = useMemo(
    () =>
      templates
        .filter((item) => item.eventType === selectedEventType && item.channel === channel)
        .sort((a, b) => b.version - a.version),
    [templates, selectedEventType, channel],
  );

  const activeVersion = useMemo(
    () => matchingVersions.find((item) => item.isActive) ?? matchingVersions[0] ?? null,
    [matchingVersions],
  );

  // Sync editor content whenever the operator switches event or channel.
  useEffect(() => {
    setValidationErrors([]);
    setSubmitError('');
    setSubmitBlockedMessage('');
    setSubmitSuccessMessage('');
    setServerPreview(null);
    setPreviewBlockedMessage('');
    setPreviewError('');
    setComparedVersion(null);
    setActivationFeedback(null);
    setSampleOverrides({});

    if (activeVersion) {
      setSubject(channel === 'EMAIL' ? activeVersion.subject ?? '' : '');
      setBody(activeVersion.body);
      setChangeSummary('');
    } else if (selectedEvent && selectedEvent.templateEditable) {
      if (channel === 'EMAIL') {
        const defaultSubject = `MonieNaija Notification — ${selectedEvent.eventType}`;
        const firstVars = selectedEvent.approvedVariables.map((v) => `{{${v.name}}}`).join(' · ');
        setSubject(defaultSubject);
        setBody(
          firstVars
            ? `Hello,\n\nEvent update for ${selectedEvent.description}\nDetails: ${firstVars}\n\nThank you,\nMonieNaija`
            : `Hello,\n\n${selectedEvent.description}\n\nThank you,\nMonieNaija`,
        );
      } else {
        setSubject('');
        setBody('');
      }
      setChangeSummary('');
    } else {
      setSubject('');
      setBody('');
      setChangeSummary('');
    }
  }, [selectedEventType, channel, activeVersion?.id]);

  const isSecurityLocked = Boolean(
    selectedEvent &&
      (selectedEvent.deliveryClass === 'SECURITY' ||
        SECURITY_LOCKED_EVENT_TYPES.has(selectedEvent.eventType) ||
        !selectedEvent.templateEditable),
  );

  const canEditFields = permissions.canManageTemplates && !isSecurityLocked;

  const detectedTokens = useMemo(() => {
    const combined = channel === 'EMAIL' ? `${subject}\n${body}` : body;
    return extractTemplateVariables(combined);
  }, [channel, subject, body]);

  const approvedSet = useMemo(
    () => new Set((selectedEvent?.approvedVariables ?? []).map((v) => v.name)),
    [selectedEvent],
  );

  const localSafePreview = useMemo(() => {
    if (!selectedEvent) return null;
    return renderSafeTemplatePreview(
      selectedEvent,
      channel,
      channel === 'EMAIL' ? subject : null,
      body,
      sampleOverrides,
    );
  }, [selectedEvent, channel, subject, body, sampleOverrides]);

  const insertTokenIntoField = (
    target: 'subject' | 'body',
    variable: ApprovedTemplateVariable,
  ) => {
    if (!canEditFields) return;
    const token = `{{${variable.name}}}`;
    setServerPreview(null);

    if (target === 'subject' && channel === 'EMAIL') {
      const el = subjectInputRef.current;
      if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const next = `${subject.slice(0, start)}${token}${subject.slice(end)}`;
        setSubject(next);
      } else {
        setSubject((prev) => (prev && !prev.endsWith(' ') ? `${prev} ${token}` : `${prev}${token}`));
      }
      return;
    }

    const el = bodyTextareaRef.current;
    if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
      setBody(next);
    } else {
      setBody((prev) => (prev && !prev.endsWith(' ') ? `${prev} ${token}` : `${prev}${token}`));
    }
  };

  const handleServerPreview = async () => {
    if (!selectedEvent || isSecurityLocked) return;
    setIsPreviewLoading(true);
    setPreviewError('');
    setPreviewBlockedMessage('');
    setServerPreview(null);

    const effectiveSamples: Record<string, string> = {};
    for (const item of selectedEvent.approvedVariables) {
      effectiveSamples[item.name] = sampleOverrides[item.name] ?? item.sampleValue;
    }

    try {
      const res = await NotificationManagementApi.previewTemplate({
        eventType: selectedEvent.eventType,
        channel,
        locale: 'en-NG',
        subject: channel === 'EMAIL' ? subject : null,
        body,
        sampleVariables: effectiveSamples,
      });
      if (res.status === 'BLOCKED') {
        setPreviewBlockedMessage(res.message);
      } else {
        setServerPreview(res.data);
      }
    } catch (err: any) {
      setPreviewError(err?.message || 'Server template preview request failed.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleSubmitTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!permissions.canManageTemplates) return;

    setValidationErrors([]);
    setSubmitError('');
    setSubmitBlockedMessage('');
    setSubmitSuccessMessage('');

    const errors = validateTemplateDraft({
      event: selectedEvent,
      channel,
      subject: channel === 'EMAIL' ? subject : '',
      body,
      changeSummary,
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    if (!selectedEvent) return;

    setIsSubmitting(true);
    try {
      const result = await NotificationManagementApi.submitTemplateVersion({
        eventType: selectedEvent.eventType,
        channel,
        locale: 'en-NG',
        subject: channel === 'EMAIL' ? subject.trim() : null,
        body: body.trim(),
        changeSummary: changeSummary.trim(),
      });

      if (result.status === 'BLOCKED') {
        setSubmitBlockedMessage(result.message);
        return;
      }

      const approvalNote = result.data.approvalId
        ? ` Approval ID: ${result.data.approvalId}.`
        : '';
      setSubmitSuccessMessage(
        result.data.status === 'PENDING_APPROVAL'
          ? `Template version submitted for maker-checker approval.${approvalNote}`
          : `Template version saved (${result.data.status}).${approvalNote}`,
      );
      setChangeSummary('');

      if (onTemplateSubmitted) {
        onTemplateSubmitted(result.data, {
          id:
            result.data.changeRequestId ??
            result.data.approvalId ??
            `local-ref-${Date.now()}`,
          approvalId: result.data.approvalId ?? null,
          changeType: 'TEMPLATE_CREATE',
          eventType: selectedEvent.eventType,
          channel,
          summary: changeSummary.trim(),
          status: result.data.status === 'APPLIED' ? 'APPLIED' : 'PENDING_APPROVAL',
          requestedBy: result.data.requestedBy ?? currentPrincipalId,
          requestedAt: result.data.updatedAt ?? new Date().toISOString(),
          proposedSubject: channel === 'EMAIL' ? subject.trim() : null,
          proposedBody: body.trim(),
        });
      }
      if (onRefreshRequested) {
        await onRefreshRequested();
      }
    } catch (err: any) {
      if (err?.status === 403) {
        setSubmitError(
          `Access denied (403): ${err.message || 'Current workforce principal is not authorized to submit notification templates.'}`,
        );
      } else {
        setSubmitError(err?.message || 'Failed to submit template version.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivateVersion = async (versionRow: NotificationTemplateVersion) => {
    if (!permissions.canApproveTemplates || !permissions.hasMfaAssurance) return;
    if (versionRow.sourceOrigin === 'CODE_BASELINE') {
      setActivationFeedback({
        kind: 'blocked',
        message:
          'BLOCKED on ARENA 1: Built-in code baseline entries exist only in NotificationTemplateService until the notification_templates migration is integrated.',
      });
      return;
    }
    if (versionRow.createdBy && versionRow.createdBy === currentPrincipalId) {
      setActivationFeedback({
        kind: 'error',
        message: 'Self-approval prohibited: Maker and Checker must be distinct workforce principals.',
      });
      return;
    }

    setActivatingTemplateId(versionRow.id);
    setActivationFeedback(null);
    try {
      const res = await NotificationManagementApi.activateTemplateVersion(versionRow.id, {
        comment: activationComment.trim() || undefined,
      });
      if (res.status === 'BLOCKED') {
        setActivationFeedback({ kind: 'blocked', message: res.message });
      } else {
        setActivationFeedback({
          kind: 'success',
          message: `Template v${versionRow.version} activation processed (${res.data.status}).`,
        });
        setActivationComment('');
        if (onRefreshRequested) await onRefreshRequested();
      }
    } catch (err: any) {
      setActivationFeedback({
        kind: 'error',
        message: err?.message || 'Failed to activate template version.',
      });
    } finally {
      setActivatingTemplateId(null);
    }
  };

  const maxBodyLength = channel === 'SMS' ? SMS_BODY_MAX_LENGTH : EMAIL_BODY_MAX_LENGTH;
  const displayedPreview = serverPreview ?? localSafePreview;

  return (
    <div style={styles.wrapper} data-testid={`template-workspace-${channel.toLowerCase()}`}>
      {/* Integration Status Banner */}
      {(templatesRegistryBlocked || (channel === 'EMAIL' && emailChannelBlocked)) && (
        <div
          style={styles.blockedBanner}
          role="status"
          data-testid={`template-registry-blocked-${channel.toLowerCase()}`}
        >
          <div style={styles.blockedTitleRow}>
            <span style={styles.blockedBadge}>BLOCKED</span>
            <strong>
              {channel === 'EMAIL'
                ? 'Backend Template Registry (ARENA 1) & Email Channel Runtime (ARENA 3) Pending Integration'
                : 'Backend Template Registry (ARENA 1) Pending Integration'}
            </strong>
          </div>
          <p style={styles.blockedBodyText}>
            {templatesRegistryBlocked
              ? 'GET/POST /internal/notifications/templates is not yet available on the running backend. Showing read-only code-defined v1 baselines from NotificationTemplateService for inspection, variable authoring, validation, and safe preview. Persistence and version activation remain BLOCKED until ARENA 1 merges.'
              : 'Email delivery infrastructure (NotificationChannel EMAIL widening and provider adapter) is pending ARENA 3 integration.'}
          </p>
        </div>
      )}

      {/* Read-only scope notice when principal lacks notification.manage_templates */}
      {!permissions.canManageTemplates && (
        <div style={styles.readonlyNotice} data-testid="template-readonly-scope-notice">
          Read-only mode: Grant <code>notification.manage_templates</code> to draft or submit new{' '}
          {channel} template versions. Template inspection, variable browsing, and safe preview remain available.
        </div>
      )}

      {/* Event Selector Header Card */}
      <div style={styles.card}>
        <div style={styles.selectorRow}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label htmlFor={`template-event-select-${channel}`} style={styles.label}>
              Notification Event ({channel} Channel · Locale <code>en-NG</code>)
            </label>
            <select
              id={`template-event-select-${channel}`}
              aria-label="Notification event"
              data-testid="template-event-select"
              style={styles.select}
              value={selectedEventType}
              onChange={(e) => setSelectedEventType(e.target.value)}
            >
              {events.map((item) => (
                <option key={item.eventType} value={item.eventType}>
                  {item.eventType} [{item.deliveryClass}
                  {!item.templateEditable ? ' — LOCKED CODE TEMPLATE' : ''}]
                </option>
              ))}
            </select>
          </div>
          {selectedEvent && (
            <div style={styles.eventMetaPills}>
              <span style={styles.metaPill}>Category: {selectedEvent.category}</span>
              <span style={styles.metaPill}>Class: {selectedEvent.deliveryClass}</span>
              <span style={styles.metaPill}>Recipient: {selectedEvent.recipientTarget}</span>
              <span style={styles.metaPill}>
                Active {channel}:{' '}
                {activeVersion
                  ? `v${activeVersion.version} (${activeVersion.sourceOrigin === 'CODE_BASELINE' ? 'Code Baseline' : 'DB'})`
                  : 'None configured'}
              </span>
            </div>
          )}
        </div>
        {selectedEvent && <p style={styles.eventDescription}>{selectedEvent.description}</p>}

        {isSecurityLocked && selectedEvent && (
          <div
            style={styles.securityLockedBox}
            role="alert"
            data-testid="template-security-locked-banner"
          >
            <strong>🔒 Mandatory Security Direct-Send Flow — Template Editing Prohibited</strong>
            <p style={{ margin: '6px 0 0 0', fontSize: 13 }}>
              <code>{selectedEvent.eventType}</code> dispatches directly through{' '}
              <code>NOTIFICATION_PROVIDER_TOKEN</code> without creating outbox or delivery records so
              OTPs and temporary credentials can never be persisted in database tables or exposed to
              admin-editable templates (Audit Finding F-S6).
            </p>
          </div>
        )}

        {selectedEvent?.eventType === 'cash_to_cash.created' && (
          <div
            style={styles.c2cNoticeBox}
            data-testid="template-c2c-nondisclosure-banner"
          >
            <strong>🛡️ Cash-to-Cash Beneficiary Non-Disclosure Rule (Audit §4.7.3 / F-S2)</strong>
            <p style={{ margin: '6px 0 0 0', fontSize: 13 }}>
              Beneficiary SMS templates may reference ONLY{' '}
              <code>{'{{sender_name}}'}</code>, <code>{'{{amount}}'}</code>, and{' '}
              <code>{'{{agent_locator_url}}'}</code>. Including the 6-digit{' '}
              <code>transferNumber</code>, <code>senderPhone</code>, or secret{' '}
              <code>transferCode</code> is strictly rejected; the sender shares redemption details
              out-of-band.
            </p>
          </div>
        )}
      </div>

      {/* Two-Column Authoring + Variable Browser & Preview */}
      <div style={styles.twoColGrid}>
        {/* Left Column: SMS / Email Template Editor */}
        <section style={styles.card} aria-label={`${channel} template editor`}>
          <h3 style={styles.sectionTitle}>
            {channel === 'SMS' ? '✉️ SMS Template Editor' : '📧 Email Template Editor (Subject & Body)'}
          </h3>

          <form onSubmit={handleSubmitTemplate} noValidate>
            {channel === 'EMAIL' && (
              <div style={styles.fieldGroup}>
                <div style={styles.labelRow}>
                  <label htmlFor="email-template-subject" style={styles.label}>
                    Email Subject Line <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <span
                    style={{
                      fontSize: 12,
                      color: subject.length > EMAIL_SUBJECT_MAX_LENGTH ? '#DC2626' : '#64748B',
                    }}
                  >
                    {subject.length} / {EMAIL_SUBJECT_MAX_LENGTH} chars
                  </span>
                </div>
                <input
                  ref={subjectInputRef}
                  id="email-template-subject"
                  aria-label="Email subject"
                  data-testid="email-template-subject-input"
                  type="text"
                  style={styles.input}
                  placeholder="e.g. MonieNaija Funding Approved — Ref {{reference}}"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setServerPreview(null);
                  }}
                  disabled={!canEditFields || isSubmitting}
                />
              </div>
            )}

            <div style={styles.fieldGroup}>
              <div style={styles.labelRow}>
                <label htmlFor={`template-body-${channel}`} style={styles.label}>
                  {channel === 'SMS' ? 'SMS Message Body' : 'Email Message Body'}{' '}
                  <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <span
                  style={{
                    fontSize: 12,
                    color: body.length > maxBodyLength ? '#DC2626' : '#64748B',
                  }}
                  data-testid="template-char-counter"
                >
                  {body.length} / {maxBodyLength} chars
                  {channel === 'SMS' ? ` · Est. ${estimateSmsSegments(body)} SMS segment(s)` : ''}
                </span>
              </div>
              <textarea
                ref={bodyTextareaRef}
                id={`template-body-${channel}`}
                aria-label={`${channel} template body`}
                data-testid="template-body-textarea"
                rows={channel === 'EMAIL' ? 7 : 4}
                style={styles.textarea}
                placeholder={
                  channel === 'SMS'
                    ? 'Enter concise SMS message using approved {{variables}} only (max 1000 characters)…'
                    : 'Enter transactional email body using approved {{variables}} only (max 4000 characters)…'
                }
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setServerPreview(null);
                }}
                disabled={!canEditFields || isSubmitting}
              />
            </div>

            {/* Detected Variable Token Chips */}
            <div style={styles.tokenStatusBox}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                Referenced tokens ({detectedTokens.length}):
              </span>
              {detectedTokens.length === 0 ? (
                <span style={{ fontSize: 12, color: '#64748B' }}>No variables referenced</span>
              ) : (
                <div style={styles.tokenChipRow}>
                  {detectedTokens.map((token) => {
                    const isAllowed = approvedSet.has(token);
                    return (
                      <span
                        key={token || '__empty'}
                        style={isAllowed ? styles.validTokenChip : styles.invalidTokenChip}
                      >
                        {isAllowed ? '✓' : '✕'} {`{{${token}}}`}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={styles.fieldGroup}>
              <label htmlFor={`template-summary-${channel}`} style={styles.label}>
                Change Summary / Audit Reason <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <input
                id={`template-summary-${channel}`}
                aria-label="Change summary"
                data-testid="template-change-summary-input"
                type="text"
                style={styles.input}
                placeholder="Describe why this template version is being proposed (min 10 chars)…"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                disabled={!canEditFields || isSubmitting}
              />
            </div>

            {validationErrors.length > 0 && (
              <div
                style={styles.errorAlert}
                role="alert"
                data-testid="template-validation-errors"
              >
                <strong>Template validation failed:</strong>
                <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                  {validationErrors.map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {submitBlockedMessage && (
              <div
                style={styles.blockedAlert}
                role="alert"
                data-testid="template-submit-blocked-banner"
              >
                <strong>BLOCKED — Backend Persistence Not Yet Integrated</strong>
                <p style={{ margin: '4px 0 0 0' }}>{submitBlockedMessage}</p>
              </div>
            )}

            {submitError && (
              <div style={styles.errorAlert} role="alert" data-testid="template-submit-error">
                {submitError}
              </div>
            )}

            {submitSuccessMessage && (
              <div style={styles.successAlert} role="status" data-testid="template-submit-success">
                {submitSuccessMessage}
              </div>
            )}

            <div style={styles.buttonRow}>
              <button
                type="submit"
                data-testid="submit-template-version-btn"
                disabled={!canEditFields || isSubmitting}
                style={!canEditFields || isSubmitting ? styles.primaryBtnDisabled : styles.primaryBtn}
              >
                {isSubmitting
                  ? 'Submitting…'
                  : templatesRegistryBlocked
                    ? `Validate & Submit ${channel} Version (Backend BLOCKED)`
                    : `Submit ${channel} Template Version for Approval`}
              </button>
            </div>
          </form>
        </section>

        {/* Right Column: Approved Variable Browser + Safe Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Capability 5: Approved Variable Browser & Insertion */}
          <section
            style={styles.card}
            aria-label="Approved variable browser"
            data-testid="approved-variable-browser"
          >
            <h3 style={styles.sectionTitle}>🧩 Approved Variable Browser & Insertion</h3>
            <p style={styles.helperText}>
              Secrets (<code>OTP</code>, <code>PIN</code>, <code>password</code>,{' '}
              <code>transferCode</code>, provider keys, internal ledger IDs) are excluded by
              construction and cannot be registered or inserted.
            </p>

            {!selectedEvent || selectedEvent.approvedVariables.length === 0 ? (
              <div style={styles.emptyBox}>
                {isSecurityLocked
                  ? 'Locked security event — no admin-configurable variables.'
                  : 'No dynamic variables are registered for this event.'}
              </div>
            ) : (
              <div style={styles.variableList}>
                {selectedEvent.approvedVariables.map((variable) => (
                  <div
                    key={variable.name}
                    style={styles.variableCard}
                    data-testid={`variable-card-${variable.name}`}
                  >
                    <div style={styles.variableHeader}>
                      <code style={styles.variableToken}>{`{{${variable.name}}}`}</code>
                      <span style={{ fontSize: 11, color: '#475569' }}>
                        Resolver: <code>{variable.sourceSummary}</code>
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 8px 0', fontSize: 12, color: '#334155' }}>
                      {variable.description} · Sample: <strong>{variable.sampleValue}</strong>
                    </p>
                    <div style={styles.variableActions}>
                      <button
                        type="button"
                        data-testid={`insert-var-body-${variable.name}`}
                        disabled={!canEditFields}
                        style={canEditFields ? styles.secondarySmallBtn : styles.disabledSmallBtn}
                        onClick={() => insertTokenIntoField('body', variable)}
                      >
                        + Insert into Body
                      </button>
                      {channel === 'EMAIL' && (
                        <button
                          type="button"
                          data-testid={`insert-var-subject-${variable.name}`}
                          disabled={!canEditFields}
                          style={canEditFields ? styles.secondarySmallBtn : styles.disabledSmallBtn}
                          onClick={() => insertTokenIntoField('subject', variable)}
                        >
                          + Insert into Subject
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Capability 6: Template Preview Using Representative Safe Data */}
          <section
            style={styles.card}
            aria-label="Template safe preview"
            data-testid="template-safe-preview-card"
          >
            <div style={styles.labelRow}>
              <h3 style={styles.sectionTitle}>🔍 Safe Template Preview (Representative Data)</h3>
              <button
                type="button"
                data-testid="run-server-preview-btn"
                disabled={isSecurityLocked || isPreviewLoading}
                style={
                  isSecurityLocked || isPreviewLoading
                    ? styles.disabledSmallBtn
                    : styles.secondarySmallBtn
                }
                onClick={() => void handleServerPreview()}
              >
                {isPreviewLoading ? 'Previewing…' : 'Verify via Server Preview'}
              </button>
            </div>
            <p style={styles.helperText}>
              Uses representative non-secret sample values only. Never sends an SMS/Email and never
              writes to <code>outbox_events</code> or <code>notification_deliveries</code>.
            </p>

            {/* Editable Whitelisted Sample Overrides */}
            {selectedEvent && selectedEvent.approvedVariables.length > 0 && (
              <div style={styles.sampleGrid}>
                {selectedEvent.approvedVariables.map((variable) => (
                  <div key={variable.name}>
                    <label
                      htmlFor={`sample-${channel}-${variable.name}`}
                      style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569' }}
                    >
                      Sample <code>{`{{${variable.name}}}`}</code>
                    </label>
                    <input
                      id={`sample-${channel}-${variable.name}`}
                      aria-label={`Sample value for ${variable.name}`}
                      type="text"
                      style={styles.smallInput}
                      value={sampleOverrides[variable.name] ?? variable.sampleValue}
                      onChange={(e) => {
                        setSampleOverrides((prev) => ({
                          ...prev,
                          [variable.name]: e.target.value,
                        }));
                        setServerPreview(null);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {previewBlockedMessage && (
              <div
                style={styles.blockedAlert}
                role="status"
                data-testid="template-preview-blocked-banner"
              >
                <strong>Server Preview BLOCKED (ARENA 1)</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>{previewBlockedMessage}</p>
              </div>
            )}

            {previewError && (
              <div style={styles.errorAlert} role="alert">
                {previewError}
              </div>
            )}

            {displayedPreview && !isSecurityLocked && (
              <div style={styles.previewFrame} data-testid="rendered-preview-output">
                <div style={styles.previewBadgeRow}>
                  <span style={styles.previewSourceBadge}>
                    {serverPreview
                      ? 'Authoritative Server-Rendered Preview'
                      : 'Local Safe Whitelist Preview'}
                  </span>
                  <span style={{ fontSize: 11, color: '#475569' }}>
                    {displayedPreview.characterCount} chars
                    {displayedPreview.estimatedSmsSegments !== null
                      ? ` · ${displayedPreview.estimatedSmsSegments} SMS segment(s)`
                      : ''}
                  </span>
                </div>
                {channel === 'EMAIL' && (
                  <div style={styles.previewSubjectBox}>
                    <strong>Subject:</strong>{' '}
                    <span data-testid="rendered-preview-subject">
                      {displayedPreview.renderedSubject || '(empty subject)'}
                    </span>
                  </div>
                )}
                <div style={styles.previewBodyBox} data-testid="rendered-preview-body">
                  {displayedPreview.renderedBody || '(empty message body)'}
                </div>
                {displayedPreview.warnings.length > 0 && (
                  <div style={styles.warningList} data-testid="preview-warnings">
                    {displayedPreview.warnings.map((warn, idx) => (
                      <div key={idx}>⚠️ {warn}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Capability 7: Template Version History & Comparison */}
      <section
        style={styles.card}
        aria-label={`${channel} template version history`}
        data-testid="template-version-history-section"
      >
        <div style={styles.labelRow}>
          <h3 style={styles.sectionTitle}>
            🕓 {channel} Template Version History ({matchingVersions.length})
          </h3>
          {permissions.canApproveTemplates && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="text"
                aria-label="Version activation comment"
                placeholder="Optional checker activation note…"
                style={{ ...styles.smallInput, width: 240 }}
                value={activationComment}
                onChange={(e) => setActivationComment(e.target.value)}
              />
            </div>
          )}
        </div>

        {activationFeedback && (
          <div
            style={
              activationFeedback.kind === 'success'
                ? styles.successAlert
                : activationFeedback.kind === 'blocked'
                  ? styles.blockedAlert
                  : styles.errorAlert
            }
            role={activationFeedback.kind === 'error' ? 'alert' : 'status'}
            data-testid="template-activation-feedback"
          >
            {activationFeedback.message}
          </div>
        )}

        {matchingVersions.length === 0 ? (
          <div style={styles.emptyBox}>
            No persisted {channel} template versions exist yet for <code>{selectedEventType}</code>.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table} data-testid="template-version-history-table">
              <thead>
                <tr>
                  <th style={styles.th}>Version</th>
                  <th style={styles.th}>Origin</th>
                  <th style={styles.th}>Status</th>
                  {channel === 'EMAIL' && <th style={styles.th}>Subject</th>}
                  <th style={styles.th}>Body Summary</th>
                  <th style={styles.th}>Author</th>
                  <th style={styles.th}>Updated</th>
                  <th style={styles.th}>Change Note</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {matchingVersions.map((ver) => {
                  const isSelfAuthored = Boolean(
                    ver.createdBy && ver.createdBy === currentPrincipalId,
                  );
                  const canActivateRow =
                    permissions.canApproveTemplates &&
                    permissions.hasMfaAssurance &&
                    !ver.isActive &&
                    !isSelfAuthored;

                  return (
                    <tr key={ver.id}>
                      <td style={styles.td}>
                        <strong>v{ver.version}</strong>
                      </td>
                      <td style={styles.td}>
                        {ver.sourceOrigin === 'CODE_BASELINE' ? (
                          <span style={styles.codeBaselineChip}>Code Baseline</span>
                        ) : (
                          <span style={styles.dbChip}>DB Registry</span>
                        )}
                      </td>
                      <td style={styles.td}>
                        <span
                          style={
                            ver.isActive
                              ? styles.activeChip
                              : ver.approvalStatus === 'PENDING_APPROVAL'
                                ? styles.pendingChip
                                : styles.mutedChip
                          }
                        >
                          {ver.isActive ? 'ACTIVE' : ver.approvalStatus}
                        </span>
                      </td>
                      {channel === 'EMAIL' && (
                        <td style={styles.td}>{ver.subject || '—'}</td>
                      )}
                      <td style={{ ...styles.td, maxWidth: 280 }}>{ver.body}</td>
                      <td style={styles.td}>
                        <code>{ver.createdBy || '—'}</code>
                      </td>
                      <td style={styles.td}>
                        {ver.updatedAt ? new Date(ver.updatedAt).toLocaleString() : '—'}
                      </td>
                      <td style={styles.td}>{ver.changeSummary || '—'}</td>
                      <td style={styles.td}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {canEditFields && (
                            <button
                              type="button"
                              style={styles.secondarySmallBtn}
                              onClick={() => {
                                if (channel === 'EMAIL') setSubject(ver.subject ?? '');
                                setBody(ver.body);
                              }}
                            >
                              Load v{ver.version}
                            </button>
                          )}
                          {activeVersion && activeVersion.id !== ver.id && (
                            <button
                              type="button"
                              style={styles.secondarySmallBtn}
                              onClick={() => setComparedVersion(ver)}
                            >
                              Compare
                            </button>
                          )}
                          {permissions.canApproveTemplates && !ver.isActive && (
                            <button
                              type="button"
                              data-testid={`activate-version-${ver.version}`}
                              disabled={
                                !canActivateRow || activatingTemplateId === ver.id
                              }
                              title={
                                isSelfAuthored
                                  ? 'Self-approval prohibited (Maker ≠ Checker)'
                                  : !permissions.hasMfaAssurance
                                    ? 'MFA session assurance required'
                                    : undefined
                              }
                              style={
                                canActivateRow
                                  ? styles.approveSmallBtn
                                  : styles.disabledSmallBtn
                              }
                              onClick={() => void handleActivateVersion(ver)}
                            >
                              {activatingTemplateId === ver.id
                                ? 'Activating…'
                                : isSelfAuthored
                                  ? 'Maker ≠ Checker'
                                  : !permissions.hasMfaAssurance
                                    ? 'MFA Required'
                                    : 'Activate'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Structured Side-by-Side Comparison View */}
        {comparedVersion && activeVersion && (
          <div style={styles.compareBox} data-testid="template-version-comparison">
            <div style={styles.labelRow}>
              <strong>
                Comparing Active (v{activeVersion.version}) vs Selected (v{comparedVersion.version})
              </strong>
              <button
                type="button"
                style={styles.secondarySmallBtn}
                onClick={() => setComparedVersion(null)}
              >
                Close Comparison
              </button>
            </div>
            <div style={styles.compareGrid}>
              <div style={styles.compareCol}>
                <div style={styles.compareHeader}>Active v{activeVersion.version}</div>
                {channel === 'EMAIL' && (
                  <div style={{ fontSize: 12, marginBottom: 6 }}>
                    <strong>Subject:</strong> {activeVersion.subject || '—'}
                  </div>
                )}
                <div style={styles.compareBody}>{activeVersion.body}</div>
              </div>
              <div style={styles.compareCol}>
                <div style={styles.compareHeader}>
                  Candidate v{comparedVersion.version} ({comparedVersion.approvalStatus})
                </div>
                {channel === 'EMAIL' && (
                  <div style={{ fontSize: 12, marginBottom: 6 }}>
                    <strong>Subject:</strong> {comparedVersion.subject || '—'}
                  </div>
                )}
                <div style={styles.compareBody}>{comparedVersion.body}</div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: 16 },
  card: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: 18,
  },
  blockedBanner: {
    background: '#FFFBEB',
    border: '1px solid #F59E0B',
    borderRadius: 10,
    padding: '12px 16px',
    color: '#78350F',
  },
  blockedTitleRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  blockedBadge: {
    background: '#D97706',
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 999,
    letterSpacing: 0.4,
  },
  blockedBodyText: { margin: 0, fontSize: 13, lineHeight: 1.45 },
  readonlyNotice: {
    background: '#F8FAFC',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    color: '#334155',
  },
  selectorRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 14,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  eventMetaPills: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  metaPill: {
    background: '#F1F5F9',
    border: '1px solid #CBD5E1',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
  },
  eventDescription: { margin: '10px 0 0 0', fontSize: 13, color: '#475569' },
  securityLockedBox: {
    marginTop: 12,
    background: '#FEF2F2',
    border: '1px solid #FCA5A5',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#991B1B',
  },
  c2cNoticeBox: {
    marginTop: 12,
    background: '#EFF6FF',
    border: '1px solid #93C5FD',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#1E3A8A',
  },
  twoColGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    gap: 16,
  },
  sectionTitle: { margin: '0 0 8px 0', fontSize: 16, fontWeight: 700, color: '#0F172A' },
  helperText: { margin: '0 0 12px 0', fontSize: 12, color: '#64748B', lineHeight: 1.45 },
  fieldGroup: { marginBottom: 14 },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  label: { fontSize: 13, fontWeight: 600, color: '#1E293B', display: 'block' },
  select: {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid #CBD5E1',
    fontSize: 13,
    background: '#FFFFFF',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid #CBD5E1',
    fontSize: 13,
  },
  smallInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 9px',
    borderRadius: 6,
    border: '1px solid #CBD5E1',
    fontSize: 12,
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #CBD5E1',
    fontSize: 13,
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  tokenStatusBox: {
    background: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: 8,
    padding: '8px 12px',
    marginBottom: 14,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  tokenChipRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  validTokenChip: {
    background: '#DCFCE7',
    color: '#166534',
    fontSize: 12,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
  },
  invalidTokenChip: {
    background: '#FEE2E2',
    color: '#991B1B',
    fontSize: 12,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
  },
  errorAlert: {
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    color: '#991B1B',
    padding: '10px 12px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  blockedAlert: {
    background: '#FFFBEB',
    border: '1px solid #F59E0B',
    color: '#92400E',
    padding: '10px 12px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  successAlert: {
    background: '#F0FDF4',
    border: '1px solid #BBF7D0',
    color: '#166534',
    padding: '10px 12px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  buttonRow: { display: 'flex', gap: 10 },
  primaryBtn: {
    background: '#0F172A',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  primaryBtnDisabled: {
    background: '#94A3B8',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'not-allowed',
  },
  secondarySmallBtn: {
    background: '#FFFFFF',
    color: '#0F172A',
    border: '1px solid #CBD5E1',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  approveSmallBtn: {
    background: '#047857',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  disabledSmallBtn: {
    background: '#F1F5F9',
    color: '#94A3B8',
    border: '1px solid #E2E8F0',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'not-allowed',
  },
  variableList: { display: 'flex', flexDirection: 'column', gap: 10 },
  variableCard: {
    border: '1px solid #E2E8F0',
    borderRadius: 8,
    padding: '10px 12px',
    background: '#F8FAFC',
  },
  variableHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  variableToken: {
    background: '#E0F2FE',
    color: '#0369A1',
    padding: '2px 6px',
    borderRadius: 4,
    fontWeight: 700,
    fontSize: 12,
  },
  variableActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  sampleGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  previewFrame: {
    background: '#0F172A',
    color: '#F8FAFC',
    borderRadius: 8,
    padding: 14,
  },
  previewBadgeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  previewSourceBadge: {
    background: '#1E293B',
    color: '#93C5FD',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  },
  previewSubjectBox: {
    paddingBottom: 8,
    marginBottom: 8,
    borderBottom: '1px solid #334155',
    fontSize: 13,
  },
  previewBodyBox: {
    whiteSpace: 'pre-wrap',
    fontSize: 13,
    lineHeight: 1.5,
  },
  warningList: {
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid #334155',
    color: '#FCD34D',
    fontSize: 12,
  },
  emptyBox: {
    padding: 14,
    background: '#F8FAFC',
    border: '1px dashed #CBD5E1',
    borderRadius: 8,
    fontSize: 13,
    color: '#64748B',
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
  activeChip: {
    background: '#DCFCE7',
    color: '#166534',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  pendingChip: {
    background: '#FEF3C7',
    color: '#92400E',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  mutedChip: {
    background: '#F1F5F9',
    color: '#475569',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  },
  codeBaselineChip: {
    background: '#EDE9FE',
    color: '#5B21B6',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  },
  dbChip: {
    background: '#DBEAFE',
    color: '#1E40AF',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  },
  compareBox: {
    marginTop: 14,
    background: '#F8FAFC',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
    padding: 14,
  },
  compareGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 12,
    marginTop: 10,
  },
  compareCol: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 8,
    padding: 12,
  },
  compareHeader: { fontWeight: 700, fontSize: 12, color: '#0F172A', marginBottom: 6 },
  compareBody: { whiteSpace: 'pre-wrap', fontSize: 13, color: '#334155' },
};
