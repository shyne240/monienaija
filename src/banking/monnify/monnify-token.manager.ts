import { monnifyError } from './monnify.errors';
import type { BankingProviderError } from '../banking-provider.types';

/**
 * Wraps a normalized provider error in a real Error.
 *
 * The lint rule is right: throwing a plain object loses the stack and confuses anything that assumes
 * `throw` produces an Error. Carrying the structured error as a field keeps both.
 */
export class MonnifyTokenError extends Error {
  constructor(readonly providerError: BankingProviderError) {
    super(providerError.code);
    this.name = 'MonnifyTokenError';
  }
}

/**
 * Documented Monnify access token shape.
 *
 * `expiresIn` is seconds. Treat it as authoritative but never trust it blindly: a clock skew or a
 * provider that under-reports can leave us holding a token that is already dead. The safety margin
 * below exists for that reason.
 */
export interface MonnifyTokenResponse {
  accessToken: string;
  expiresIn: number;
}

export interface MonnifyTokenManagerDeps {
  /** Performs `POST /api/v1/auth/login` with the documented Basic credential header. */
  login: (signal?: AbortSignal) => Promise<MonnifyTokenResponse>;
  now?: () => number;
}

/** Refresh this long before the provider's stated expiry. */
const EXPIRY_SAFETY_MARGIN_MS = 30_000;
/** Never treat a token as fresh for less than this, whatever the provider claims. */
const MIN_USABLE_MS = 5_000;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Coordinates access-token acquisition and refresh.
 *
 * The whole point of this class is the word *coordination*. Two failure modes make a naive
 * "check cache, else fetch" implementation dangerous against a real provider:
 *
 * 1. **Thundering herd on expiry.** When a token expires, every in-flight request discovers it at the
 *    same moment. Each one fetching a token produces a burst of `/auth/login` calls, which the
 *    provider rate-limits — turning a routine refresh into an outage. So concurrent callers share a
 *    single in-flight login promise.
 * 2. **A rejected shared promise poisons the client.** If the one shared login fails, caching that
 *    rejection would break every subsequent request for the life of the process. The failure is
 *    cleared so the next caller retries.
 *
 * A refresh failure also **invalidates the cached token**: a token the provider refused to renew is
 * not something to keep using.
 */
export class MonnifyTokenManager {
  private cached?: CachedToken;
  private inFlight?: Promise<CachedToken>;
  private readonly now: () => number;

  constructor(private readonly deps: MonnifyTokenManagerDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Returns a usable access token, acquiring or refreshing one if required.
   *
   * `signal` is checked *before* joining the shared login. It is intentionally NOT propagated into
   * the shared promise: the login is shared by every concurrent caller, so one caller cancelling
   * must not reject the promise the others are awaiting.
   */
  async getToken(
    signal?: AbortSignal,
  ): Promise<{ ok: true; token: string } | { ok: false; error: BankingProviderError }> {
    if (signal?.aborted) {
      return {
        ok: false,
        error: monnifyError(
          'MONNIFY_TRANSPORT_FAILED',
          'Request was cancelled before token acquisition',
        ),
      };
    }
    const current = this.usableToken();
    if (current) return { ok: true, token: current.accessToken };

    try {
      const token = await this.acquire();
      return { ok: true, token: token.accessToken };
    } catch (error) {
      if (error instanceof MonnifyTokenError) return { ok: false, error: error.providerError };
      if (isBankingProviderError(error)) return { ok: false, error };
      return {
        ok: false,
        error: monnifyError('MONNIFY_AUTHENTICATION_FAILED', 'Access token acquisition failed'),
      };
    }
  }

  /** Forces the next `getToken` to acquire a new token. Used after an authenticated 401. */
  invalidate(): void {
    this.cached = undefined;
  }

  /** Test/observability hook: reports whether a token is currently considered usable. */
  hasUsableToken(): boolean {
    return this.usableToken() !== undefined;
  }

  private usableToken(): CachedToken | undefined {
    const token = this.cached;
    if (!token) return undefined;
    // At least MIN_USABLE_MS of life must remain, otherwise treat it as expired.
    if (token.expiresAtMs - this.now() <= MIN_USABLE_MS) {
      this.cached = undefined;
      return undefined;
    }
    return token;
  }

  private acquire(): Promise<CachedToken> {
    // Assign before awaiting so a second caller joins the in-flight work instead of starting another.
    this.inFlight ??= this.performLogin()
      .then((token) => {
        this.cached = token;
        return token;
      })
      .catch((error: unknown) => {
        // A rejected promise must not stay cached: that would poison every later request.
        this.inFlight = undefined;
        this.cached = undefined;
        throw error;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  private async performLogin(): Promise<CachedToken> {
    const response = await this.deps.login();
    if (
      typeof response.accessToken !== 'string' ||
      response.accessToken.length === 0 ||
      typeof response.expiresIn !== 'number' ||
      !Number.isFinite(response.expiresIn) ||
      response.expiresIn <= 0
    ) {
      throw new MonnifyTokenError(
        monnifyError(
          'MONNIFY_MALFORMED_RESPONSE',
          'Access token response was missing a usable token or expiry',
        ),
      );
    }
    const lifetimeMs = response.expiresIn * 1000;
    const margin = Math.min(EXPIRY_SAFETY_MARGIN_MS, Math.floor(lifetimeMs / 4));
    return {
      accessToken: response.accessToken,
      expiresAtMs: this.now() + lifetimeMs - margin,
    };
  }
}

function isBankingProviderError(value: unknown): value is BankingProviderError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BankingProviderError).code === 'string' &&
    typeof (value as BankingProviderError).category === 'string'
  );
}
