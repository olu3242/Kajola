'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  async function handleSendOtp() {
    if (!phone) {
      setMessage('Enter your phone number first.');
      return;
    }

    setMessage('');
    setSendingOtp(true);

    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'login' })
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? 'Failed to send OTP');
        setOtpSent(false);
      } else {
        setMessage('OTP sent. Check your phone or use debug code if testing.');
        setOtpSent(true);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error');
      setOtpSent(false);
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp_code: otp })
      });

      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? 'Login failed');
      } else {
        if (result.access_token) {
          window.localStorage.setItem('kajola_access_token', result.access_token);
        }
        if (result.refresh_token) {
          window.localStorage.setItem('kajola_refresh_token', result.refresh_token);
        }
        setMessage('Login successful. Session tokens saved locally.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Login</h1>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16, maxWidth: 420 }}>
        <label>
          Phone
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+2348123456789"
            style={{ width: '100%', padding: 12, fontSize: 16, marginTop: 8 }}
          />
        </label>
        <label>
          OTP Code
          <input
            type="text"
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
            placeholder="123456"
            style={{ width: '100%', padding: 12, fontSize: 16, marginTop: 8 }}
          />
        </label>
        <button type="button" onClick={handleSendOtp} style={{ padding: 14, borderRadius: 8, background: '#E5E7EB', color: '#111827', border: 'none', fontWeight: 700, marginBottom: 8 }} disabled={sendingOtp || !phone}>
          {sendingOtp ? 'Sending OTP…' : 'Send OTP'}
        </button>
        <button type="submit" style={{ padding: 14, borderRadius: 8, background: '#D9922A', color: '#0B0705', border: 'none', fontWeight: 700 }} disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {otpSent ? <p style={{ marginTop: 12, color: '#047857' }}>OTP request submitted.</p> : null}
      {message ? <p style={{ marginTop: 16 }}>{message}</p> : null}
    </main>
  );
}
