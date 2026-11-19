import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * G10 — authoritative bank directory for self-service.
 *
 * The `banks` table is the only directory authority. This service exposes the NIP-capable
 * subset that a customer or agent may address without workforce involvement. It never invents
 * a bank, never serves an inactive one, and never translates between provider codes — the
 * stored `bank_code` is the provider's own code as ingested by operations.
 *
 * Provider directory (`listBanks`) exists in the Monnify adapter but is not merged here:
 * the stored directory is the institution-governed truth; provider listing is operational
 * observability for workforce/banking admin, not a customer source of truth that could be
 * spoofed by an uncredentialed provider response.
 */
@Injectable()
export class BankingDirectoryService {
  constructor(private readonly dataSource: DataSource) {}

  async listForSelfService(search?: string): Promise<
    Array<{
      bankCode: string;
      bankName: string;
      shortName: string;
      nipSupported: boolean;
      status: string;
    }>
  > {
    const normalizedSearch = search?.trim();
    const params: unknown[] = [];
    let where = `WHERE status='ACTIVE' AND nip_supported=true`;
    if (normalizedSearch) {
      params.push(`%${normalizedSearch}%`);
      where += ` AND (bank_code ILIKE $${params.length} OR bank_name ILIKE $${params.length} OR short_name ILIKE $${params.length})`;
    }
    const rows = await this.dataSource.query<
      Array<{
        bank_code: string;
        bank_name: string;
        short_name: string;
        nip_supported: boolean;
        status: string;
      }>
    >(
      `SELECT bank_code,bank_name,short_name,nip_supported,status FROM banks ${where} ORDER BY bank_name ASC, bank_code ASC`,
      params,
    );
    return rows.map((r) => ({
      bankCode: r.bank_code,
      bankName: r.bank_name,
      shortName: r.short_name,
      nipSupported: r.nip_supported,
      status: r.status,
    }));
  }

  async findOneByCode(bankCode: string): Promise<{
    id: string;
    bankCode: string;
    bankName: string;
    shortName: string;
    nipSupported: boolean;
    status: string;
  } | null> {
    const normalized = bankCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(normalized)) return null;
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        bank_code: string;
        bank_name: string;
        short_name: string;
        nip_supported: boolean;
        status: string;
      }>
    >(
      `SELECT id,bank_code,bank_name,short_name,nip_supported,status FROM banks WHERE bank_code=$1 LIMIT 1`,
      [normalized],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      bankCode: row.bank_code,
      bankName: row.bank_name,
      shortName: row.short_name,
      nipSupported: row.nip_supported,
      status: row.status,
    };
  }
}
