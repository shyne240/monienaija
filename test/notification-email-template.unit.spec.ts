import { NotificationTemplateService } from '../src/notification/notification-template.service';
import {
  CodeNotificationEmailTemplateService,
  escapeHtml,
  renderEmailLayout,
  sanitizeEmailSubject,
} from '../src/notification/notification-email-template.service';
import type { NotificationTemplateKey } from '../src/notification/notification.types';

/**
 * ARENA3-NOTIFICATION-EMAIL — email rendering seam unit tests (no network, no DB).
 *
 * Properties under test:
 * - SMS parity: the plain-text body is byte-identical to NotificationTemplateService
 *   .buildMessage for the same template key + payload (the SMS channel itself is untouched).
 * - Subject safety: per-key curated subjects; unmapped keys fall back to a GENERIC subject
 *   that never leaks internal event names (F-S3 parity); subjects are header-injection
 *   safe (no CR/LF/control chars) and bounded (≤200).
 * - HTML safety: every dynamic value is entity-escaped; no raw `</script>`, no raw `<`,
 *   template-injection markers (`{{`) stay inert text; fixed minimal layout with charset;
 *   text body is always present alongside html.
 */

describe('CodeNotificationEmailTemplateService (rendering seam)', () => {
  const templateService = new NotificationTemplateService();
  const emails = new CodeNotificationEmailTemplateService(templateService);

  it('1. plain-text body is byte-identical to buildMessage (SMS parity) for live keys', () => {
    const cases: Array<{ key: NotificationTemplateKey; payload: Record<string, unknown> }> = [
      { key: 'customer.funding.approved', payload: { reference: 'FND-1234', amountMinor: '25000' } },
      { key: 'customer.funding.rejected', payload: { reference: 'FND-1235' } },
      { key: 'customer.funding.requested', payload: { fundingRequestId: 'aaaaaaaa-bbbb-cccc' } },
      { key: 'transfer.completed', payload: { transferId: 'dddddddd-eeee-ffff', amountMinor: '10050' } },
      { key: 'transfer.failed', payload: { reference: 'TRF-9', amountMinor: '500' } },
      { key: 'support.ticket.created', payload: { reference: 'SUP-1' } },
      { key: 'support.ticket.status_changed', payload: { reference: 'SUP-2', status: 'IN_PROGRESS' } },
      { key: 'support.ticket.resolved', payload: { reference: 'SUP-3' } },
      { key: 'support.ticket.message_added', payload: { reference: 'SUP-4' } },
    ];
    for (const testCase of cases) {
      const rendered = emails.buildEmail(testCase.key, testCase.payload);
      expect(rendered.text).toBe(templateService.buildMessage(testCase.key, testCase.payload));
      expect(rendered.text.length).toBeGreaterThan(0);
      expect(rendered.html.length).toBeGreaterThan(0);
      expect(rendered.subject.length).toBeGreaterThan(0);
    }
  });

  it('2. curated subjects for live events; generic fallback never leaks event names', () => {
    expect(emails.buildEmail('transfer.completed', {}).subject).toBe('Transfer received');
    expect(emails.buildEmail('customer.funding.approved', {}).subject).toBe(
      'Funding approved — your wallet has been credited',
    );
    expect(emails.buildEmail('support.ticket.created', {}).subject).toBe(
      'We received your support request',
    );
    // Unmapped keys (not email-enabled, but the seam must stay safe for them):
    for (const key of ['cash_to_cash.created', 'agent.suspended', 'totally.unknown.event'] as Array<
      NotificationTemplateKey | string
    >) {
      const rendered = emails.buildEmail(key as NotificationTemplateKey, {});
      expect(rendered.subject).toBe('MonieNaija notification');
      expect(rendered.subject.toLowerCase()).not.toContain('cash_to_cash');
      expect(rendered.subject.toLowerCase()).not.toContain('agent.');
      expect(rendered.subject.toLowerCase()).not.toContain('unknown');
    }
  });

  it('3. HTML escaping — script/tag/attribute injection payloads stay inert text', () => {
    const hostile = `</script><script>alert(1)</script><img src=x onerror="pwn">{{constructor}}`;
    const rendered = emails.buildEmail('support.ticket.status_changed', {
      reference: hostile,
      status: hostile,
    });

    expect(rendered.html).not.toContain('</script>');
    expect(rendered.html).not.toContain('<script');
    // No live tag/attribute can be constructed: the injection payload survives only as
    // entity-escaped text (e.g. `&lt;img src=x onerror=&quot;pwn&quot;&gt;`).
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).not.toContain('onerror="');
    expect(rendered.html).toContain('&lt;/script&gt;');
    expect(rendered.html).toContain('onerror=&quot;pwn&quot;');
    expect(rendered.html).toContain('{{constructor}}'); // inert text, not a template directive
    // The raw hostile string must not survive unescaped anywhere in the body:
    expect(rendered.html).not.toContain(hostile);
  });

  it('4. layout is fixed, minimal and self-contained (doctype, charset, no external refs)', () => {
    const rendered = emails.buildEmail('transfer.completed', { transferId: 'abcdef12-34' });
    expect(rendered.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(rendered.html).toContain('<meta charset="utf-8">');
    expect(rendered.html).not.toContain('http://');
    expect(rendered.html).not.toContain('<script');
    expect(rendered.html).not.toContain('<link');
    expect(rendered.html).toContain('Transfer completed');
    // HTML always carries the equivalent plain-text body content (escaped).
    expect(rendered.html).toContain(escapeHtml(rendered.text.split('\n')[0]!.trim()));
  });

  it('5. sanitizeEmailSubject strips CRLF/control chars, collapses whitespace, caps at 200', () => {
    expect(sanitizeEmailSubject('Transfer\r\nBcc: evil@bad.com')).toBe('Transfer Bcc: evil@bad.com');
    expect(sanitizeEmailSubject('a\u0000b\u001fc')).toBe('a b c');
    expect(sanitizeEmailSubject('  many   spaces  ')).toBe('many spaces');
    expect(sanitizeEmailSubject('x'.repeat(500)).length).toBe(200);
    // Every curated subject is already sanitized (stable point).
    for (const key of [
      'customer.funding.approved',
      'transfer.completed',
      'support.ticket.created',
    ] as NotificationTemplateKey[]) {
      expect(emails.buildEmail(key, {}).subject).toBe(sanitizeEmailSubject(emails.buildEmail(key, {}).subject));
    }
  });

  it('6. escapeHtml covers all five significant characters', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });

  it('7. renderEmailLayout handles empty text with a safe fallback paragraph', () => {
    const html = renderEmailLayout('Heading', '');
    expect(html).toContain('MonieNaija notification.');
    expect(html).toContain(escapeHtml('Heading'));
  });
});
