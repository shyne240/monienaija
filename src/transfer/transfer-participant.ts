import { ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletOwnerClass } from '../wallet/wallet.enums';

export interface TransferParticipant {
  wallet: WalletAccount;
  type: 'CUSTOMER' | 'AGENT';
  id: string;
  agentClassId: string | null;
  agentServices?: unknown;
}

/**
 * Resolve both participants from locked wallet rows and current authoritative domain records.
 * The wallet rows must already be held FOR UPDATE by the caller for the lifetime of the
 * transaction. No client-provided owner class or owner id is admitted as evidence.
 */
export async function resolveTransferParticipants(
  manager: EntityManager,
  wallets: [WalletAccount, WalletAccount],
): Promise<[TransferParticipant, TransferParticipant] | null> {
  // Manually constructed legacy unit fakes predate owner_class. The database column is NOT NULL;
  // a partially missing classification is never treated as an authenticated participant.
  if (wallets.every((wallet) => wallet.ownerClass == null)) return null;
  if (wallets.some((wallet) => wallet.ownerClass == null)) {
    throw new ServiceUnavailableException('Wallet ownership classification is unavailable');
  }
  const rows = await manager.query<
    Array<{ id: string; owner_class: WalletOwnerClass; current_class: WalletOwnerClass }>
  >(
    `SELECT id, owner_class, wallet_owner_class(customer_id) AS current_class
       FROM wallet_accounts WHERE id = ANY($1::uuid[])`,
    [wallets.map((wallet) => wallet.id)],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const wallet of wallets) {
    const row = byId.get(wallet.id);
    if (
      !row ||
      row.owner_class !== wallet.ownerClass ||
      row.owner_class !== row.current_class ||
      (row.owner_class !== WalletOwnerClass.CUSTOMER && row.owner_class !== WalletOwnerClass.AGENT)
    ) {
      throw new ServiceUnavailableException('Wallet ownership classification is unavailable');
    }
  }

  const agentIds = [
    ...new Set(
      wallets
        .filter((wallet) => wallet.ownerClass === WalletOwnerClass.AGENT)
        .map((wallet) => wallet.customerId.toLowerCase()),
    ),
  ].sort();
  const agents = agentIds.length
    ? await manager.query<
        Array<{
          id: string;
          status: string;
          deleted_at: Date | null;
          agent_class_id: string | null;
          class_id: string | null;
          class_active: boolean | null;
          class_deleted_at: Date | null;
          applicable_services: unknown;
        }>
      >(
        `SELECT a.id, a.status, a.deleted_at, a.agent_class_id, c.id AS class_id,
            c.is_active AS class_active, c.deleted_at AS class_deleted_at, c.applicable_services
       FROM agents a JOIN agent_classes c ON c.id = a.agent_class_id
      WHERE a.id = ANY($1::uuid[]) ORDER BY a.id FOR SHARE OF a, c`,
        [agentIds],
      )
    : [];
  const byAgent = new Map(agents.map((agent) => [agent.id.toLowerCase(), agent]));
  const participant = (wallet: WalletAccount): TransferParticipant => {
    if (wallet.ownerClass === WalletOwnerClass.CUSTOMER) {
      return { wallet, type: 'CUSTOMER', id: wallet.customerId, agentClassId: null };
    }
    const agent = byAgent.get(wallet.customerId.toLowerCase());
    if (
      !agent ||
      agent.status !== 'ACTIVE' ||
      agent.deleted_at !== null ||
      !agent.agent_class_id ||
      agent.class_id !== agent.agent_class_id ||
      !agent.class_active ||
      agent.class_deleted_at !== null
    ) {
      throw new ServiceUnavailableException('Agent wallet eligibility is unavailable');
    }
    return {
      wallet,
      type: 'AGENT',
      id: agent.id,
      agentClassId: agent.agent_class_id,
      agentServices: agent.applicable_services,
    };
  };
  return [participant(wallets[0]), participant(wallets[1])];
}
