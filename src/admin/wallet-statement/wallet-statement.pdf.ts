import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// `pdfkit` is CommonJS; the namespace import is what works under both ts-jest and `nest build`.
import * as PDFDocument from 'pdfkit';

import {
  formatMoney,
  formatSignedMoney,
  groupedDecimal,
  lagosDateTime,
  LAGOS_TIME_ZONE,
  statementReference,
} from './wallet-statement.format';
import type { WalletStatementDocument } from './wallet-statement.types';

/**
 * Branded wallet statement PDF.
 *
 * This module is layout only. It receives an already-authorised, already-scoped document and turns
 * it into pages; it never queries, never decides what is visible, and never fills a gap. A `null`
 * balance is printed as the word "Unavailable", because a document that shows `NGN 0.00` where the
 * ledger could not answer is actively misleading about money.
 *
 * ## Why PDFKit with an embedded font
 *
 * The document has to render the Naira sign, the mask bullets and ordinary punctuation. The PDF base
 * 14 fonts do not carry `₦`, and a statement that prints `#` or a blank box for the currency is not
 * acceptable on a financial document, so a Unicode TTF (DejaVu Sans, packaged as a dependency and
 * therefore present in every deployment) is embedded and subset. `pdfkit` also gives explicit
 * control of page breaks, which is what makes "the table never splits a row across pages" provable.
 */

export const STYLE = {
  margin: 42,
  headerHeight: 96,
  footerHeight: 42,
  accent: '#0B6B45',
  accentSoft: '#E7F2EC',
  ink: '#14211C',
  muted: '#5C6B65',
  rule: '#CBDCD3',
  rowStripe: '#F6FAF7',
  bodySize: 8.5,
  smallSize: 7.5,
  titleSize: 17,
} as const;

/** Page geometry for A4, in points. */
export const PAGE = { width: 595.28, height: 841.89 } as const;

/**
 * Column widths in points, summing to the A4 content width (595.28 - 2 × 42 = 511.28).
 *
 * The date column holds a full `YYYY-MM-DD HH:mm` Lagos stamp: a truncated date on a financial
 * statement is worse than a narrower narration, so the date gets the space and the description
 * ellipsises instead.
 */
const COLUMNS = [
  { key: 'date', label: 'Date (Lagos)', width: 88, align: 'left' as const },
  { key: 'reference', label: 'Reference', width: 96, align: 'left' as const },
  { key: 'description', label: 'Description', width: 131, align: 'left' as const },
  { key: 'debit', label: 'Debit', width: 62, align: 'right' as const },
  { key: 'credit', label: 'Credit', width: 62, align: 'right' as const },
  { key: 'balance', label: 'Balance', width: 72, align: 'right' as const },
] as const;

export interface StatementAssets {
  /** Approved brand mark (PNG). Omitted from the document when absent, never faked. */
  readonly logoPath?: string;
  readonly regularFontPath: string;
  readonly boldFontPath: string;
}

/**
 * Resolves the brand mark and the fonts from the repository, so a deployment that ships the files
 * always renders a complete document and a developer running from source does too.
 */
export function defaultStatementAssets(): StatementAssets {
  const candidates = [
    join(process.cwd(), 'apps/admin-web/public/favicon.png'),
    join(__dirname, '../../../../apps/admin-web/public/favicon.png'),
  ];
  const logoPath = candidates.find((candidate) => existsSync(candidate));
  return {
    ...(logoPath ? { logoPath } : {}),
    regularFontPath: require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'),
    boldFontPath: require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'),
  };
}

/** Truncates to a column width using the embedded font's real metrics, not a character guess. */
function fit(doc: PDFKit.PDFDocument, text: string, width: number): string {
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

export interface RenderedStatement {
  readonly pdf: Buffer;
  readonly pageCount: number;
}

/**
 * Renders the statement.
 *
 * Layout invariants, each of which the tests and the browser acceptance check:
 *  - the brand header appears on every page, so a detached page is still attributable;
 *  - the table header repeats after every page break;
 *  - a row is never split: a row that does not fit moves whole to the next page;
 *  - every page carries "Page n of m", which requires measuring before drawing, so the document is
 *    rendered twice in memory — a draft pass to learn the page count, then the real pass.
 */
export async function renderWalletStatement(
  statement: WalletStatementDocument,
  assets: StatementAssets = defaultStatementAssets(),
): Promise<RenderedStatement> {
  const logo =
    assets.logoPath && existsSync(assets.logoPath) ? readFileSync(assets.logoPath) : null;
  const draft = await layout(statement, assets, logo, { countOnly: true });
  const final = await layout(statement, assets, logo, {
    countOnly: false,
    pageCount: draft.pageCount,
  });
  return { pdf: final.pdf, pageCount: final.pageCount };
}

async function layout(
  statement: WalletStatementDocument,
  assets: StatementAssets,
  logo: Buffer | null,
  mode: { countOnly: boolean; pageCount?: number },
): Promise<RenderedStatement> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: STYLE.margin,
    bufferPages: true,
    info: {
      Title: `MonieNaija wallet statement ${statement.header.walletLabel}`,
      Author: 'MonieNaija',
      Subject: `Wallet statement ${statement.header.periodFrom} to ${statement.header.periodTo}`,
      Creator: 'MonieNaija Admin Web',
    },
  });
  doc.registerFont('body', assets.regularFontPath);
  doc.registerFont('bold', assets.boldFontPath);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = STYLE.margin;
  const contentWidth = PAGE.width - STYLE.margin * 2;
  const bottom = PAGE.height - STYLE.margin - STYLE.footerHeight;
  let pages = 0;
  let firstPage = true;

  const drawHeader = () => {
    pages += 1;
    const top = STYLE.margin;
    if (logo) {
      try {
        doc.image(logo, left, top, { fit: [44, 44] });
      } catch {
        // A corrupt mark must not cost the operator the document; the header text still brands it.
      }
    }
    doc
      .font('bold')
      .fontSize(STYLE.titleSize)
      .fillColor(STYLE.accent)
      .text('MonieNaija', left + 56, top + 2, { lineBreak: false });
    doc
      .font('body')
      .fontSize(STYLE.smallSize)
      .fillColor(STYLE.muted)
      .text('Customer wallet statement', left + 56, top + 24, { lineBreak: false });
    doc
      .font('bold')
      .fontSize(STYLE.smallSize)
      .fillColor(STYLE.ink)
      .text(statement.header.walletLabel, left, top + 6, {
        width: contentWidth,
        align: 'right',
        lineBreak: false,
      });
    doc
      .font('body')
      .fontSize(STYLE.smallSize)
      .fillColor(STYLE.muted)
      .text(
        `${statement.header.currency} wallet · ${statement.header.walletStatus}`,
        left,
        top + 24,
        {
          width: contentWidth,
          align: 'right',
          lineBreak: false,
        },
      );
    doc
      .moveTo(left, top + 52)
      .lineTo(left + contentWidth, top + 52)
      .lineWidth(1)
      .strokeColor(STYLE.accent)
      .stroke();

    // Period and generation stamp: which days this document covers, and when it was produced.
    doc
      .font('body')
      .fontSize(STYLE.smallSize)
      .fillColor(STYLE.muted)
      .text(
        `Period ${statement.header.periodFrom} to ${statement.header.periodTo} (${LAGOS_TIME_ZONE}) · ` +
          `Generated ${lagosDateTime(statement.header.generatedAt)} (Lagos)`,
        left,
        top + 62,
        { width: contentWidth, lineBreak: false },
      );
    return top + STYLE.headerHeight;
  };

  const drawFooter = () => {
    doc
      .font('body')
      .fontSize(STYLE.smallSize)
      .fillColor(STYLE.muted)
      .text(
        `MonieNaija · statement ${statementReference(statement.header.statementId)} · ` +
          'figures derive from posted ledger entries only',
        left,
        PAGE.height - STYLE.margin - 20,
        { width: contentWidth - 90, lineBreak: false },
      );
    doc
      .font('bold')
      .fontSize(STYLE.smallSize)
      .fillColor(STYLE.muted)
      .text(
        `Page ${pages} of ${mode.pageCount ?? pages}`,
        left + contentWidth - 90,
        PAGE.height - STYLE.margin - 20,
        {
          width: 90,
          align: 'right',
          lineBreak: false,
        },
      );
  };

  const newPage = () => {
    drawFooter();
    doc.addPage();
    return drawHeader();
  };

  let y = drawHeader();

  // ── Customer and balance summary (first page only) ────────────────────────────────────────────
  if (firstPage) {
    firstPage = false;
    doc.font('bold').fontSize(11).fillColor(STYLE.ink).text(statement.header.customerName, left, y);
    doc
      .font('body')
      .fontSize(STYLE.smallSize)
      .fillColor(STYLE.muted)
      .text(
        `${statement.header.currency} wallet ${statement.header.walletLabel} · ${statement.header.walletStatus}`,
        left,
        y + 15,
      );
    y += 38;

    const cards: Array<[string, string]> = [
      [
        'Opening balance',
        moneyOrUnavailable(statement.balances.openingMinor, statement.header.currency),
      ],
      ['Money in', moneyOrUnavailable(statement.balances.creditsMinor, statement.header.currency)],
      ['Money out', moneyOrUnavailable(statement.balances.debitsMinor, statement.header.currency)],
      [
        'Closing balance',
        moneyOrUnavailable(statement.balances.closingMinor, statement.header.currency),
      ],
    ];
    const cardWidth = (contentWidth - 18) / 4;
    cards.forEach((card, index) => {
      const x = left + index * (cardWidth + 6);
      doc.roundedRect(x, y, cardWidth, 44, 4).fillAndStroke(STYLE.accentSoft, STYLE.rule);
      doc
        .font('body')
        .fontSize(STYLE.smallSize)
        .fillColor(STYLE.muted)
        .text(card[0], x + 8, y + 7, { width: cardWidth - 16, lineBreak: false });
      doc
        .font('bold')
        .fontSize(9)
        .fillColor(STYLE.ink)
        .text(fit(doc, card[1], cardWidth - 16), x + 8, y + 21, {
          width: cardWidth - 16,
          lineBreak: false,
        });
    });
    y += 56;

    doc
      .font('body')
      .fontSize(STYLE.smallSize)
      .fillColor(STYLE.muted)
      .text(
        `Ledger-derived balance at generation: ${moneyOrUnavailable(
          statement.balances.currentMinor,
          statement.header.currency,
        )}. Figures are taken from posted ledger entries only; they are not estimates.`,
        left,
        y,
        { width: contentWidth },
      );
    y += 24;
  }

  // ── Activity table ────────────────────────────────────────────────────────────────────────────
  const drawTableHeader = (top: number): number => {
    doc.rect(left, top, contentWidth, 16).fill(STYLE.accentSoft);
    doc.font('bold').fontSize(STYLE.smallSize).fillColor(STYLE.ink);
    let x = left;
    for (const column of COLUMNS) {
      doc.text(column.label, x + 3, top + 4.5, {
        width: column.width - 6,
        align: column.align,
        lineBreak: false,
      });
      x += column.width;
    }
    return top + 18;
  };

  y = drawTableHeader(y);

  if (statement.rows.length === 0) {
    doc
      .font('body')
      .fontSize(STYLE.bodySize)
      .fillColor(STYLE.muted)
      .text(
        statement.balances.openingMinor === null
          ? 'No posted wallet activity in this period. Balances are unavailable for this wallet.'
          : 'No posted wallet activity in this period.',
        left + 3,
        y + 6,
      );
    y += 24;
  }

  for (const [index, row] of statement.rows.entries()) {
    const rowHeight = 15;
    if (y + rowHeight > bottom) {
      y = newPage();
      y = drawTableHeader(y);
    }
    if (index % 2 === 1) {
      doc.rect(left, y, contentWidth, rowHeight).fill(STYLE.rowStripe);
    }
    const cells: Record<(typeof COLUMNS)[number]['key'], string> = {
      date: lagosDateTime(row.postedAt),
      // A journal without a business reference prints an explicit marker; the journal id is never
      // printed as a substitute.
      reference: row.reference?.trim() ? row.reference.trim() : '—',
      description: row.description ?? '—',
      debit:
        row.signedMinor !== null && row.signedMinor.startsWith('-')
          ? groupedDecimal(row.amountMinor)
          : '',
      credit:
        row.signedMinor !== null && !row.signedMinor.startsWith('-')
          ? groupedDecimal(row.amountMinor)
          : '',
      balance: row.runningMinor === null ? 'Unavailable' : groupedDecimal(row.runningMinor),
    };
    let x = left;
    doc.font('body').fontSize(STYLE.bodySize).fillColor(STYLE.ink);
    for (const column of COLUMNS) {
      const raw = cells[column.key];
      const text =
        column.key === 'description'
          ? fit(doc, raw, column.width - 6)
          : fit(doc, raw, column.width - 6);
      doc.fillColor(raw === 'Unavailable' ? STYLE.muted : STYLE.ink);
      doc.text(text, x + 3, y + 4, {
        width: column.width - 6,
        align: column.align,
        lineBreak: false,
        ellipsis: false,
      });
      x += column.width;
    }
    doc
      .moveTo(left, y + rowHeight)
      .lineTo(left + contentWidth, y + rowHeight)
      .lineWidth(0.4)
      .strokeColor(STYLE.rule)
      .stroke();
    y += rowHeight;
  }

  if (statement.rows.length > 0) {
    if (y + 20 > bottom) y = newPage();
    doc
      .moveTo(left, y + 2)
      .lineTo(left + contentWidth, y + 2)
      .lineWidth(1)
      .strokeColor(STYLE.accent)
      .stroke();
    doc
      .font('bold')
      .fontSize(STYLE.bodySize)
      .fillColor(STYLE.ink)
      .text(
        `Closing balance ${moneyOrUnavailable(statement.balances.closingMinor, statement.header.currency)}`,
        left,
        y + 7,
        { width: contentWidth, align: 'right' },
      );
    y += 26;
  }

  drawFooter();
  doc.end();
  const pdf = await done;
  return { pdf, pageCount: pages };
}

/**
 * A figure the ledger supports is printed exactly. A figure it does not support is printed as
 * "Unavailable" — never `0`, and never an empty cell that reads as zero.
 */
export function moneyOrUnavailable(minor: string | null, currency: string): string {
  return minor === null ? 'Unavailable' : formatMoney(minor, currency);
}

/** Signed rendering used by the on-screen preview, so screen and document use one rule set. */
export function signedOrUnavailable(minor: string | null, currency: string): string {
  return minor === null ? 'Unavailable' : formatSignedMoney(minor, currency);
}
