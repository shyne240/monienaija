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

  it('3. HTML safety — hostile variables are blocked upstream AND escaping neutralizes direct input', () => {
    const hostile = `</script><script>alert(1)</script><img src=x onerror="pwn">{{constructor}}`;

    // Layer 1 (Arena 1 registry integration): the allowlisted variable resolvers refuse
    // hostile reference/status payload values — they never reach the rendered message at all.
    const rendered = emails.buildEmail('support.ticket.status_changed', {
      reference: hostile,
      status: hostile,
    });
    expect(rendered.text).not.toContain('script');
    expect(rendered.text).not.toContain('onerror');
    expect(rendered.html).not.toContain('</script>');
    expect(rendered.html).not.toContain('<script');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).not.toContain('onerror="');

    // Layer 2 (email rendering): even text that DID contain markup (e.g. a future variable
    // resolver or registry body) is entity-escaped by the fixed layout — no live tags.
    const direct = renderEmailLayout('Heading', hostile);
    expect(direct).not.toContain('</script>');
    expect(direct).not.toContain('<script');
    expect(direct).not.toContain('<img');
    expect(direct).not.toContain('onerror="');
    expect(direct).toContain('&lt;/script&gt;');
    expect(direct).toContain('onerror=&quot;pwn&quot;');
    expect(direct).toContain('{{constructor}}'); // inert text, not a template directive
    expect(direct).not.toContain(hostile);
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
