import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { isLocalMode } from '@/lib/local-mode';
import { store } from '@/lib/store';

export async function GET(req: NextRequest) {
  const user = getSessionUser(req);
  if (!user) return NextResponse.json({ code: 'UNAUTHENTICATED', error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ code: 'FORBIDDEN', error: 'Operator access required' }, { status: 403 });
  const checks = {
    database: isLocalMode ? 'local-adapter' : process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'missing',
    auth: isLocalMode ? 'local-adapter' : process.env.SUPABASE_JWT_SECRET ? 'configured' : 'missing',
    marketplace: 'ready', availability: 'ready', booking: 'ready',
    payment: process.env.PAYSTACK_SECRET_KEY ? 'configured' : 'blocked_external',
    notification: process.env.TERMII_API_KEY || process.env.AT_API_KEY ? 'configured' : 'blocked_external',
    workflow: isLocalMode ? 'local-scheduler' : 'database-worker',
    ai: process.env.ANTHROPIC_API_KEY ? 'configured' : 'optional',
  };
  return NextResponse.json({ checks, evidence: { events: store.events.length, audits: store.audits.length, ledger_entries: store.ledger.length, scheduled_workflows: store.workflows.filter((job) => job.status === 'scheduled').length, notifications: store.notifications.length }, recent_events: store.events.slice(-20).reverse(), recent_audits: store.audits.slice(-20).reverse() });
}
