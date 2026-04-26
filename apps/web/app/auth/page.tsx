import Link from 'next/link';
import GoogleSignInButton from './GoogleSignInButton';

export default function AuthPage() {
  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto' }}>
      <h1>Auth</h1>
      <p style={{ marginTop: 16, fontSize: 18, lineHeight: 1.7 }}>
        Choose a flow to continue.
      </p>
      <div style={{ display: 'flex', gap: 16, marginTop: 32, flexWrap: 'wrap' }}>
        <Link href="/auth/login" style={{ padding: '14px 20px', background: '#D9922A', color: '#0B0705', borderRadius: 10, textDecoration: 'none', fontWeight: 700 }}>
          Login
        </Link>
        <Link href="/auth/signup" style={{ padding: '14px 20px', background: '#111827', color: '#FFFFFF', borderRadius: 10, textDecoration: 'none', fontWeight: 700 }}>
          Sign up
        </Link>
      </div>
      <GoogleSignInButton />
    </main>
  );
}
