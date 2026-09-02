'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const redirectTo   = searchParams.get('redirect') ?? '/discovery';

  const [phone,      setPhone]      = useState('');
  const [otp,        setOtp]        = useState('');
  const [message,    setMessage]    = useState('');
  const [loading,    setLoading]    = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpSent,    setOtpSent]    = useState(false);

  async function handleSendOtp() {
    if (!phone.trim()) { setMessage('Enter your phone number first.'); return; }
    setMessage('');
    setSendingOtp(true);
    try {
      const res = await fetch('/api/auth/send-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone: phone.trim(), purpose: 'login' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? 'Failed to send OTP');
      } else {
        setMessage('OTP sent to your phone.');
        setOtpSent(true);
      }
    } catch {
      setMessage('Network error — please try again.');
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() || !otp.trim()) {
      setMessage('Enter both phone and OTP code.');
      return;
    }
    setMessage('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone: phone.trim(), otp_code: otp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? 'Login failed');
      } else {
        // Session stored in httpOnly cookie by the route handler
        router.replace(redirectTo);
      }
    } catch {
      setMessage('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 8,
    border: '1.5px solid #D1D5DB', marginTop: 6, boxSizing: 'border-box',
  };
  const btnBase: React.CSSProperties = {
    width: '100%', padding: '13px 0', borderRadius: 8, border: 'none',
    fontWeight: 700, fontSize: 15, cursor: 'pointer',
  };

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: '100%', maxWidth: 420, boxShadow: '0 2px 16px rgba(0,0,0,.08)' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 24 }}>Sign in to Kajola</h1>
        <p style={{ margin: '0 0 24px', color: '#6B7280', fontSize: 14 }}>
          Book beauty, barber, and salon services in Lagos.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>
            Phone number
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+2348123456789"
              autoComplete="tel"
              style={inputStyle}
            />
          </label>

          <button
            type="button"
            onClick={handleSendOtp}
            disabled={sendingOtp || !phone.trim()}
            style={{ ...btnBase, background: sendingOtp ? '#E5E7EB' : '#F3F4F6', color: '#374151' }}
          >
            {sendingOtp ? 'Sending…' : otpSent ? 'Resend OTP' : 'Send OTP'}
          </button>

          {otpSent && (
            <label style={{ fontSize: 14, fontWeight: 600 }}>
              OTP code
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                autoComplete="one-time-code"
                maxLength={6}
                style={inputStyle}
              />
            </label>
          )}

          {otpSent && (
            <button
              type="submit"
              disabled={loading}
              style={{ ...btnBase, background: '#D9922A', color: '#0B0705' }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          )}
        </form>

        {message && (
          <p style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8,
            background: message.toLowerCase().includes('sent') ? '#ECFDF5' : '#FEF2F2',
            color:      message.toLowerCase().includes('sent') ? '#065F46' : '#991B1B',
            fontSize: 14 }}>
            {message}
          </p>
        )}

        <p style={{ marginTop: 20, fontSize: 13, color: '#9CA3AF', textAlign: 'center' }}>
          New to Kajola?{' '}
          <a href="/auth/signup" style={{ color: '#D9922A', fontWeight: 600 }}>Create an account</a>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
