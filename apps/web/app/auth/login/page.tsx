'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthShell } from '../../components/shells';
import { Alert, Button, Field, Input } from '../../components/ui';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? '/discovery';
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('error');
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  async function handleSendOtp() {
    if (!phone.trim()) { setMessageTone('error'); setMessage('Enter your phone number first.'); return; }
    setMessage(''); setSendingOtp(true);
    try {
      const response = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), purpose: 'login' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Failed to send OTP.');
      setMessageTone('success'); setMessage('OTP sent to your phone.'); setOtpSent(true);
    } catch (reason) { setMessageTone('error'); setMessage(reason instanceof Error ? reason.message : 'Network error — please try again.'); }
    finally { setSendingOtp(false); }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!phone.trim() || !otp.trim()) { setMessageTone('error'); setMessage('Enter both phone and OTP code.'); return; }
    setMessage(''); setLoading(true);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), otp_code: otp.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Login failed.');
      router.replace(redirectTo);
    } catch (reason) { setMessageTone('error'); setMessage(reason instanceof Error ? reason.message : 'Network error — please try again.'); }
    finally { setLoading(false); }
  }

  return <AuthShell><p className="kj-page-header__eyebrow">Customer access</p><h1>Sign in to Kajola</h1><p>Continue to your bookings and trusted local professionals.</p><form className="kj-form" onSubmit={handleSubmit}>
    <Field label="Phone number" htmlFor="login-phone"><Input id="login-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+234 812 345 6789" autoComplete="tel" required /></Field>
    <Button type="button" variant="outline" block onClick={handleSendOtp} disabled={sendingOtp || !phone.trim()}>{sendingOtp ? 'Sending…' : otpSent ? 'Resend OTP' : 'Send OTP'}</Button>
    {otpSent ? <><Field label="OTP code" htmlFor="login-otp"><Input id="login-otp" inputMode="numeric" value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="123456" autoComplete="one-time-code" maxLength={6} required /></Field><Button type="submit" block disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</Button></> : null}
  </form>{message ? <div style={{ marginTop: 'var(--space-4)' }}><Alert tone={messageTone}>{message}</Alert></div> : null}<p className="kj-small kj-muted" style={{ textAlign: 'center', marginTop: 'var(--space-6)' }}>New to Kajola? <Link href="/auth/signup">Create an account</Link></p></AuthShell>;
}

export default function LoginPage() { return <Suspense fallback={<AuthShell><div className="kj-skeleton" /></AuthShell>}><LoginForm /></Suspense>; }
