import { ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** Lock the existing catalogue authority through quote/posting; NOT_CONFIGURED is the
 * catalogue's established informational seed, not an invented fee or limit policy. */
export async function requireTransferProduct(
  manager: EntityManager,
  currency: string,
): Promise<void> {
  const rows = await manager.query<Array<{ code: string }>>(
    `SELECT code FROM products WHERE code='WALLET_TRANSFER' AND enabled=true AND status='ACTIVE'
       AND deleted_at IS NULL AND configuration_status <> 'DISABLED' AND currency=$1 FOR SHARE`,
    [currency],
  );
  if (rows.length !== 1)
    throw new ServiceUnavailableException('Wallet transfer product is unavailable');
}
