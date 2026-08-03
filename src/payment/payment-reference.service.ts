import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { PaymentType } from './payment.enums';

@Injectable()
export class PaymentReferenceService {
  async nextReference(
    manager: EntityManager,
    paymentType: PaymentType,
    paymentId: string,
  ): Promise<string> {
    const result: unknown = await manager.query(
      `SELECT nextval('payment_reference_sequence')::text AS sequence`,
    );
    const rows = isUnknownArray(result) ? result : [];
    const first = rows[0];
    const sequence =
      typeof first === 'object' && first !== null && 'sequence' in first
        ? first.sequence
        : undefined;
    if (typeof sequence !== 'string' || sequence.length === 0) {
      throw new ConflictException('Payment reference sequence is unavailable');
    }

    const reference = `MN${sequence.padStart(12, '0')}`;
    await manager.query(
      `INSERT INTO payment_references (reference, payment_type, payment_id)
       VALUES ($1, $2, $3)`,
      [reference, paymentType, paymentId],
    );
    return reference;
  }
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
