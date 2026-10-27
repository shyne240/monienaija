import { Injectable } from '@nestjs/common';
import { NotificationTemplateService } from './notification-template.service';
import type {
  NotificationEmailTemplateLookup,
  NotificationTemplateKey,
  NotificationTemplatePayload,
  RenderedEmail,
} from './notification.types';

/**
 * ARENA3-NOTIFICATION-EMAIL — email rendering seam (default code-backed implementation).
 *
 * COORDINATION CONTRACT WITH ARENA 1 (recorded per the Arena 1 template-registry
 * decision — NOT a competing registry):
 * - Arena 1 owns the canonical event/template configuration and the future
 *   database-backed template registry. When it lands, its email rendering service must
 *   implement `NotificationEmailTemplateLookup` (notification.types.ts) and be provided
 *   under `NOTIFICATION_EMAIL_TEMPLATE_TOKEN` (notification.constants.ts), replacing the
 *   binding registered in NotificationModule.
 * - The dispatcher and worker consume ONLY this token/interface:
 *     buildEmail(templateKey, payload) -> { subject, text, html }
 *   so swapping registries requires zero changes to delivery, retry, idempotency or
 *   channel-resolution code.
 * - `templateKey` values are the existing NotificationTemplateKey union; payload keys
 *   are the existing redacted payload contract (notification-event-map.ts).
 * - The plain-text body stays byte-identical to `NotificationTemplateService.buildMessage`
 *   (SMS parity — the SMS channel and its 20-case switch are untouched), so recipients
 *   on either channel receive the same wording.
 *
 * SAFETY PROPERTIES:
 * - ALL dynamic values are HTML-entity-escaped before entering markup; no raw payload
 *   interpolation; no untrusted CSS; fixed minimal inline-styled layout.
 * - Subject fallback is generic — it never leaks internal event names (F-S3 parity).
 * - Subjects are sanitized against header injection (CR/LF/control chars) and bounded.
 * - HTML email always carries the equivalent plain-text body (text never empty).
 */

const GENERIC_SUBJECT = 'MonieNaija notification';

const SUBJECT_MAP: Readonly<Partial<Record<NotificationTemplateKey, string>>> = {
  'customer.funding.requested': 'Funding request received',
  'customer.funding.approved': 'Funding approved — your wallet has been credited',
  'customer.funding.rejected': 'Funding request declined',
  'transfer.completed': 'Transfer received',
  'transfer.failed': 'Transfer did not complete',
  'support.ticket.created': 'We received your support request',
  'support.ticket.assigned': 'Update on your support request',
  'support.ticket.status_changed': 'Update on your support request',
  'support.ticket.resolved': 'Your support request was resolved',
  'support.ticket.closed': 'Your support request was closed',
  'support.ticket.message_added': 'New message on your support request',
  // Deliberately NOT listed event-name fallbacks: any unmapped key (cash_to_cash.*,
  // agent.*, future keys) resolves to GENERIC_SUBJECT — no internal event names in
  // customer-visible email (F-S3 parity).
};

@Injectable()
export class CodeNotificationEmailTemplateService implements NotificationEmailTemplateLookup {
  constructor(private readonly templateService: NotificationTemplateService) {}

  buildEmail(
    templateKey: NotificationTemplateKey,
    payload: NotificationTemplatePayload,
  ): RenderedEmail {
    const text = this.templateService.buildMessage(templateKey, payload);
    const rawSubject = SUBJECT_MAP[templateKey] ?? GENERIC_SUBJECT;
    return {
      subject: sanitizeEmailSubject(rawSubject),
      text,
      html: renderEmailLayout(rawSubject, text),
    };
  }
}

/** Escape the five HTML-significant characters — applied to EVERY dynamic value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Header-injection protection + bound for email subjects: CR/LF and control characters
 * become spaces, runs of whitespace collapse, length capped at 200.
 */
export function sanitizeEmailSubject(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Fixed minimal HTML layout (no external resources, no scripts, no dynamic styles).
 * Lines are derived by splitting the ALREADY-REDACTED plain-text body; each line is
 * entity-escaped. Kept deliberately simple — the plain-text body carries the full message.
 */
export function renderEmailLayout(heading: string, text: string): string {
  const paragraphs = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p style="margin:0 0 10px 0;font-size:15px;line-height:1.5;color:#111827;">${escapeHtml(line)}</p>`)
    .join('');
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(heading)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">',
    '<tr><td>',
    `<h1 style="margin:0 0 16px 0;font-size:18px;color:#111827;">${escapeHtml(heading)}</h1>`,
    paragraphs || '<p style="margin:0;font-size:15px;color:#111827;">MonieNaija notification.</p>',
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">',
    '<p style="margin:0;font-size:12px;color:#6b7280;">MonieNaija automated notification — please do not reply to this message.</p>',
    '</td></tr></table>',
    '</body></html>',
  ].join('');
}
