import type {
  ParsedSettlementReport,
  SettlementFileFormat,
  SettlementReportFormatDescriptor,
  SettlementReportType,
} from '../settlement-reconciliation.types';

export interface ParseSettlementReportInput {
  readonly reportType: SettlementReportType;
  readonly fileName: string;
  readonly content: string;
  readonly defaultCurrency?: string;
}

/**
 * Provider-specific report parsing boundary.
 *
 * Adding a new external report source (for example NIBSS NIP settlement/transaction files or a
 * specific Nigerian commercial bank's corporate statement export) requires implementing this
 * interface and registering the adapter in `SettlementReportAdapterRegistry`. The matching engine,
 * persistence layer, audit trail, and Admin Web workspace operate strictly on normalized rows.
 */
export interface SettlementReportProviderAdapter {
  readonly providerKey: string;
  readonly displayName: string;
  readonly formatDescriptors: readonly SettlementReportFormatDescriptor[];

  supports(reportType: SettlementReportType, fileFormat?: SettlementFileFormat): boolean;

  parse(input: ParseSettlementReportInput): ParsedSettlementReport;
}
