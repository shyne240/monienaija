export const NOTIFICATION_PROVIDER_TOKEN = 'NOTIFICATION_PROVIDER';

/**
 * ARENA3-NOTIFICATION-EMAIL — provider token for the EMAIL channel only.
 * SMS/PUSH keep using NOTIFICATION_PROVIDER_TOKEN unchanged (no regression risk).
 * Bound in NotificationModule from NOTIFICATION_EMAIL_PROVIDER env
 * (none | console | resend). 'none' = email dark: dispatcher writes SKIPPED
 * (EMAIL_PROVIDER_NOT_CONFIGURED); the worker fails closed on EMAIL retries.
 */
export const NOTIFICATION_EMAIL_PROVIDER_TOKEN = 'NOTIFICATION_EMAIL_PROVIDER';

/**
 * ARENA3-NOTIFICATION-EMAIL — template-lookup seam token (see NotificationEmailTemplateLookup
 * in notification.types.ts). Default binding: CodeNotificationEmailTemplateService.
 * Arena 1's future database-backed template registry replaces this binding WITHOUT any
 * dispatcher/worker changes (documented coordination contract).
 */
export const NOTIFICATION_EMAIL_TEMPLATE_TOKEN = 'NOTIFICATION_EMAIL_TEMPLATE';
