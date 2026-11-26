import {
  ProductConfigurationStatus,
  ProductDomain,
  ProductScope,
  ProductStatus,
} from './product-catalog.enums';

/**
 * V1-COMMERCIAL-02 — V1 product catalogue seed.
 *
 * The product identities the V1 runtime flows use for limit enforcement, fee pricing and commercial
 * decision snapshots (docs/V1-COMMERCIAL-ENGINE-CAPABILITY-REGISTRY-AUDIT.md §12).
 *
 * PR #27 added the two bank directions, because a product code that is not in `products` cannot
 * carry commercial configuration at all: `fee_rules.product_code` and `commission_rules.product_code`
 * both have a foreign key to `products.code`, and the effective-configuration preview resolves the
 * product row before it can price or limit anything. Leaving them out meant the outbound runtime had
 * to invent the strings `WITHDRAWAL` / `EXTERNAL_BANK_TRANSFER` for limit enforcement while pricing
 * refused to name a product at all, and the inbound credit path had no product identity whatsoever.
 * `src/product-catalog/banking-product-identities.ts` is now the single source for both directions.
 *
 *  - `WALLET_TO_BANK` is seeded ACTIVE/enabled. It is the canonical product for a wallet→bank
 *    transfer from EITHER a customer or an agent (PR #23 maps both to the single transaction-history
 *    type `WALLET_TO_BANK`, keyed by `financial_commitments.id`). There is deliberately no second
 *    agent-bank-transfer product.
 *  - `BANK_TO_WALLET` is seeded but DISABLED and not enabled, because live bank credits cannot post:
 *    production binds `UnavailableA7InboundExecutionAuthority`, and no approved suspense policy
 *    exists. The row exists so limit rules and the preview have a real product to resolve against —
 *    a limit rule governs the credit that *would* post — while the disabled status keeps inbound fee
 *    pricing visibly unavailable rather than silently free.
 *
 * All entries: currency NGN (V1 is internal NGN-only), scope V1, configurationStatus NOT_CONFIGURED —
 * NO commercial pricing, commission, reward or limit threshold is expressed in this seed.
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
    description:
      'Customer wallet-to-wallet transfer: DEBIT source wallet, CREDIT destination wallet.',
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
    description:
      'Customer Wallet-to-Cash via agent: DEBIT customer wallet, CREDIT agent funding pool.',
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
    description:
      'Customer Cash-to-Wallet via agent: DEBIT agent funding pool, CREDIT customer wallet.',
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
  {
    code: 'WALLET_TO_BANK',
    name: 'Wallet to Bank',
    description:
      'Customer or agent wallet-to-bank transfer: DEBIT the principal wallet, dispatch to the destination bank, settle externally. Both principal types share this single product (see banking-product-identities.ts).',
    domain: ProductDomain.CUSTOMER,
    currency: 'NGN',
    productScope: ProductScope.V1,
    status: ProductStatus.ACTIVE,
    enabled: true,
    configurationStatus: ProductConfigurationStatus.NOT_CONFIGURED,
    createdBy: 'system-seed',
  },
  {
    code: 'BANK_TO_WALLET',
    name: 'Bank to Wallet',
    description:
      'Inbound bank credit into a customer wallet via a virtual account. Seeded DISABLED: production binds UnavailableA7InboundExecutionAuthority, so no credit can post until an approved execution authority and suspense policy exist. Limit rules resolve against this product so the credit that would post is governed; fee pricing is intentionally not available while the product is disabled.',
    domain: ProductDomain.CUSTOMER,
    currency: 'NGN',
    productScope: ProductScope.V1,
    status: ProductStatus.DISABLED,
    enabled: false,
    configurationStatus: ProductConfigurationStatus.DISABLED,
    createdBy: 'system-seed',
  },
];

export const V1_PRODUCT_CODES: readonly string[] = PRODUCT_CATALOG_SEED.map((p) => p.code);

/**
 * V2/out-of-scope identifiers that must NEVER be enabled by this foundation. Kept as a
 * guard list for tests — seeding them is explicitly out of scope.
 *
 * PR #27 removed `WALLET_TO_BANK` and `BANK_TO_WALLET` from this list. Their previous presence here
 * was a carry-over of the foundation seed, not a release-scope decision: the outbound direction was
 * already executing (through the commitment + banking dispatch path) and the inbound direction was
 * already the only way money enters a wallet from a bank. Both are V1 routes with a real runtime,
 * so they belong in the catalogue with commercial configuration, not in a list of identifiers that
 * must never be seeded.
 */
export const OUT_OF_SCOPE_PRODUCT_CODES: readonly string[] = [
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
