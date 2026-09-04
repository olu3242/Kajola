'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/app/components/shells';
import type { CheckoutQuote, PaymentMethod } from '@/lib/commerce';

type Booking = { id: string; status: string; total_amount_kobo: number; starts_at: string; held_until: string | null; provider_name?: string; service_name?: string };
const METHODS: Array<{ id: PaymentMethod; label: string; note: string }> = [
  { id: 'bank_transfer', label: 'Bank transfer', note: 'Transfer from any Nigerian bank app' },
  { id: 'card', label: 'Card', note: 'Visa, Mastercard, or Verve' },
  { id: 'ussd', label: 'USSD', note: 'Pay from your phone without mobile data' },
  { id: 'bank_account', label: 'Bank account', note: 'Authorize payment from a supported bank' },
  { id: 'pay_at_venue', label: 'Pay at venue', note: 'Reserve now and pay the business in person' },
];
const money = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

export default function PayPage() {
  const bookingId = useParams<{ bookingId: string }>()?.bookingId ?? '';
  const [booking, setBooking] = useState<Booking | null>(null);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const expired = !!booking?.held_until && new Date(booking.held_until) <= new Date();

  useEffect(() => {
    if (!bookingId) return;
    fetch(`/api/bookings/${bookingId}`).then(async (response) => ({ ok: response.ok, data: await response.json() })).then(({ ok, data }) => {
      if (!ok) setError(data.error ?? 'Unable to load checkout.');
      setBooking(data.booking ?? null); setQuote(data.quote ?? null);
    }).catch(() => setError('Unable to load checkout.')).finally(() => setLoading(false));
  }, [bookingId]);

  async function handlePay() {
    if (!quote) return;
    setPaying(true); setError('');
    const response = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, method, purpose: quote.purpose }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? 'Payment could not be started. Your booking is still saved.'); setPaying(false); return; }
    window.location.href = data.authorization_url;
  }

  return <AppShell persona="customer" wide={false}>
    <section className="kj-page-heading"><span className="kj-eyebrow">Secure checkout</span><h1>{quote?.purpose === 'balance' ? 'Pay remaining balance' : quote?.purpose === 'deposit' ? 'Pay deposit and confirm' : 'Confirm your booking'}</h1><p>Choose the payment option that works for you.</p></section>
    {loading ? <div className="kj-state">Loading checkout…</div> : !booking || !quote ? <div className="kj-state kj-state--error">{error || 'Booking not found.'}</div> : expired ? <div className="kj-state kj-state--error"><strong>Your hold expired.</strong><p>The slot was released, so no payment was taken.</p><a className="kj-btn kj-btn--secondary" href="/discovery">Choose another time</a></div> : <div className="kj-checkout-grid">
      <section className="kj-card" aria-labelledby="payment-method-heading">
        <h2 id="payment-method-heading">How would you like to pay?</h2>
        <div className="kj-payment-methods">{METHODS.filter((item) => quote.methods.includes(item.id)).map((item) => <label className={`kj-payment-method${method === item.id ? ' is-selected' : ''}`} key={item.id}><input type="radio" name="payment-method" value={item.id} checked={method === item.id} onChange={() => setMethod(item.id)} /><span><strong>{item.label}</strong><small>{item.note}</small></span></label>)}</div>
        {error ? <p className="kj-form-error" role="alert">{error}</p> : null}
        <button className="kj-btn kj-btn--primary kj-btn--block" onClick={handlePay} disabled={paying} data-testid="pay-deposit-btn">{paying ? 'Starting securely…' : method === 'pay_at_venue' ? 'Reserve and pay at venue' : `Pay ${money(quote.customer_total_kobo)}`}</button>
        <p className="kj-muted">Kajola confirms payment server-side. A failed attempt never deletes your booking.</p>
      </section>
      <aside className="kj-card kj-price-breakdown" aria-label="Price breakdown"><span className="kj-eyebrow">Appointment</span><h2>{booking.service_name ?? 'Service'}</h2><p>{booking.provider_name}</p><p>{new Date(booking.starts_at).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })}</p><hr /><div><span>Service total</span><strong>{money(quote.service_amount_kobo)}</strong></div>{quote.previously_paid_kobo > 0 ? <div><span>Already paid</span><strong>−{money(quote.previously_paid_kobo)}</strong></div> : null}<div><span>{quote.purpose === 'deposit' ? 'Deposit due now' : 'Amount due now'}</span><strong>{money(quote.subtotal_due_kobo)}</strong></div>{quote.gateway_fee_kobo > 0 ? <div><span>Processing fee</span><strong>{money(quote.gateway_fee_kobo)}</strong></div> : null}<div className="kj-price-total"><span>{method === 'pay_at_venue' ? 'Due at venue' : 'Pay now'}</span><strong>{money(quote.customer_total_kobo)}</strong></div><p className="kj-muted">Balance after this payment: {money(quote.balance_after_payment_kobo)}</p></aside>
    </div>}
  </AppShell>;
}
