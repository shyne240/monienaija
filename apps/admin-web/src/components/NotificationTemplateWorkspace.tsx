import React, { useEffect, useMemo, useRef, useState } from 'react';
import './notification-workspaces.css';
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
  templatesReadPending?: boolean;
  templatesReadError?: string | null;
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
  templatesReadPending = false,
  templatesReadError = null,
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
  const [pendingEventType, setPendingEventType] = useState<string | null>(null);
  const switchPromptRef = useRef<HTMLDivElement | null>(null);
  const eventSelectRef = useRef<HTMLSelectElement | null>(null);
  useEffect(() => {
    if (pendingEventType) switchPromptRef.current?.focus();
  }, [pendingEventType]);
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [changeSummary, setChangeSummary] = useState<string>('');
  const [draftBaseVersion, setDraftBaseVersion] = useState<number | null>(null);
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
  const hasUserEditedRef = useRef<boolean>(false);
  const lastEventChannelRef = useRef<string>('');
  const mounted = useRef(true);
  const submitInFlight = useRef(false);
  const activationInFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const previewGeneration = useRef(0);
  const previewContext = useRef('');
  const previewKey = JSON.stringify([currentPrincipalId, permissions.canViewCatalogue, channel, selectedEventType, subject, body, sampleOverrides]);
  previewContext.current = previewKey;
  useEffect(() => {
    previewGeneration.current += 1;
    setServerPreview(null);
    setPreviewError('');
    setPreviewBlockedMessage('');
    setIsPreviewLoading(false);
    return () => { previewGeneration.current += 1; };
  }, [previewKey]);

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
    () => matchingVersions.find((item) => item.isActive && item.sourceOrigin !== 'CODE_BASELINE') ?? null,
    [matchingVersions],
  );
  const referenceVersion = activeVersion ?? matchingVersions[0] ?? null;
  const activeVersionConfirmed = !templatesRegistryBlocked && !templatesReadPending && !templatesReadError && Boolean(activeVersion);

  // Sync editor content whenever the operator switches event or channel, or when live template
  // history finishes loading before the operator begins editing.
  useEffect(() => {
    const eventChannelKey = `${channel}::${selectedEventType}`;
    const switchedEventOrChannel = lastEventChannelRef.current !== eventChannelKey;
    if (switchedEventOrChannel) {
      lastEventChannelRef.current = eventChannelKey;
      hasUserEditedRef.current = false;
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
    } else if (hasUserEditedRef.current) {
      return;
    }

    setDraftBaseVersion(activeVersionConfirmed && activeVersion ? activeVersion.version : null);
    if (referenceVersion) {
      setSubject(channel === 'EMAIL' ? referenceVersion.subject ?? '' : '');
      setBody(referenceVersion.body);
      if (switchedEventOrChannel) setChangeSummary('');
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
      if (switchedEventOrChannel) setChangeSummary('');
    } else {
      setSubject('');
      setBody('');
      if (switchedEventOrChannel) setChangeSummary('');
    }
  }, [selectedEventType, channel, referenceVersion?.id, activeVersionConfirmed, activeVersion?.version]);

  const isSecurityFlow = Boolean(
    selectedEvent &&
      (selectedEvent.deliveryClass === 'SECURITY' || SECURITY_LOCKED_EVENT_TYPES.has(selectedEvent.eventType)),
  );
  const isSecurityLocked = Boolean(selectedEvent && (isSecurityFlow || !selectedEvent.templateEditable));

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

  const hasCustomSampleOverrides = useMemo(() => {
    if (!selectedEvent) return false;
    return selectedEvent.approvedVariables.some(
      (variable) =>
        sampleOverrides[variable.name] !== undefined &&
        sampleOverrides[variable.name] !== variable.sampleValue,
    );
  }, [selectedEvent, sampleOverrides]);

  const insertTokenIntoField = (
    target: 'subject' | 'body',
    variable: ApprovedTemplateVariable,
  ) => {
    if (!canEditFields || isSubmitting || activatingTemplateId) return;
    hasUserEditedRef.current = true;
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
    const request = ++previewGeneration.current;
    const valid = () => request === previewGeneration.current && previewContext.current === previewKey;
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
      if (!valid()) return;
      if (res.status === 'BLOCKED') {
        setPreviewBlockedMessage(res.message);
      } else {
        setServerPreview(res.data);
      }
    } catch (err: any) {
      if (valid()) setPreviewError(err?.message || 'Server template preview request failed.');
    } finally {
      if (valid()) setIsPreviewLoading(false);
    }
  };

  const handleSubmitTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!permissions.canManageTemplates || !permissions.hasMfaAssurance || submitInFlight.current || activationInFlight.current || pendingEventType) return;

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
    if (!activeVersionConfirmed || !activeVersion || draftBaseVersion !== activeVersion.version) {
      setSubmitError('A confirmed, current active template is required. Retain your draft, then reload the active version and review before submitting.');
      return;
    }

    submitInFlight.current = true;
    setIsSubmitting(true);
    try {
      const result = await NotificationManagementApi.submitTemplateVersion({
        eventType: selectedEvent.eventType,
        channel,
        locale: 'en-NG',
        subject: channel === 'EMAIL' ? subject.trim() : null,
        body: body.trim(),
        changeSummary: changeSummary.trim(),
        expectedVersion: draftBaseVersion,
      });
      if (!mounted.current) return;

      if (result.status === 'BLOCKED') {
        setSubmitBlockedMessage(result.message);
        return;
      }

      if (result.data.status !== 'PENDING_APPROVAL' || !result.data.approvalId || !result.data.updatedAt) throw new Error('Template proposal outcome not confirmed. Check the approval queue before retrying.');
      const approvalNote = result.data.approvalId
        ? ` Approval ID: ${result.data.approvalId}.`
        : '';
      setSubmitSuccessMessage(`Template version submitted for maker-checker approval.${approvalNote}`);
      setChangeSummary('');

      if (onTemplateSubmitted) {
        onTemplateSubmitted(result.data, {
          id:
            result.data.changeRequestId ?? result.data.approvalId,
          approvalId: result.data.approvalId ?? null,
          changeType: 'TEMPLATE_CREATE',
          eventType: selectedEvent.eventType,
          channel,
          summary: changeSummary.trim(),
          status: 'PENDING_APPROVAL',
          requestedBy: result.data.requestedBy ?? currentPrincipalId,
          requestedAt: result.data.updatedAt,
          proposedSubject: channel === 'EMAIL' ? subject.trim() : null,
          proposedBody: body.trim(),
        });
      }
      if (onRefreshRequested) {
        try { await onRefreshRequested(); } catch { if (mounted.current) setSubmitSuccessMessage((message) => `${message} Registry refresh failed; reload before another change.`); }
      }
    } catch (err: any) {
      if (!mounted.current) return;
      if (err?.status === 403) {
        setSubmitError(
          `Access denied (403): ${err.message || 'Current workforce principal is not authorized to submit notification templates.'}`,
        );
      } else {
        setSubmitError(`Template proposal outcome not confirmed. Check the approval queue before retrying. ${err?.message || 'Service unavailable.'}`);
      }
    } finally {
      submitInFlight.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  const handleActivateVersion = async (versionRow: NotificationTemplateVersion) => {
    // INTEGRATION (Phase 5): the real backend has no direct activation route. Activating a
    // historical version is a governed TEMPLATE_ROLLBACK proposal created by the maker
    // (SUPER_ADMIN + MFA); a FINANCE_CONTROLLER checker approves and executes it from the
    // change queue (maker ≠ checker is enforced server-side at approval time).
    if (!permissions.canManageTemplates || !permissions.hasMfaAssurance || submitInFlight.current || activationInFlight.current || pendingEventType || !activeVersionConfirmed || !activeVersion) return;
    if (versionRow.sourceOrigin === 'CODE_BASELINE') {
      setActivationFeedback({
        kind: 'blocked',
        message:
          'BLOCKED on ARENA 1: Built-in code baseline entries exist only in NotificationTemplateService until the notification_templates migration is integrated.',
      });
      return;
    }

    activationInFlight.current = true;
    setActivatingTemplateId(versionRow.id);
    setActivationFeedback(null);
    try {
      const res = await NotificationManagementApi.activateTemplateVersion(versionRow, {
        comment: activationComment.trim() || undefined,
        expectedVersion: activeVersion.version,
      });
      if (!mounted.current) return;
      if (res.status === 'BLOCKED') {
        setActivationFeedback({ kind: 'blocked', message: res.message });
      } else {
        if (res.data.status !== 'PENDING_APPROVAL' || !res.data.approvalId) throw new Error('Rollback proposal outcome not confirmed. Check the approval queue before retrying.');
        setActivationFeedback({
          kind: 'success',
          message:
            `Rollback proposal for ${versionRow.channel} v${versionRow.version} created (${res.data.status}). ` +
            (res.data.message ??
              'A FINANCE_CONTROLLER checker must approve and execute it before this version becomes active.'),
        });
        setActivationComment('');
        if (onRefreshRequested) { try { await onRefreshRequested(); } catch { if (mounted.current) setActivationFeedback({kind:'success', message:'Rollback proposal confirmed. Registry refresh failed; reload before another change.'}); } }
      }
    } catch (err: any) {
      if (!mounted.current) return;
      setActivationFeedback({
        kind: 'error',
        message: `Rollback proposal outcome not confirmed. Check the approval queue before retrying. ${err?.message || 'Service unavailable.'}`,
      });
    } finally {
      activationInFlight.current = false;
      if (mounted.current) setActivatingTemplateId(null);
    }
  };

  const maxBodyLength = channel === 'SMS' ? SMS_BODY_MAX_LENGTH : EMAIL_BODY_MAX_LENGTH;
  const displayedPreview = serverPreview ?? localSafePreview;

  return (
    <div className="mn-template-workspace" style={styles.wrapper} data-testid={`template-workspace-${channel.toLowerCase()}`}>
      <header className="mn-template-intro">
        <p className="mn-template-kicker">TEMPLATE GOVERNANCE · {channel}</p>
        <h2>{channel === 'SMS' ? 'SMS templates' : 'Email templates'}</h2>
        <p>
          Choose an event, prepare a draft with approved variables, then review its preview and
          version history. Proposals require approval before taking effect. Drafts are local to
          this tab and are discarded when you leave it.
        </p>
        <nav aria-label={`${channel} template workspace sections`}>
          <a href={`#template-editor-${channel}`}>Editor</a>
          <a href={`#template-variables-${channel}`}>Variables</a>
          <a href={`#template-preview-${channel}`}>Preview</a>
          <a href={`#template-history-${channel}`}>Version history</a>
        </nav>
      </header>
      {templatesReadError && <div role="alert" style={styles.blockedBanner}>Template registry unavailable: {templatesReadError}. Displayed data is not confirmed current.</div>}
      {/* Integration Status Banner */}
      {(templatesRegistryBlocked || (channel === 'EMAIL' && emailChannelBlocked)) && (
        <div
          style={styles.blockedBanner}
          role="status"
          data-testid={`template-registry-blocked-${channel.toLowerCase()}`}
        >
          <div style={styles.blockedTitleRow}>
            <span style={styles.blockedBadge}>BLOCKED</span>
            <strong>{templatesRegistryBlocked ? 'Template registry unavailable' : 'Email provider state unavailable or not enabled'}</strong>
          </div>
          <p style={styles.blockedBodyText}>
            {templatesRegistryBlocked
              ? 'The template registry could not be read. Any code-defined entries are references, not confirmed active versions; a confirmed active version is required for a proposal.'
              : 'Email provider state is blocked or reports that the channel is not enabled. Template governance and actual delivery readiness are separate.'}
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
      <section style={styles.card} className="mn-template-context" aria-label={`${channel} event context`}>
        <p className="mn-template-kicker">01 · SELECT AN EVENT</p>
        <h3>Template context</h3>
        <div style={styles.selectorRow}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <label htmlFor={`template-event-select-${channel}`} style={styles.label}>
              Notification Event ({channel} Channel · Locale <code>en-NG</code>)
            </label>
            <select
              ref={eventSelectRef}
              id={`template-event-select-${channel}`}
              aria-label="Notification event"
              data-testid="template-event-select"
              style={styles.select}
              value={selectedEventType}
              disabled={isSubmitting || Boolean(activatingTemplateId)}
              onChange={(e) => {
                const next = e.target.value;
                if (next === selectedEventType) return;
                if (hasUserEditedRef.current || changeSummary.trim()) setPendingEventType(next);
                else setSelectedEventType(next);
              }}
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
                {activeVersionConfirmed && activeVersion
                  ? `v${activeVersion.version} (DB)`
                  : templatesReadPending ? 'Loading registry…' : 'Not confirmed'}
              </span>
            </div>
          )}
        </div>
        {selectedEvent && <p style={styles.eventDescription}>{selectedEvent.description}</p>}
        {pendingEventType && (
          <div className="mn-template-switch-prompt" ref={switchPromptRef} tabIndex={-1}
            role="group" aria-label="Confirm event switch" data-testid="template-event-switch-prompt">
            <strong>Discard this event's draft?</strong>
            <p>
              Switching from <code>{selectedEventType}</code> to <code>{pendingEventType}</code> replaces
              the current editor draft and reason. This does not submit a proposal.
            </p>
            <div>
              <button type="button" onClick={() => { setPendingEventType(null); eventSelectRef.current?.focus(); }}>Keep draft</button>
              <button type="button" onClick={() => { setSelectedEventType(pendingEventType); setPendingEventType(null); eventSelectRef.current?.focus(); }}>Discard and switch</button>
            </div>
          </div>
        )}

        {isSecurityLocked && selectedEvent && (
          <div
            style={styles.securityLockedBox}
            role="alert"
            data-testid="template-security-locked-banner"
          >
            <strong>{isSecurityFlow ? 'Security flow — template editing prohibited' : 'Template editing prohibited for this event'}</strong>
            <p style={{ margin: '6px 0 0 0', fontSize: 13 }}>
              {isSecurityFlow ? 'Security templates are locked to protect direct-send credentials from admin editing.' : 'The loaded catalogue marks this event as not template-editable.'}
            </p>
          </div>
        )}

        {selectedEvent?.eventType === 'cash_to_cash.created' && (
          <div
            style={styles.c2cNoticeBox}
            data-testid="template-c2c-nondisclosure-banner"
          >
            <strong>Cash-to-Cash Beneficiary Non-Disclosure Rule (Audit §4.7.3 / F-S2)</strong>
            <p style={{ margin: '6px 0 0 0', fontSize: 13 }}>
              Beneficiary SMS templates may reference ONLY{' '}
              <code>{'{{sender_name}}'}</code>, <code>{'{{amount}}'}</code>, and{' '}
              <code>{'{{locator_clause}}'}</code>. Including the 6-digit{' '}
              <code>transferNumber</code>, <code>senderPhone</code>, or secret{' '}
              <code>transferCode</code> is strictly rejected; the sender shares redemption details
              out-of-band.
            </p>
          </div>
        )}
      </section>

      {/* Two-Column Authoring + Variable Browser & Preview */}
      <div style={styles.twoColGrid}>
        {/* Left Column: SMS / Email Template Editor */}
        <section id={`template-editor-${channel}`} className="mn-template-card" style={styles.card} aria-label={`${channel} template editor`} tabIndex={-1}>
          <p className="mn-template-kicker">02 · COMPOSE</p>
          <h3 style={styles.sectionTitle}>
            {channel === 'SMS' ? 'SMS Template Editor' : 'Email Template Editor (Subject & Body)'}
          </h3>
          <p style={styles.helperText}>Drafting does not change the active template. A confirmed active version and an approved proposal are required.</p>

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
                      color: subject.length > EMAIL_SUBJECT_MAX_LENGTH ? '#DC2626' : 'var(--mn-text-secondary, #52655f)',
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
                    hasUserEditedRef.current = true;
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
                    color: body.length > maxBodyLength ? '#DC2626' : 'var(--mn-text-secondary, #52655f)',
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
                  hasUserEditedRef.current = true;
                  setBody(e.target.value);
                  setServerPreview(null);
                }}
                disabled={!canEditFields || isSubmitting}
              />
            </div>

            {/* Detected Variable Token Chips */}
            <div style={styles.tokenStatusBox}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mn-text-primary, #132b25)' }}>
                Referenced tokens ({detectedTokens.length}):
              </span>
              {detectedTokens.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--mn-text-secondary, #52655f)' }}>No variables referenced</span>
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
                onChange={(e) => { hasUserEditedRef.current = true; setChangeSummary(e.target.value); }}
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
                <strong>Submission not confirmed</strong>
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

            {activeVersionConfirmed && activeVersion && draftBaseVersion !== activeVersion.version && <div role="alert">The active template changed since this draft was loaded. Your draft is retained; reload and review the active version before submitting. <button type="button" onClick={() => { hasUserEditedRef.current = false; setSubject(channel === 'EMAIL' ? activeVersion.subject ?? '' : ''); setBody(activeVersion.body); setChangeSummary(''); setDraftBaseVersion(activeVersion.version); }}>Reload active version</button></div>}
            {permissions.canManageTemplates && !permissions.hasMfaAssurance && <div role="note">MFA session assurance is required to submit template changes.</div>}
            <div style={styles.buttonRow}>
              <button
                type="submit"
                data-testid="submit-template-version-btn"
                disabled={!canEditFields || !permissions.hasMfaAssurance || isSubmitting || Boolean(activatingTemplateId) || Boolean(pendingEventType)}
                style={!canEditFields || !permissions.hasMfaAssurance || isSubmitting || activatingTemplateId || pendingEventType ? styles.primaryBtnDisabled : styles.primaryBtn}
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
            id={`template-variables-${channel}`} tabIndex={-1} className="mn-template-card"
            style={styles.card}
            aria-label="Approved variable browser"
            data-testid="approved-variable-browser"
          >
            <p className="mn-template-kicker">03 · APPROVED VARIABLES</p>
            <h3 style={styles.sectionTitle}>Variable browser &amp; insertion</h3>
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
                      <span style={{ fontSize: 11, color: 'var(--mn-text-secondary, #52655f)' }}>
                        Resolver: <code>{variable.sourceSummary}</code>
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 8px 0', fontSize: 12, color: 'var(--mn-text-primary, #132b25)' }}>
                      {variable.description} · Sample: <strong>{variable.sampleValue}</strong>
                    </p>
                    <div style={styles.variableActions}>
                      <button
                        type="button"
                        data-testid={`insert-var-body-${variable.name}`}
                        aria-label={`Insert ${variable.name} into body`}
                        disabled={!canEditFields || isSubmitting || Boolean(activatingTemplateId)}
                        style={canEditFields ? styles.secondarySmallBtn : styles.disabledSmallBtn}
                        onClick={() => insertTokenIntoField('body', variable)}
                      >
                        + Insert into Body
                      </button>
                      {channel === 'EMAIL' && (
                        <button
                          type="button"
                          data-testid={`insert-var-subject-${variable.name}`}
                          aria-label={`Insert ${variable.name} into subject`}
                          disabled={!canEditFields || isSubmitting || Boolean(activatingTemplateId)}
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
            id={`template-preview-${channel}`} tabIndex={-1} className="mn-template-card"
            style={styles.card}
            aria-label="Template safe preview"
            data-testid="template-safe-preview-card"
          >
            <div style={styles.labelRow}>
              <div><p className="mn-template-kicker">04 · INSPECT</p><h3 style={styles.sectionTitle}>Safe Template Preview (Representative Data)</h3></div>
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

            {/* Editable Whitelisted Sample Overrides (Client-Side Only) */}
            {selectedEvent && selectedEvent.approvedVariables.length > 0 && (
              <div>
                <div
                  style={{ fontSize: 11, color: 'var(--mn-text-secondary, #52655f)', marginBottom: 6 }}
                  data-testid="sample-override-scope-hint"
                >
                  <strong>Local Sample Overrides (Client-Side):</strong> Custom values below update
                  the local whitelist preview. Authoritative Server Preview (
                  <code>POST /internal/notifications/templates/preview</code>) renders fixed
                  server-side registry samples only.
                </div>
                <div style={styles.sampleGrid}>
                  {selectedEvent.approvedVariables.map((variable) => (
                    <div key={variable.name}>
                      <label
                        htmlFor={`sample-${channel}-${variable.name}`}
                        style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--mn-text-secondary, #52655f)' }}
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
                        }}
                      />
                    </div>
                  ))}
                </div>
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

            {serverPreview && !isSecurityLocked && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  fontSize: 12,
                  color: '#1E3A8A',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginBottom: 8,
                }}
                data-testid="server-preview-fixed-samples-notice"
              >
                <span>
                  <strong>Authoritative Server Preview Active:</strong> Rendered by the backend with
                  fixed registry sample bindings (custom sample overrides are not sent over the wire).
                </span>
                <button
                  type="button"
                  data-testid="clear-server-preview-btn"
                  style={styles.secondarySmallBtn}
                  onClick={() => setServerPreview(null)}
                >
                  Show Local Preview Only
                </button>
              </div>
            )}

            {serverPreview && hasCustomSampleOverrides && localSafePreview && !isSecurityLocked && (
              <div
                style={{
                  ...styles.previewFrame,
                  marginBottom: 10,
                  borderColor: '#CBD5E1',
                  background: 'var(--mn-surface-canvas, #f5f8f6)',
                }}
                data-testid="local-custom-override-preview"
              >
                <div style={styles.previewBadgeRow}>
                  <span style={styles.previewSourceBadge}>
                    Local Safe Preview (Your Custom Sample Overrides Preserved)
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--mn-text-secondary, #52655f)' }}>
                    {localSafePreview.characterCount} chars
                  </span>
                </div>
                {channel === 'EMAIL' && (
                  <div style={styles.previewSubjectBox}>
                    <strong>Custom-Sample Subject:</strong>{' '}
                    <span data-testid="local-custom-override-preview-subject">
                      {localSafePreview.renderedSubject || '(empty subject)'}
                    </span>
                  </div>
                )}
                <div
                  style={styles.previewBodyBox}
                  data-testid="local-custom-override-preview-body"
                >
                  {localSafePreview.renderedBody || '(empty message body)'}
                </div>
              </div>
            )}

            {displayedPreview && !isSecurityLocked && (
              <div style={styles.previewFrame} data-testid="rendered-preview-output">
                <div style={styles.previewBadgeRow}>
                  <span style={styles.previewSourceBadge}>
                    {serverPreview
                      ? 'Authoritative Server-Rendered Preview (Fixed Registry Samples)'
                      : hasCustomSampleOverrides
                        ? 'Local Safe Whitelist Preview (Custom Sample Overrides)'
                        : 'Local Safe Whitelist Preview'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--mn-text-secondary, #52655f)' }}>
                    {displayedPreview.characterCount} chars
                    {displayedPreview.estimatedSmsSegments !== null
                      ? ` · ${displayedPreview.estimatedSmsSegments} SMS segment(s)`
                      : ''}
                  </span>
                </div>
                {channel === 'EMAIL' ? (
                  <div
                    data-testid="safe-email-layout-preview"
                    style={{
                      background: '#F4F6F8',
                      padding: 12,
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--mn-text-primary, #132b25)',
                        marginBottom: 8,
                        padding: '6px 10px',
                        background: '#FFFFFF',
                        border: '1px solid var(--mn-border-subtle, #dde7e2)',
                        borderRadius: 4,
                      }}
                    >
                      <strong>Envelope Subject:</strong>{' '}
                      <span data-testid="rendered-preview-subject">
                        {displayedPreview.renderedSubject || '(empty subject)'}
                      </span>
                    </div>
                    <div
                      style={{
                        maxWidth: 600,
                        margin: '0 auto',
                        background: '#FFFFFF',
                        border: '1px solid var(--mn-border-subtle, #dde7e2)',
                        borderRadius: 8,
                        overflow: 'hidden',
                        fontFamily:
                          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      }}
                    >
                      <div
                        style={{
                          background: 'var(--mn-text-primary, #132b25)',
                          color: '#FFFFFF',
                          padding: '12px 18px',
                          fontSize: 15,
                          fontWeight: 700,
                          letterSpacing: '0.2px',
                        }}
                      >
                        MonieNaija
                      </div>
                      <div style={{ padding: '16px 18px', color: 'var(--mn-text-primary, #132b25)' }}>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: 'var(--mn-text-primary, #132b25)',
                            marginBottom: 10,
                          }}
                        >
                          {displayedPreview.renderedSubject || '(empty subject)'}
                        </div>
                        <div
                          data-testid="rendered-preview-body"
                          style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--mn-text-primary, #132b25)' }}
                        >
                          {(displayedPreview.renderedBody || '(empty message body)')
                            .split(/\n{2,}/)
                            .map((paragraph, pIdx) => (
                              <p
                                key={pIdx}
                                style={{ margin: '0 0 10px 0', whiteSpace: 'pre-wrap' }}
                              >
                                {paragraph}
                              </p>
                            ))}
                        </div>
                      </div>
                      <div
                        style={{
                          padding: '10px 18px',
                          background: 'var(--mn-surface-canvas, #f5f8f6)',
                          borderTop: '1px solid var(--mn-border-subtle, #dde7e2)',
                          fontSize: 11,
                          lineHeight: 1.45,
                          color: 'var(--mn-text-secondary, #52655f)',
                        }}
                      >
                        This is an automated service notification from MonieNaija. MonieNaija will
                        never ask for your PIN, password, one-time verification code, or
                        Cash-to-Cash secret code by email or phone.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={styles.previewBodyBox} data-testid="rendered-preview-body">
                    {displayedPreview.renderedBody || '(empty message body)'}
                  </div>
                )}
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
        id={`template-history-${channel}`} tabIndex={-1} className="mn-template-card"
        style={styles.card}
        aria-label={`${channel} template version history`}
        data-testid="template-version-history-section"
      >
        <div style={styles.labelRow}>
          <div><p className="mn-template-kicker">05 · VERSION RECORD</p><h3 style={styles.sectionTitle}>
            {channel} Template Version {activeVersionConfirmed ? 'History' : 'References'} ({matchingVersions.length})
          </h3></div>
          {permissions.canManageTemplates && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="text"
                aria-label="Version activation comment"
                placeholder="Optional rollback proposal note…"
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
            {templatesReadPending ? 'Loading template registry…' : templatesRegistryBlocked || templatesReadError ? 'Template registry unavailable; history cannot be confirmed.' : <>No persisted {channel} template versions exist yet for <code>{selectedEventType}</code>.</>}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }} role="region" aria-label={`${channel} template versions`} tabIndex={0}>
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
                  // INTEGRATION (Phase 5): proposing a governed TEMPLATE_ROLLBACK is a
                  // maker action; maker ≠ checker separation is enforced server-side when
                  // the FINANCE_CONTROLLER checker approves — a maker MAY propose rolling
                  // back a version they authored.
                  const canActivateRow =
                    permissions.canManageTemplates &&
                    permissions.hasMfaAssurance &&
                    activeVersionConfirmed && !isSubmitting && !activatingTemplateId && !pendingEventType &&
                    !ver.isActive && ver.sourceOrigin !== 'CODE_BASELINE';
                  const verifiedRegistry = !templatesReadPending && !templatesReadError && !templatesRegistryBlocked && ver.sourceOrigin !== 'CODE_BASELINE';

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
                            verifiedRegistry && ver.isActive
                              ? styles.activeChip
                              : ver.approvalStatus === 'PENDING_APPROVAL'
                                ? styles.pendingChip
                                : styles.mutedChip
                          }
                        >
                          {ver.sourceOrigin === 'CODE_BASELINE' ? 'REFERENCE · activation unconfirmed' : !verifiedRegistry ? 'STATE UNCONFIRMED' : ver.isActive ? 'ACTIVE' : ver.approvalStatus}
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
                              disabled={isSubmitting || Boolean(activatingTemplateId) || Boolean(pendingEventType)}
                              onClick={() => {
                                hasUserEditedRef.current = true;
                                setDraftBaseVersion(activeVersionConfirmed && activeVersion ? activeVersion.version : null);
                                if (channel === 'EMAIL') setSubject(ver.subject ?? '');
                                setBody(ver.body);
                              }}
                            >
                              Load v{ver.version}
                            </button>
                          )}
                          {activeVersionConfirmed && activeVersion && activeVersion.id !== ver.id && (
                            <button
                              type="button"
                              style={styles.secondarySmallBtn}
                              aria-label={`Compare version ${ver.version} with active version`}
                              onClick={() => setComparedVersion(ver)}
                            >
                              Compare
                            </button>
                          )}
                          {permissions.canManageTemplates && !ver.isActive && (
                            <button
                              type="button"
                              data-testid={`activate-version-${ver.version}`}
                              aria-label={`Propose rollback to version ${ver.version}`}
                              disabled={
                                !canActivateRow || activatingTemplateId === ver.id
                              }
                              title={
                                !permissions.hasMfaAssurance
                                  ? 'MFA session assurance required'
                                  : 'Creates a governed rollback proposal — a FINANCE_CONTROLLER checker must approve and execute it (Maker ≠ Checker enforced server-side)'
                              }
                              style={
                                canActivateRow
                                  ? styles.approveSmallBtn
                                  : styles.disabledSmallBtn
                              }
                              onClick={() => void handleActivateVersion(ver)}
                            >
                              {activatingTemplateId === ver.id
                                ? 'Proposing…'
                                : !permissions.hasMfaAssurance
                                  ? 'MFA Required'
                                  : 'Propose Rollback'}
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
        {comparedVersion && activeVersionConfirmed && activeVersion && (
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
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 10,
    padding: 18,
  },
  blockedBanner: {
    background: '#FFFBEB',
    border: '1px solid var(--mn-status-warning, #8c5600)',
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
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--mn-text-primary, #132b25)',
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
    background: 'var(--mn-surface-sunken, #eef3f0)',
    border: '1px solid #CBD5E1',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--mn-text-primary, #132b25)',
  },
  eventDescription: { margin: '10px 0 0 0', fontSize: 13, color: 'var(--mn-text-secondary, #52655f)' },
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
    gap: 16,
  },
  sectionTitle: { margin: '0 0 8px 0', fontSize: 16, fontWeight: 700, color: 'var(--mn-text-primary, #132b25)' },
  helperText: { margin: '0 0 12px 0', fontSize: 12, color: 'var(--mn-text-secondary, #52655f)', lineHeight: 1.45 },
  fieldGroup: { marginBottom: 14 },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  label: { fontSize: 13, fontWeight: 600, color: 'var(--mn-text-primary, #132b25)', display: 'block' },
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
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
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
    background: 'var(--mn-status-danger-bg, #fdebe9)',
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
    border: '1px solid var(--mn-status-warning, #8c5600)',
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
    background: 'var(--mn-text-primary, #132b25)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  primaryBtnDisabled: {
    background: 'var(--mn-text-muted, #5b6b66)',
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
    color: 'var(--mn-text-primary, #132b25)',
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
    background: 'var(--mn-surface-sunken, #eef3f0)',
    color: 'var(--mn-text-muted, #5b6b66)',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'not-allowed',
  },
  variableList: { display: 'flex', flexDirection: 'column', gap: 10 },
  variableCard: {
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 8,
    padding: '10px 12px',
    background: 'var(--mn-surface-canvas, #f5f8f6)',
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  previewFrame: {
    background: 'var(--mn-text-primary, #132b25)',
    color: 'var(--mn-surface-canvas, #f5f8f6)',
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
    background: 'var(--mn-text-primary, #132b25)',
    color: '#93C5FD',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  },
  previewSubjectBox: {
    paddingBottom: 8,
    marginBottom: 8,
    borderBottom: '1px solid var(--mn-text-primary, #132b25)',
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
    borderTop: '1px solid var(--mn-text-primary, #132b25)',
    color: '#FCD34D',
    fontSize: 12,
  },
  emptyBox: {
    padding: 14,
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    border: '1px dashed #CBD5E1',
    borderRadius: 8,
    fontSize: 13,
    color: 'var(--mn-text-secondary, #52655f)',
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
  activeChip: {
    background: '#DCFCE7',
    color: '#166534',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  pendingChip: {
    background: 'var(--mn-status-warning-bg, #fff3d9)',
    color: '#92400E',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  mutedChip: {
    background: 'var(--mn-surface-sunken, #eef3f0)',
    color: 'var(--mn-text-secondary, #52655f)',
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
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
    padding: 14,
  },
  compareGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 12,
    marginTop: 10,
  },
  compareCol: {
    background: '#FFFFFF',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 8,
    padding: 12,
  },
  compareHeader: { fontWeight: 700, fontSize: 12, color: 'var(--mn-text-primary, #132b25)', marginBottom: 6 },
  compareBody: { whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--mn-text-primary, #132b25)' },
};
