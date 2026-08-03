import { Controller, Get, Post } from '@nestjs/common';

import { MaturityService } from './maturity.service';
import { OperationalReportService } from './operational-report.service';

@Controller('internal')
export class MaturityController {
  constructor(
    private readonly maturityService: MaturityService,
    private readonly reports: OperationalReportService,
  ) {}

  @Get('health-dashboard')
  healthDashboard() {
    return this.maturityService.healthDashboard();
  }

  @Get('acceptance')
  acceptance() {
    return this.maturityService.acceptance();
  }

  @Get('maintenance/preview')
  maintenancePreview() {
    return this.maturityService.previewRetention();
  }

  @Post('maintenance/execute')
  maintenanceExecute() {
    return this.maturityService.executeRetention();
  }

  @Get('reports/daily')
  daily() {
    return this.reports.dailySummary();
  }

  @Get('reports/ledger')
  ledger() {
    return this.reports.ledgerSummary();
  }

  @Get('reports/wallets')
  wallets() {
    return this.reports.walletSummary();
  }

  @Get('reports/transfers')
  transfers() {
    return this.reports.transferSummary();
  }

  @Get('reports/deposits')
  deposits() {
    return this.reports.depositSummary();
  }

  @Get('reports/withdrawals')
  withdrawals() {
    return this.reports.withdrawalSummary();
  }

  @Get('reports/reconciliation')
  reconciliation() {
    return this.reports.reconciliationSummary();
  }

  @Get('reports/outbox')
  outbox() {
    return this.reports.outboxSummary();
  }

  @Get('reports/audit')
  audit() {
    return this.reports.auditSummary();
  }
}
