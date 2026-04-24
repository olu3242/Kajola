'use client';

import { useEffect, useState } from 'react';

type Payment = {
  id: string;
  status: string;
  amount_cents: number;
  currency: string;
  created_at: string;
  provider: string;
  provider_reference: string;
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const token = window.localStorage.getItem('kajola_access_token');
      if (!token) {
        setError('Sign in to view payment history');
        setLoading(false);
        return;
      }
      const res = await fetch('/api/payments/history', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Unable to load payments');
      } else {
        setPayments(data.payments ?? []);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <h1>Payments</h1>
      {loading ? (
        <p>Loading…</p>
      ) : error ? (
        <p style={{ color: '#b91c1c' }}>{error}</p>
      ) : payments.length === 0 ? (
        <p>No payments found.</p>
      ) : (
        <div style={{ display: 'grid', gap: 20, marginTop: 24 }}>
          {payments.map((payment) => (
            <div key={payment.id} style={{ padding: 20, borderRadius: 18, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
              <p style={{ margin: 0, fontWeight: 700 }}>{payment.provider}</p>
              <p style={{ margin: '8px 0' }}>Amount: {payment.currency} {payment.amount_cents / 100}</p>
              <p style={{ margin: '8px 0' }}>Status: {payment.status}</p>
              <p style={{ margin: '8px 0' }}>Reference: {payment.provider_reference}</p>
              <p style={{ margin: '8px 0', color: '#6b7280' }}>{new Date(payment.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
