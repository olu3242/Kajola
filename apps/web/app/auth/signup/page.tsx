'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '../../components/shells';
import { Alert, Button, Field, Input } from '../../components/ui';
import GoogleSignInButton from '../GoogleSignInButton';

export default function SignupPage() {
  const [phone, setPhone] = useState(''); const [otp, setOtp] = useState(''); const [fullName, setFullName] = useState('');
  const [message, setMessage] = useState(''); const [tone, setTone] = useState<'success' | 'error'>('error');
  const [loading, setLoading] = useState(false); const [sendingOtp, setSendingOtp] = useState(false); const [otpSent, setOtpSent] = useState(false);

  async function handleSendOtp() {
    if (!phone.trim()) { setMessage('Enter your phone number first.'); return; }
    setMessage(''); setSendingOtp(true);
    try { const response = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), purpose: 'signup' }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Failed to send OTP.'); setTone('success'); setMessage('OTP sent. Check your phone for the code.'); setOtpSent(true); }
    catch (reason) { setTone('error'); setMessage(reason instanceof Error ? reason.message : 'Unexpected error.'); setOtpSent(false); }
    finally { setSendingOtp(false); }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(''); setLoading(true);
    try { const response = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), otp_code: otp.trim(), full_name: fullName.trim() }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Signup failed.'); if (data.access_token) window.localStorage.setItem('kajola_access_token', data.access_token); if (data.refresh_token) window.localStorage.setItem('kajola_refresh_token', data.refresh_token); setTone('success'); setMessage('Account created. You can now sign in.'); }
    catch (reason) { setTone('error'); setMessage(reason instanceof Error ? reason.message : 'Unexpected error.'); }
    finally { setLoading(false); }
  }

  return <AuthShell><p className="kj-page-header__eyebrow">Create your account</p><h1>Join Kajola</h1><p>Discover trusted services and keep every booking in one place.</p><form className="kj-form" onSubmit={handleSubmit}>
    <Field label="Full name" htmlFor="signup-name"><Input id="signup-name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Amina Ade" autoComplete="name" required /></Field>
    <Field label="Phone number" htmlFor="signup-phone"><Input id="signup-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+234 812 345 6789" autoComplete="tel" required /></Field>
    <Button type="button" variant="outline" block onClick={handleSendOtp} disabled={sendingOtp || !phone.trim()}>{sendingOtp ? 'Sending OTP…' : otpSent ? 'Resend OTP' : 'Send OTP'}</Button>
    {otpSent ? <><Field label="OTP code" htmlFor="signup-otp"><Input id="signup-otp" inputMode="numeric" value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="123456" autoComplete="one-time-code" maxLength={6} required /></Field><Button type="submit" block disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</Button></> : null}
  </form>{message ? <div style={{ marginTop: 'var(--space-4)' }}><Alert tone={tone}>{message}</Alert></div> : null}<GoogleSignInButton /><p className="kj-small kj-muted" style={{ textAlign: 'center' }}>Already registered? <Link href="/auth/login">Log in</Link></p></AuthShell>;
}
