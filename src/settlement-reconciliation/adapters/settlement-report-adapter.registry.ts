import { BadRequestException, Injectable } from '@nestjs/common';

import type {
  SettlementFileFormat,
  SettlementReportFormatDescriptor,
  SettlementReportType,
} from '../settlement-reconciliation.types';
import type {
  ParseSettlementReportInput,
  SettlementReportProviderAdapter,
} from './settlement-report-adapter.interface';

@Injectable()
export class SettlementReportAdapterRegistry {
  private readonly adapters = new Map<string, SettlementReportProviderAdapter>();

  constructor(initialAdapters: readonly SettlementReportProviderAdapter[] = []) {
    for (const adapter of initialAdapters) {
      this.register(adapter);
    }
  }

  register(adapter: SettlementReportProviderAdapter): void {
    const key = adapter.providerKey.trim().toUpperCase();
    this.adapters.set(key, adapter);
  }

  find(providerKey: string): SettlementReportProviderAdapter | undefined {
    return this.adapters.get(providerKey.trim().toUpperCase());
  }

  requireAdapter(providerKey: string): SettlementReportProviderAdapter {
    const adapter = this.find(providerKey);
    if (!adapter) {
      throw new BadRequestException(`Unsupported settlement report provider: ${providerKey}`);
    }
    return adapter;
  }

  getOrThrow(providerKey: string): SettlementReportProviderAdapter {
    return this.requireAdapter(providerKey);
  }

  listProviders(): Array<{
    providerKey: string;
    displayName: string;
    formatDescriptors: readonly SettlementReportFormatDescriptor[];
  }> {
    return [...this.adapters.values()].map((adapter) => ({
      providerKey: adapter.providerKey,
      displayName: adapter.displayName,
      formatDescriptors: adapter.formatDescriptors,
    }));
  }

  listFormatDescriptors(): SettlementReportFormatDescriptor[] {
    return [...this.adapters.values()].flatMap((adapter) => [...adapter.formatDescriptors]);
  }

  supports(
    providerKey: string,
    reportType: SettlementReportType,
    fileFormat?: SettlementFileFormat,
  ): boolean {
    const adapter = this.find(providerKey);
    return adapter ? adapter.supports(reportType, fileFormat) : false;
  }

  parse(providerKey: string, input: ParseSettlementReportInput) {
    const adapter = this.requireAdapter(providerKey);
    return adapter.parse(input);
  }
}
