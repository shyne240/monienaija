import { renderWalletStatement, STYLE } from './wallet-statement.pdf';
import type { WalletStatementDocument, WalletStatementRow } from './wallet-statement.types';

/**
 * The document's structure.
 *
 * These assertions read the produced PDF bytes, because the artefact is what a customer receives.
 * Content-level assertions (headings, the Naira sign, "Unavailable", page numbering) are deliberately
 * *not* here: PDFKit compresses content streams and subsets the embedded font, so asserting on raw
 * bytes would test an encoding rather than a document. Those are checked against the real file with a
 * real PDF parser in `scripts/wallet-statement-acceptance.cjs`, which is the stronger test anyway.
 */

function row(index: number, overrides: Partial<WalletStatementRow> = {}): WalletStatementRow {
  const amount = String(1000 + index);
  return {
    postedAt: new Date(Date.UTC(2026, 10, 2, 9, 0, index)).toISOString(),
    reference: `REF-${String(index).padStart(4, '0')}`,
    description: `Wallet transfer ${index}`,
    amountMinor: amount,
    direction: 'CREDIT',
    signedMinor: amount,
    runningMinor: String((index + 1) * 1000),
    ...overrides,
  };
}

function statement(
  rows: WalletStatementRow[],
  overrides: Partial<WalletStatementDocument['balances']> = {},
): WalletStatementDocument {
  return {
    header: {
      customerName: 'Ada Obi',
      walletLabel: '•••• 5A6B',
      currency: 'NGN',
      walletStatus: 'ACTIVE',
      periodFrom: '2026-11-01',
      periodTo: '2026-11-30',
      generatedAt: '2026-11-30T12:00:00.000Z',
      statementId: '6c1a1f70-1111-4222-8333-444455556666',
    },
    balances: {
      openingMinor: '0',
      closingMinor: String(rows.length * 1000),
      creditsMinor: String(rows.length * 1000),
      debitsMinor: '0',
      currentMinor: String(rows.length * 1000),
      ...overrides,
    },
    rows,
  };
}

/** Counts page objects. PDFKit's page dictionaries are uncompressed, so this is exact. */
function pageObjects(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

describe('Wallet statement PDF structure', () => {
  test('is a valid A4 portrait PDF of exactly one page for a short statement', async () => {
    const { pdf, pageCount } = await renderWalletStatement(statement([row(0)]));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(pageCount).toBe(1);
    expect(pageObjects(pdf)).toBe(1);
    expect(STYLE.margin).toBeGreaterThanOrEqual(36);
  });

  test('paginates as the activity grows, and reports the page count it wrote', async () => {
    const pages = [];
    for (const count of [1, 40, 120]) {
      const rows = Array.from({ length: count }, (_unused, index) => row(index));
      const rendered = await renderWalletStatement(statement(rows));
      pages.push(rendered.pageCount);
      // The declared count is the number of pages actually present in the file.
      expect(pageObjects(rendered.pdf)).toBe(rendered.pageCount);
    }
    expect(pages[0]).toBe(1);
    expect(pages[1]).toBeGreaterThan(1);
    expect(pages[2]).toBeGreaterThan(pages[1]!);
  });

  test('embeds the approved brand mark, and still renders when it is absent', async () => {
    const withLogo = await renderWalletStatement(statement([row(0)]));
    expect(withLogo.pdf.toString('latin1')).toContain('/Subtype /Image');

    const withoutLogo = await renderWalletStatement(statement([row(0)]), {
      regularFontPath: require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'),
      boldFontPath: require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'),
    });
    expect(withoutLogo.pageCount).toBe(1);
    expect(pageObjects(withoutLogo.pdf)).toBe(1);
  });

  test('document metadata identifies the wallet by its mask, never by its id', async () => {
    const { pdf } = await renderWalletStatement(statement([row(0)]));
    const text = pdf.toString('latin1');
    // PDFKit writes the title as a UTF-16BE string object (it contains the mask bullets), so the
    // metadata is located through /Title n 0 R and its UTF-16 payload rather than assumed ASCII.
    const titleRef = /\/Title (\d+) 0 R/.exec(text)?.[1];
    expect(titleRef).toBeDefined();
    const titleObject =
      new RegExp(`(?:^|\\n)${titleRef} 0 obj\\n([\\s\\S]*?)endobj`).exec(text)?.[1] ?? '';
    /** Resolves PDF literal-string escapes (octal, escaped parens) back to bytes. */
    const unescaped = titleObject.replace(/\\(\d{1,3}|[()\\])/g, (_all, escape: string) =>
      /^\d+$/.test(escape) ? String.fromCharCode(parseInt(escape, 8)) : escape,
    );
    const title = Buffer.from(
      unescaped.replace(/^[\s\S]*?(\u00fe\u00ff)/, '').replace(/\).*$/s, ''),
      'latin1',
    );
    // UTF-16BE title bytes: byte-swap, decode, and drop the padding NULs (split/join avoids a
    // control character in a regular expression, which the shared lint rules reject).
    const decoded = Buffer.from(title).swap16().toString('utf16le').split('\u0000').join('');
    expect(decoded).toContain('MonieNaija wallet statement');
    expect(decoded).toContain('5A6B');
    // No UUID anywhere in the document's metadata objects.
    const info = text.slice(text.indexOf('/Producer'), text.indexOf('/Producer') + 900);
    expect(info).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  test('renders every balance as unavailable without failing the document', async () => {
    // The point: an unsupported balance must not stop the operator getting the activity table.
    const { pdf, pageCount } = await renderWalletStatement(
      statement([row(0, { signedMinor: null, runningMinor: null })], {
        openingMinor: null,
        closingMinor: null,
        creditsMinor: null,
        debitsMinor: null,
        currentMinor: null,
      }),
    );
    expect(pageCount).toBe(1);
    expect(pdf.length).toBeGreaterThan(1_000);
  });

  test('an empty period is a complete document, not an error', async () => {
    const { pdf, pageCount } = await renderWalletStatement(
      statement([], { closingMinor: '0', creditsMinor: '0', currentMinor: '0' }),
    );
    expect(pageCount).toBe(1);
    expect(pageObjects(pdf)).toBe(1);
  });
});
