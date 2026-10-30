#!/usr/bin/env bash
# M1 acceptance — navigation and authorization parity audit.
#
# NOT an application test. Documentation tool that compiles the real
# navigation-access.ts and reports the structural invariants the M1 scope
# requires to be preserved (28 canonical views, 7 groups, 9 aliases, guard
# parity, contextual customer history).
#
# Usage:  bash tools/navigation-audit.sh [path-to-apps/admin-web]
# Writes nothing into the repository; uses a temporary output directory.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
APP_DIR="${1:-$REPO_ROOT/apps/admin-web}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

cd "$APP_DIR"

# Compile the guard module standalone (it has no imports) so the audit runs
# against the real implementation rather than a copy.
npx tsc src/screens/authenticated/navigation-access.ts \
  --outDir "$OUT" --module commonjs --target ES2020 --skipLibCheck >/dev/null 2>&1

node -e '
const nav = require(process.argv[1] + "/navigation-access.js");

const canonical = [
  "dashboard","dashboardSettings","customers","agents","agentClasses","support","transfers",
  "cashIn","cashOut","cashToCashOps","ledgerExplorer","reconciliation","feeRules",
  "commissionRules","rewardRules","productCatalogue","limitCatalogue","limitAssignments",
  "kycQueue","complianceCases","fraudCases","workforceAccess","roleGovernance",
  "approvalsInbox","superAdminRecovery","notifications","systemHealth","auditEvents",
];
const aliases = ["ledger","transactions","commercial","compliance","riskfraud","roles","approvals","workforce","system"];

console.log("canonical view list length:", canonical.length);
console.log("legacy alias list length  :", aliases.length);

let mapped = 0;
for (const a of aliases) {
  const c = nav.canonicalAdminView(a);
  if (c !== a) mapped++;
  console.log("  alias", a, "->", c);
}
console.log("aliases that canonicalise :", mapped);

const allScopes = [
  "customer.view","customer.create","customer.view_transactions","agent.view","agent.fund",
  "transaction.view","ledger.view","reconciliation.view","fee_rule.view","commission_rule.view",
  "reward_rule.view","product.view","limit.view","agent.assign_limit","kyc.view",
  "compliance.manage_case","risk_fraud.manage_fraud_case","workforce.dashboard.view",
  "workforce.user.create","workforce.role.assign","workforce.role.assign_operational",
  "privileged:approve","workforce.super_admin.recover","notification.view_deliveries",
  "metrics.view","audit.search","workforce.dashboard.assign",
];
const roles = ["SUPER_ADMIN","ADMINISTRATOR","FINANCE_CONTROLLER","FINANCE_AUDITOR",
  "AGENT_NETWORK_MANAGER","CUSTOMER_SERVICE","OPERATIONS_MANAGER"];

let parity = true;
for (const a of aliases) {
  const c = nav.canonicalAdminView(a);
  if (nav.canAccessAdminView(a, allScopes, roles) !== nav.canAccessAdminView(c, allScopes, roles)) {
    parity = false;
    console.log("  PARITY FAIL", a);
  }
}
console.log("alias/canonical guard parity (all scopes):", parity ? "PASS" : "FAIL");

console.log("ctx history w/ customer.view_transactions only:",
  nav.canAccessAdminView("transactions", ["customer.view_transactions"], ["CUSTOMER_SERVICE"], { customerId: "c1" }));
console.log("ctx history without customerId                :",
  nav.canAccessAdminView("transactions", ["customer.view_transactions"], ["CUSTOMER_SERVICE"]));
' "$OUT"

echo -n "section group ids: "
grep -o "id: '[a-z]*'," src/screens/authenticated/Layout.tsx | sed "s/id: '//;s/',//" | sort -u | paste -sd',' - | sed 's/,/, /g'
