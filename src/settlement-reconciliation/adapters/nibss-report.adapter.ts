import { BadRequestException } from '@nestjs/common';

import type {
  ParsedSettlementReport,
  SettlementFileFormat,
  SettlementReportFormatDescriptor,
  SettlementReportType,
} from '../settlement-reconciliation.types';
import type {
  ParseSettlementReportInput,
  SettlementReportProviderAdapter,
} from './settlement-report-adapter.interface';

/**
 * Future-ready NIBSS NIP report adapter stub.
 *
 * Keeps provider-specific parsing strictly behind `SettlementReportProviderAdapter` so NIBSS NIP
 * settlement and outward/inward session reports can be added by implementing `parse()` here with
 * verified NIBSS settlement schedules — without changing the database schema, matching engine,
 * Finance review workflows, or Admin Web workspace.
 */
export class NibssSettlementReportAdapter implements SettlementReportProviderAdapter {
  readonly providerKey = 'NIBSS_NIP';
  readonly displayName = 'NIBSS NIP (Planned Adapter)';

  readonly formatDescriptors: readonly SettlementReportFormatDescriptor[] = [
    {
      providerKey: 'NIBSS_NIP',
      providerDisplayName: 'NIBSS NIP (Planned Adapter)',
      reportType: 'COLLECTIONS',
      fileFormat: 'CSV',
      supported: false,
      verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
      documentedSource: 'NIBSS NIP Inward Settlement Schedule (pending redacted institutional export)',
      missingSampleNeeded:
        'Redacted NIBSS NIP Inward Transaction & Settlement Schedule export',
      note: 'Registered behind the shared adapter interface for future NIBSS integration; parsing remains disabled until an official redacted NIBSS schedule is supplied.',
    },
    {
      providerKey: 'NIBSS_NIP',
      providerDisplayName: 'NIBSS NIP (Planned Adapter)',
      reportType: 'PAYOUTS',
      fileFormat: 'CSV',
      supported: false,
      verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
      documentedSource: 'NIBSS NIP Outward Settlement Schedule (pending redacted institutional export)',
      missingSampleNeeded:
        'Redacted NIBSS NIP Outward Transaction & Settlement Schedule export',
      note: 'Registered behind the shared adapter interface for future NIBSS integration; parsing remains disabled until an official redacted NIBSS schedule is supplied.',
    },
    {
      providerKey: 'NIBSS_NIP',
      providerDisplayName: 'NIBSS NIP (Planned Adapter)',
      reportType: 'SETTLEMENTS',
      fileFormat: 'CSV',
      supported: false,
      verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
      documentedSource: 'NIBSS NIP Cycle Settlement Summary (pending redacted institutional export)',
      missingSampleNeeded: 'Redacted NIBSS NIP Cycle Settlement Summary export',
      note: 'Registered behind the shared adapter interface for future NIBSS integration.',
    },
  ];

  supports(reportType: SettlementReportType, fileFormat?: SettlementFileFormat): boolean {
    return this.formatDescriptors.some(
      (item) =>
        item.reportType === reportType &&
        item.supported &&
        (fileFormat === undefined || item.fileFormat === fileFormat),
    );
  }

  parse(input: ParseSettlementReportInput): ParsedSettlementReport {
    void input;
    throw new BadRequestException(
      'NIBSS_NIP report parsing is not yet enabled: supply a verified redacted NIBSS NIP settlement schedule to activate this adapter.',
    );
  }
}
