import { Column, CreateDateColumn, Entity, PrimaryColumn, Unique } from 'typeorm';

import { PaymentType } from './payment.enums';

@Entity({ name: 'payment_references' })
@Unique('uq_payment_references_payment', ['paymentType', 'paymentId'])
export class PaymentReference {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  reference!: string;

  @Column({ name: 'payment_type', type: 'varchar', length: 20 })
  paymentType!: PaymentType;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
