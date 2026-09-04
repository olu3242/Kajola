import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { isLocalMode } from '@/lib/local-mode';
import { store } from '@/lib/store';
import { DEFAULT_COMMERCE_POLICY, type CommercePolicy } from '@/lib/commerce';
import { recordDomainChange } from '@/lib/domain-runtime';

function ownerProvider(req: NextRequest) {
  const user = getSessionUser(req);
  if (!user || user.role !== 'owner' || !user.tenant_id) return null;
  return store.providers.find((provider) => provider.tenant_id === user.tenant_id) ?? null;
}

export async function GET(req: NextRequest) {
  if (!isLocalMode) return NextResponse.json({ error: 'Payment settings are unavailable in remote mode' }, { status: 501 });
  const provider = ownerProvider(req);
  if (!provider) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ policy: provider.payment_policy ?? DEFAULT_COMMERCE_POLICY });
}

export async function PUT(req: NextRequest) {
  if (!isLocalMode) return NextResponse.json({ error: 'Payment settings are unavailable in remote mode' }, { status: 501 });
  const provider = ownerProvider(req);
  if (!provider) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => null) as Partial<CommercePolicy> | null;
  if (!body?.deposit || !body.fee_bearer || !Array.isArray(body.allowed_methods)) return NextResponse.json({ error: 'Invalid payment policy' }, { status: 400 });
  const allowedTypes = ['none', 'fixed', 'percentage', 'full', 'optional'];
  if (!allowedTypes.includes(body.deposit.type)) return NextResponse.json({ error: 'Invalid deposit policy' }, { status: 400 });
  const oldPolicy = provider.payment_policy ?? DEFAULT_COMMERCE_POLICY;
  provider.payment_policy = { ...DEFAULT_COMMERCE_POLICY, ...body, version: `ng-v1-${Date.now()}`, currency: 'NGN' } as CommercePolicy;
  const actor = getSessionUser(req)!;
  recordDomainChange({ eventType: 'tenant.payment_policy_updated', actor, tenantId: provider.tenant_id, aggregateType: 'payment_policy', aggregateId: provider.id, oldState: oldPolicy as unknown as Record<string, unknown>, newState: provider.payment_policy as unknown as Record<string, unknown> });
  return NextResponse.json({ policy: provider.payment_policy });
}
