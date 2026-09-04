import Link from 'next/link';
import { ReactNode } from 'react';
import { KajolaLogoLink } from './ui';

type ShellProps = { children: ReactNode; wide?: boolean; customerNav?: boolean };

export function PublicShell({ children, wide, customerNav = true }: ShellProps) {
  return <div className={`kj-shell${customerNav ? ' kj-shell--customer-nav' : ''}`}><header className="kj-shell__header"><KajolaLogoLink className="kj-shell__brand" markClassName="kj-shell__mark" /><nav className="kj-shell__nav" aria-label="Public navigation"><Link href="/discovery">Discover</Link><Link className="kj-nav-optional" href="/artisan/onboarding">For business</Link><Link href="/auth/login">Log in</Link></nav></header><main className={`kj-shell__main${wide ? ' kj-shell__main--wide' : ''}`}>{children}</main><footer className="kj-public-footer"><KajolaLogoLink className="kj-shell__brand" markClassName="kj-shell__mark" /><span>Africa’s Service Commerce Operating System</span></footer>{customerNav ? <nav className="kj-mobile-nav" aria-label="Customer mobile navigation"><Link href="/discovery"><span aria-hidden="true">⌕</span>Explore</Link><Link href="/dashboard"><span aria-hidden="true">□</span>Appointments</Link><Link href="/auth"><span aria-hidden="true">○</span>Profile</Link></nav> : null}</div>;
}

const personaNav = {
  customer: [['Bookings', '/dashboard'], ['Discover', '/discovery']],
  provider: [['Dashboard', '/artisan/dashboard'], ['Workspace', '/artisan/workspace'], ['Billing', '/artisan/billing']],
  owner: [['Dashboard', '/owner/dashboard'], ['Payment settings', '/owner/payment-settings'], ['Provider view', '/artisan/workspace']],
  admin: [['Operations', '/admin/dashboard']],
} as const;

export function AppShell({ persona, children, wide = true }: ShellProps & { persona: keyof typeof personaNav }) {
  return <div className="kj-shell"><header className="kj-shell__header"><KajolaLogoLink className="kj-shell__brand" markClassName="kj-shell__mark" /><nav className="kj-shell__nav" aria-label={`${persona} navigation`}>{personaNav[persona].map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}<Link className="kj-nav-optional" href="/logout">Log out</Link></nav></header><main className={`kj-shell__main${wide ? ' kj-shell__main--wide' : ''}`}>{children}</main></div>;
}

export function AuthShell({ children }: { children: ReactNode }) {
  return <main className="kj-auth"><section className="kj-auth__brand"><KajolaLogoLink className="kj-shell__brand" markClassName="kj-shell__mark" /><h2>Africa’s Service Commerce Operating System</h2><p>Trusted local services and the tools that help independent businesses grow.</p></section><section className="kj-auth__panel"><div className="kj-auth__card">{children}</div></section></main>;
}
