/**
 * SMS-V1-01 — notification preference taxonomy.
 *
 * Three documented delivery classes (no new notification categories are created;
 * these classes only describe how the existing per-channel SMS preference applies):
 *
 * 1. SECURITY-CRITICAL (mandatory) — OTP/security authorization messages.
 *    A customer SMS opt-out must NEVER suppress these: blocking them would break
 *    required authentication/transaction authorization.
 *    CURRENT STATE (verified 2026-09-28): NO OTP or security-authorization event
 *    dispatches through the notification outbox today — there is no OTP generation
 *    machinery in V1 (W↔W authorization uses the transaction PIN; cash-to-cash uses
 *    a hashed transfer code shared out-of-band; MFA challenge delivery is not wired
 *    to any channel). The set below is therefore INTENTIONALLY EMPTY; any future
 *    security flow that routes through NotificationDispatcherService must add its
 *    event type here at design time, and the resolver will bypass the opt-out for it.
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
export const SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  // Intentionally empty in V1 — see header comment. Add OTP-class event types here.
]);

export function isSecurityCriticalNotificationEvent(eventType: string | null | undefined): boolean {
  if (!eventType) return false;
  return SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES.has(eventType);
}
