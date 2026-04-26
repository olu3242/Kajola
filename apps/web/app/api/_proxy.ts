import { NextRequest, NextResponse } from 'next/server';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;

export async function forwardToFunction(path: string, req: NextRequest) {
  if (!FUNCTIONS_URL) {
    return NextResponse.json({ error: 'SUPABASE_FUNCTIONS_URL is not configured' }, { status: 500 });
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  const auth = req.headers.get('authorization');
  if (auth) {
    headers.set('authorization', auth);
  }
  const paystackSignature = req.headers.get('x-paystack-signature');
  const stripeSignature = req.headers.get('stripe-signature');
  if (paystackSignature) headers.set('x-paystack-signature', paystackSignature);
  if (stripeSignature) headers.set('stripe-signature', stripeSignature);

  try {
    const response = await fetch(`${FUNCTIONS_URL}/${path}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' ? undefined : await req.text()
  });

    const data = await response.json().catch(() => ({ error: 'Invalid upstream response' }));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'Payment service unavailable' }, { status: 500 });
  }
}

export async function forwardToFunctionWithQuery(path: string, req: NextRequest) {
  if (!FUNCTIONS_URL) {
    return NextResponse.json({ error: 'SUPABASE_FUNCTIONS_URL is not configured' }, { status: 500 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.toString();
  const headers = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) {
    headers.set('authorization', auth);
  }

  try {
    const response = await fetch(`${FUNCTIONS_URL}/${path}${query ? `?${query}` : ''}`, {
    method: req.method,
    headers
  });

    const data = await response.json().catch(() => ({ error: 'Invalid upstream response' }));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'Payment service unavailable' }, { status: 500 });
  }
}
