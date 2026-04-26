import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto' }}>
      <h1>Kajola Dashboard</h1>
      <p style={{ marginTop: 16, fontSize: 18, lineHeight: 1.7 }}>
        Welcome to Kajola. This scaffold includes auth pages, bookings routing, and Supabase function forwarding.
      </p>
      <div style={{ display: 'flex', gap: 16, marginTop: 32, flexWrap: 'wrap' }}>
        <Link href="/dashboard" style={{ padding: '14px 20px', background: '#2563eb', color: '#FFFFFF', borderRadius: 10, textDecoration: 'none', fontWeight: 700 }}>
          Open dashboard
        </Link>
        <Link href="/logout" style={{ padding: '14px 20px', background: '#ef4444', color: '#FFFFFF', borderRadius: 10, textDecoration: 'none', fontWeight: 700 }}>
          Log out
        </Link>
        <Link href="/auth/login" style={{ padding: '14px 20px', background: '#D9922A', color: '#0B0705', borderRadius: 10, textDecoration: 'none', fontWeight: 700 }}>
          Login
        </Link>
        <Link href="/auth/signup" style={{ padding: '14px 20px', background: '#111827', color: '#FFFFFF', borderRadius: 10, textDecoration: 'none', fontWeight: 700 }}>
          Sign up
        </Link>
      </div>
    </main>
  );
}
