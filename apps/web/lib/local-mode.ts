export type KajolaRuntimeMode = 'local' | 'test' | 'sandbox' | 'production';

const requestedMode = process.env.KAJOLA_RUNTIME_MODE?.trim().toLowerCase();
const appEnvironment = process.env.APP_ENV?.trim().toLowerCase();
const productionLike = appEnvironment === 'production' || process.env.NODE_ENV === 'production';

function resolveRuntimeMode(): KajolaRuntimeMode {
  if (requestedMode === 'local' || requestedMode === 'test' || requestedMode === 'sandbox' || requestedMode === 'production') {
    return requestedMode;
  }
  // `connected` was the pre-RC1 name. Preserve compatibility while resolving it
  // to an explicit durable environment.
  if (requestedMode === 'connected') return productionLike ? 'production' : 'sandbox';
  if (process.env.NODE_ENV === 'test') return 'test';
  if (productionLike) return 'production';
  if (process.env.SUPABASE_FUNCTIONS_URL) return 'sandbox';
  return 'local';
}

/**
 * Local mode is an explicit development/test adapter. Production-like processes
 * fail closed into connected mode instead of silently accepting in-memory data.
 */
export const runtimeMode = resolveRuntimeMode();

export const isLocalMode = runtimeMode === 'local' || runtimeMode === 'test';
export const isDurableMode = runtimeMode === 'sandbox' || runtimeMode === 'production';

export function runtimeConfigurationErrors() {
  if (isLocalMode) return productionLike ? ['LOCAL_RUNTIME_FORBIDDEN_IN_PRODUCTION'] : [];
  return [
    !process.env.SUPABASE_FUNCTIONS_URL && 'SUPABASE_FUNCTIONS_URL_MISSING',
    !process.env.NEXT_PUBLIC_SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL_MISSING',
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY_MISSING',
    !process.env.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY_MISSING',
  ].filter((value): value is string => Boolean(value));
}
