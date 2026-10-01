/**
 * SMS-V1-01 — notification preference taxonomy.
 *
 * Three documented delivery classes (no new notification categories are created;
 * these classes only describe how the existing per-channel SMS preference applies):
 *
 * 1. SECURITY-CRITICAL (mandatory) — OTP/security authorization messages.
 *    A customer SMS opt-out must NEVER suppress these: blocking them would break
 *    required authentication/transaction authorization.
 *    CURRENT STATE (updated 2026-09-30): V1-CUSTOMER-CREDENTIALS-01 added a second
 *    OTP-class event (workforce-issued temporary customer login credential, below),
 *    alongside V1-CUSTOMER-ONBOARDING-01's registration phone-verification OTP. Both are
 *    delivered DIRECTLY through the provider-neutral SMS abstraction (NOTIFICATION_PROVIDER_TOKEN)
 *    and intentionally not routed through NotificationDispatcherService/outbox: an outbox
 *    delivery record persists the rendered message, which would persist the OTP — forbidden.
 *    Registration therefore never flows through the per-customer opt-out resolver (SMS goes
 *    to a pre-customer phone), but the event is registered here so the taxonomy stays
 *    truthful and any future dispatcher-routed security flow must also bypass opt-out.
 *    W↔W authorization still uses the transaction PIN; cash-to-cash still uses a hashed
 *    transfer code shared out-of-band; MFA challenge delivery remains unwired to any
 *    channel. Any future security flow that routes through NotificationDispatcherService
 *    must add its event type here at design time, and the resolver will bypass the opt-out.
 *
 * 2. TRANSACTIONAL (REQUIRED FOR V1, opt-out honored) — funding, transfer, support
 *    outcomes. Customers can silence the SMS copy via notification_sms_enabled=false;
 *    the in-app inbox (notification_deliveries projection) remains available only
 *    while a delivery record was created — opt-out happens BEFORE insert, so the
 *    message is recorded SKIPPED with reason SMS_OPT_OUT (visible in diagnostics,
 *    hidden from the inbox per existing semantics).
 *
 * 3. OPTIONAL INFORMATIONAL — any event not in classes 1 and the REQUIRED set;
 *    same opt-out treatment as class 2. No arbitrary new categories introduced.
 */
/** V1-CUSTOMER-CREDENTIALS-01 — event type for the temporary customer credential SMS. */
export const CUSTOMER_TEMPORARY_CREDENTIAL_EVENT_TYPE = 'customer.credentials.temporary_credential';

export const SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  // V1-CUSTOMER-ONBOARDING-01 — OTP SMS for the customer registration front door.
  'customer.registration.phone_verification',
  // V1-CUSTOMER-CREDENTIALS-01 — workforce-issued temporary login credential SMS for an
  // ACTIVATED customer. Delivered DIRECTLY through the provider-neutral SMS abstraction
  // (never the dispatcher/outbox — an outbox record persists the rendered message, which
  // would persist the credential). Sent to the customer's verified primary phone — the
  // same fail-closed class as the registration OTP.
  CUSTOMER_TEMPORARY_CREDENTIAL_EVENT_TYPE,
  // V1-AGENT-MFA-API-01 — customer OTP SMS for agent-desk money flows (Wallet→Cash,
  // Cash→Cash claim). Delivered DIRECTLY through the provider-neutral SMS abstraction
  // (never dispatcher/outbox — an outbox record would persist the rendered OTP) to the
  // customer's verified primary phone. This is the previously-unwired "MFA challenge
  // delivery" class referenced above; issuance is AGENT-session-only and the OTP itself
  // is delivered to the customer, never to the agent.
  'agent.desk.customer_otp',
]);

export function isSecurityCriticalNotificationEvent(eventType: string | null | undefined): boolean {
  if (!eventType) return false;
  return SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES.has(eventType);
}
