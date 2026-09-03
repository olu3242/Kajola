import { NextRequest } from 'next/server';
import { getUserFromToken, StoreUser } from './store';

const COOKIE_NAME = 'kajola-session';

/** Extract the StoreUser from the kajola-session cookie in local mode. */
export function getSessionUser(req: NextRequest): StoreUser | null {
  // Try Authorization header first
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return getUserFromToken(authHeader.slice(7));
  }

  // Fall back to cookie
  const cookie = req.cookies.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  try {
    const parsed = JSON.parse(cookie.value);
    const token: string = parsed?.access_token ?? '';
    return getUserFromToken(token);
  } catch {
    return null;
  }
}
