// The auth router is an allowlist. Every endpoint Better Auth registers is either enabled here or
// listed in DISABLED_AUTH_PATHS; test/auth/mail-paths.int.spec.ts fails when a library upgrade
// adds an endpoint nobody has decided about.

export const ENABLED_AUTH_PATHS: readonly string[] = [
  '/sign-in/social',
  '/callback/:id',
  '/get-session',
  '/sign-out',
  '/email-otp/send-verification-otp',
  '/sign-in/email-otp',
  '/ok',
  '/error',
  // `disabledPaths` matches literal paths only, so a parametric path cannot be disabled. It is
  // inert: it only redirects with a password-reset token, and every path that issues one is
  // disabled below.
  '/reset-password/:token',
];

// Exact paths: Better Auth answers 404 before rate limiting, hooks or the handler run.
export const DISABLED_AUTH_PATHS: readonly string[] = [
  // Mail-sending or OTP side doors (only the throttled send path may mail).
  '/email-otp/request-password-reset',
  '/forget-password/email-otp',
  '/email-otp/reset-password',
  '/email-otp/verify-email',
  '/email-otp/check-verification-otp',
  '/email-otp/change-email',
  '/email-otp/request-email-change',
  '/send-verification-email',
  '/request-password-reset',
  // Password auth (Phase 0 has none).
  '/sign-up/email',
  '/sign-in/email',
  '/reset-password',
  '/change-password',
  '/verify-password',
  '/verify-email',
  // Profile and account management (no profile editing in Phase 0; privilege-escalation surface).
  '/update-user',
  '/change-email',
  '/delete-user',
  '/delete-user/callback',
  '/update-session',
  // Linking is off (G1); provider tokens are never stored.
  '/link-social',
  '/unlink-account',
  '/list-accounts',
  '/account-info',
  '/get-access-token',
  '/refresh-token',
  // Session management UI does not exist yet.
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
];
