export type KajolaRuntimeMode = 'local' | 'connected';

const requestedMode = process.env.KAJOLA_RUNTIME_MODE?.trim().toLowerCase();
const productionLike = process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';

/**
 * Local mode is an explicit development/test adapter. Production-like processes
 * fail closed into connected mode instead of silently accepting in-memory data.
 */
export const runtimeMode: KajolaRuntimeMode = requestedMode === 'local'
  ? 'local'
  : requestedMode === 'connected'
    ? 'connected'
    : productionLike
      ? 'connected'
      : process.env.SUPABASE_FUNCTIONS_URL
        ? 'connected'
        : 'local';

export const isLocalMode = runtimeMode === 'local';

export function runtimeConfigurationErrors() {
  if (isLocalMode) return productionLike ? ['LOCAL_RUNTIME_FORBIDDEN_IN_PRODUCTION'] : [];
  return [
    !process.env.SUPABASE_FUNCTIONS_URL && 'SUPABASE_FUNCTIONS_URL_MISSING',
    !process.env.NEXT_PUBLIC_SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL_MISSING',
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY_MISSING',
  ].filter((value): value is string => Boolean(value));
}
