'use client';

import { useEffect, useState } from 'react';

type SubscriptionPlan = {
  tier: string;
  title: string;
  description: string;
  rank_boost: number;
  analytics: boolean;
};

type FeaturedOption = {
  type: string;
  title: string;
  description: string;
  suggested_amount_cents: number;
  duration_days: number;
};

export default function BillingPage() {
  const [planData, setPlanData] = useState<any>(null);
  const [featuredOptions, setFeaturedOptions] = useState<FeaturedOption[]>([]);
  const [selectedTier, setSelectedTier] = useState('free');
  const [selectedFeatured, setSelectedFeatured] = useState('boost');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const subscription = await fetch('/api/revenue/subscriptions');
      const listing = await fetch('/api/revenue/featured');
      const subscriptionData = await subscription.json();
      const listingData = await listing.json();
      setPlanData(subscriptionData.subscription ?? subscriptionData);
      setFeaturedOptions(listingData.options ?? []);
      setSelectedTier(subscriptionData.subscription?.current_tier ?? 'free');
    }
    load().catch((err) => setError(err.message));
  }, []);

  async function upgradePlan() {
    setError('');
    setStatus('Updating plan...');
    try {
      const amount = selectedTier === 'pro' ? 12000 : selectedTier === 'elite' ? 24000 : 0;
      const res = await fetch('/api/revenue/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_tier: selectedTier, amount_cents: amount, currency: 'NGN' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to update plan');
      setPlanData({ ...planData, current_tier: selectedTier });
      setStatus(`Upgraded to ${selectedTier}`);
    } catch (err) {
      setError((err as Error).message);
      setStatus('');
    }
  }

  async function buyFeatured() {
    setError('');
    setStatus('Purchasing featured listing...');
    try {
      const option = featuredOptions.find((opt) => opt.type === selectedFeatured);
      if (!option) throw new Error('Featured option not found');
      const res = await fetch('/api/revenue/featured', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: option.type, duration_days: option.duration_days, amount_cents: option.suggested_amount_cents, currency: 'NGN' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to purchase featured listing');
      setStatus('Featured listing purchased successfully');
    } catch (err) {
      setError((err as Error).message);
      setStatus('');
    }
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto' }}>
      <h1>Billing & Revenue</h1>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      <p style={{ marginTop: 12, color: '#4B5563' }}>Manage your subscription, promote your listing, and track revenue-driving features.</p>

      {planData ? (
        <section style={{ marginTop: 28, display: 'grid', gap: 20 }}>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Current plan</h2>
            <p>{planData.current_tier}</p>
            <p>Platform fee: {planData.platform_fee_percent}% of paid bookings</p>
          </div>

          <div style={{ padding: 24, borderRadius: 18, background: '#fff7ed', border: '1px solid #fcd34d' }}>
            <h2>Subscription plans</h2>
            {planData.plans.map((plan: SubscriptionPlan) => (
              <label key={plan.tier} style={{ display: 'block', marginBottom: 12 }}>
                <input
                  type="radio"
                  name="plan"
                  value={plan.tier}
                  checked={selectedTier === plan.tier}
                  onChange={() => setSelectedTier(plan.tier)}
                />
                <strong style={{ marginLeft: 8 }}>{plan.title}</strong> — {plan.description}
              </label>
            ))}
            <button onClick={upgradePlan} style={{ marginTop: 12, padding: '10px 18px', background: '#2563eb', color: '#fff', borderRadius: 10, border: 'none' }}>Upgrade plan</button>
          </div>

          <div style={{ padding: 24, borderRadius: 18, background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
            <h2>Featured listings</h2>
            {featuredOptions.map((option) => (
              <label key={option.type} style={{ display: 'block', marginBottom: 12 }}>
                <input
                  type="radio"
                  name="featured"
                  value={option.type}
                  checked={selectedFeatured === option.type}
                  onChange={() => setSelectedFeatured(option.type)}
                />
                <strong style={{ marginLeft: 8 }}>{option.title}</strong> — {option.description} ({option.suggested_amount_cents / 100} NGN)
              </label>
            ))}
            <button onClick={buyFeatured} style={{ marginTop: 12, padding: '10px 18px', background: '#047857', color: '#fff', borderRadius: 10, border: 'none' }}>Buy featured listing</button>
          </div>

          {status ? <p style={{ color: '#064e3b' }}>{status}</p> : null}
        </section>
      ) : (
        <p>Loading billing data…</p>
      )}
    </main>
  );
}
