import { ProductConfigurationStatus, ProductDomain, ProductScope, ProductStatus } from './product-catalog.enums';

/**
 * V1-COMMERCIAL-02 — V1 product catalogue seed.
 *
 * Exactly the seven product identities the existing V1 runtime flows already use for limit
 * enforcement and commercial decision snapshots (docs/V1-COMMERCIAL-ENGINE-CAPABILITY-REGISTRY-AUDIT.md §12).
 * No new V1 products are invented; no V2 products are seeded.
 *
 * All entries: currency NGN (V1 is internal NGN-only), scope V1, status ACTIVE, enabled true
 * (the flows genuinely exist), configurationStatus NOT_CONFIGURED — NO commercial pricing,
 * commission, reward or limit threshold is expressed here or anywhere in this foundation.
 */
export interface ProductSeedEntry {
  code: string;
  name: string;
  description: string;
  domain: ProductDomain;
  currency: string;
  productScope: ProductScope;
  status: ProductStatus;
  enabled: boolean;
  configurationStatus: ProductConfigurationStatus;
  createdBy: string;
}

export const PRODUCT_CATALOG_SEED: ProductSeedEntry[] = [
  {
    code: 'WALLET_TRANSFER',
    name: 'Wallet Transfer',
    description: 'Customer wallet-to-wallet transfer: DEBIT source wallet, CREDIT destination wallet.',
    domain: ProductDomain.CUSTOMER,
    currency: 'NGN',
    productScope: ProductScope.V1,
    status: ProductStatus.ACTIVE,
    enabled: true,
    configurationStatus: ProductConfigurationStatus.NOT_CONFIGURED,
    createdBy: 'system-seed',
  },
  {
    code: 'WALLET_TO_CASH',
    name: 'Wallet to Cash',
    description: 'Customer Wallet-to-Cash via agent: DEBIT customer wallet, CREDIT agent funding pool.',
    domain: ProductDomain.AGENT,
    currency: 'NGN',
    productScope: ProductScope.V1,
    status: ProductStatus.ACTIVE,
    enabled: true,
    configurationStatus: ProductConfigurationStatus.NOT_CONFIGURED,
    createdBy: 'system-seed',
  },
  {
    code: 'CASH_TO_WALLET',
    name: 'Cash to Wallet',
    description: 'Customer Cash-to-Wallet via agent: DEBIT agent funding pool, CREDIT customer wallet.',
    domain: ProductDomain.AGENT,
    currency: 'NGN',
    productScope: ProductScope.V1,
    status: ProductStatus.ACTIVE,
    enabled: true,
    configurationStatus: ProductConfigurationStatus.NOT_CONFIGURED,
    createdBy: 'system-seed',
  },
  {
    code: 'CASH_TO_CASH',
    name: 'Cash to Cash',
    description: 'Agent cash-to-cash transfer with claim lifecycle (cash_to_cash_transfers).',
    domain: ProductDomain.AGENT,
    currency: 'NGN',
    productScope: ProductScope.V1,
    status: ProductStatus.ACTIVE,
    enabled: true,
    configurationStatus: ProductConfigurationStatus.NOT_CONFIGURED,
    createdBy: 'system-seed',
  },
  {
    code: 'CUSTOMER_FUNDING',
    name: 'Customer Funding',
    description: 'Finance-operations customer wallet funding with maker/checker approval.',
    domain: ProductDomain.FINANCE,
    currency: 'NGN',
    productScope: ProductScope.V1,
    status: ProductStatus.ACTIVE,
    enabled: true,
    configurationStatus: ProductConfigurationStatus.NOT_CONFIGURED,
    createdBy: 'system-seed',
  },
  {
    code: 'AGENT_FUNDING',
    name: 'Agent Funding',
    description: 'Platform-to-agent funding: DEBIT agent funding pool, CREDIT agent wallet.',
    domain: ProductDomain.FINANCE,
    currency: 'NGN',
    productScope: ProductScope.V1,
    status: ProductStatus.ACTIVE,
    enabled: true,
    configurationStatus: ProductConfigurationStatus.NOT_CONFIGURED,
    createdBy: 'system-seed',
  },
  {
    code: 'AGENT_DEFUNDING',
    name: 'Agent Defunding',
    description: 'Agent-to-platform defunding: DEBIT agent wallet, CREDIT agent funding pool.',
    domain: ProductDomain.FINANCE,
    currency: 'NGN',
    productScope: ProductScope.V1,
    status: ProductStatus.ACTIVE,
    enabled: true,
    configurationStatus: ProductConfigurationStatus.NOT_CONFIGURED,
    createdBy: 'system-seed',
  },
];

export const V1_PRODUCT_CODES: readonly string[] = PRODUCT_CATALOG_SEED.map((p) => p.code);

/**
 * V2/out-of-scope identifiers that must NEVER be enabled by this foundation. Kept as a
 * guard list for tests — seeding them is explicitly out of scope.
 */
export const OUT_OF_SCOPE_PRODUCT_CODES: readonly string[] = [
  'WALLET_TO_BANK',
  'BANK_TO_WALLET',
  'NIBSS',
  'WEMA',
  'PROVIDUS',
  'NINEPSB',
  'CARDS',
  'DOLLAR_CARDS',
  'AIRTIME',
  'DATA',
  'ELECTRICITY',
  'CABLE',
  'BETTING',
];
