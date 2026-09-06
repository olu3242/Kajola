'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/app/components/shells';
import { DEFAULT_COMMERCE_POLICY, type CommercePolicy, type FeeBearer, type PaymentMethod } from '@/lib/commerce';

const methods: Array<[PaymentMethod, string]> = [['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['ussd', 'USSD'], ['bank_account', 'Bank account'], ['payment_link', 'Payment link'], ['pay_at_venue', 'Pay at venue'], ['cash', 'Cash']];

export default function PaymentSettingsPage() {
  const [policy, setPolicy] = useState<CommercePolicy>(DEFAULT_COMMERCE_POLICY);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/owner/payment-settings').then((res) => res.json()).then((data) => { if (data.policy) setPolicy(data.policy); }).finally(() => setLoaded(true));
  }, []);

  const toggleMethod = (method: PaymentMethod) => setPolicy((current) => ({
    ...current,
    allowed_methods: current.allowed_methods.includes(method) ? current.allowed_methods.filter((item) => item !== method) : [...current.allowed_methods, method],
    pay_at_venue_enabled: method === 'pay_at_venue' ? !current.allowed_methods.includes(method) : current.pay_at_venue_enabled,
  }));

  async function save() {
    setMessage('Saving…');
    const response = await fetch('/api/owner/payment-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(policy) });
    const data = await response.json();
    if (response.ok) { setPolicy(data.policy); setMessage('Payment settings saved. New bookings will use this policy.'); }
    else setMessage(data.error ?? 'Could not save settings.');
  }

  return <AppShell persona="owner">
    <section className="kj-page-heading"><span className="kj-eyebrow">Commerce controls</span><h1>Payment settings</h1><p>Choose how customers confirm appointments. Changes apply to new bookings and are versioned for auditability.</p></section>
    {!loaded ? <div className="kj-state">Loading payment policy…</div> : <>
      <div className="kj-settings-grid">
        <section className="kj-card"><h2>Booking payment</h2>
          <label className="kj-field">Deposit policy<select value={policy.deposit.type} onChange={(event) => { const type = event.target.value; setPolicy((current) => ({ ...current, deposit: type === 'percentage' || type === 'optional' ? { type, percentage: 30 } : type === 'fixed' ? { type, amount_kobo: 500000 } : { type } as CommercePolicy['deposit'] })); }}><option value="none">No deposit</option><option value="fixed">Fixed deposit</option><option value="percentage">Percentage deposit</option><option value="full">Full payment</option><option value="optional">Optional deposit</option></select></label>
          {policy.deposit.type === 'percentage' || policy.deposit.type === 'optional' ? <label className="kj-field">Percentage<input type="number" min="1" max="100" value={policy.deposit.percentage} onChange={(event) => setPolicy((current) => ({ ...current, deposit: { type: policy.deposit.type as 'percentage' | 'optional', percentage: Number(event.target.value) } }))} /></label> : null}
          {policy.deposit.type === 'fixed' ? <label className="kj-field">Fixed amount (₦)<input type="number" min="0" value={policy.deposit.amount_kobo / 100} onChange={(event) => setPolicy((current) => ({ ...current, deposit: { type: 'fixed', amount_kobo: Number(event.target.value) * 100 } }))} /></label> : null}
          <label className="kj-field">Processing-fee treatment<select value={policy.fee_bearer} onChange={(event) => setPolicy((current) => ({ ...current, fee_bearer: event.target.value as FeeBearer }))}><option value="BUSINESS_ABSORBS">Business absorbs</option><option value="CUSTOMER_PAYS">Customer pays</option><option value="PLATFORM_SUBSIDIZES">Kajola subsidizes</option><option value="SPLIT">Split</option></select></label>
        </section>
        <section className="kj-card"><h2>Accepted methods</h2><div className="kj-checkbox-list">{methods.map(([id, label]) => <label key={id}><input type="checkbox" checked={policy.allowed_methods.includes(id)} onChange={() => toggleMethod(id)} /> {label}</label>)}</div><p className="kj-muted">Bank transfer is presented first in checkout. Actual channel availability still depends on your configured payment provider.</p></section>
      </div>
      <button className="kj-btn kj-btn--primary" onClick={save}>Save payment settings</button>{message ? <p role="status">{message}</p> : null}
    </>}
  </AppShell>;
}
