import { Module } from '@nestjs/common';

import { ComplianceAuditExportService } from './compliance-audit-export.service';

/**
 * ARENA 3D Group 23 — compliance register and audit evidence export.
 *
 * Exported rather than exposed. No controller is added: exporting the audit trail removes a copy from the
 * system's control, and deciding who may do that — and what grant they must hold — is an access-policy
 * decision this group deliberately does not make on its own. The service records every page it serves, so
 * the first HTTP caller will be visible in the register from its first request.
 *
 * Existing compliance case management lives in `CustomerComplianceModule` and is untouched.
 */
@Module({
  providers: [ComplianceAuditExportService],
  exports: [ComplianceAuditExportService],
})
export class ComplianceModule {}
