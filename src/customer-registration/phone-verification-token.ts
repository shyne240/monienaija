import { createHash, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { CustomerRegistrationPhoneChallenge } from './customer-registration-phone-challenge.entity';
import { REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS } from './customer-registration.constants';

/** Consume the existing one-time phone proof inside the caller's contact transaction. */
export async function consumePhoneVerificationToken(
  manager: EntityManager,
  normalizedPhone: string,
  token: string,
): Promise<{ verifiedAt: Date; challengeId: string }> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const repository = manager.getRepository(CustomerRegistrationPhoneChallenge);
  const challenge = await repository
    .createQueryBuilder('challenge')
    .where('challenge.normalized_phone = :phone', { phone: normalizedPhone })
    .andWhere("challenge.status = 'VERIFIED'")
    .andWhere('challenge.consumed_at IS NULL')
    .andWhere('challenge.revoked_at IS NULL')
    .orderBy('challenge.created_at', 'DESC')
    .setLock('pessimistic_write')
    .getOne();
  const storedHash = challenge?.verificationTokenHash;
  const storedBytes =
    storedHash && /^[a-f0-9]{64}$/i.test(storedHash)
      ? Buffer.from(storedHash, 'hex')
      : Buffer.alloc(0);
  const suppliedBytes = Buffer.from(tokenHash, 'hex');
  const tokenMatches =
    storedBytes.length === suppliedBytes.length &&
    storedBytes.length > 0 &&
    timingSafeEqual(storedBytes, suppliedBytes);
  const verifiedAt = challenge?.verifiedAt;
  const now = new Date();
  if (
    !challenge ||
    !verifiedAt ||
    !tokenMatches ||
    verifiedAt.getTime() > now.getTime() ||
    now.getTime() - verifiedAt.getTime() > REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS * 1000
  )
    throw new BadRequestException('Phone verification token is invalid or expired');
  challenge.consumedAt = now;
  await repository.save(challenge);
  return { verifiedAt, challengeId: challenge.id };
}
