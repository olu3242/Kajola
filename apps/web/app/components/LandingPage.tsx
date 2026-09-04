'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { MORE_CATEGORY_GROUPS, POPULAR_SERVICES, PRIMARY_CATEGORIES, SERVICE_CATEGORIES } from '../../lib/service-taxonomy';
import { NIGERIA_STATE_LOCATIONS, locationSlug } from '../../lib/nigeria-locations';
import { KajolaLogoLink, NigeriaLocationOptions } from './ui';
import KajolaVideoHero from './KajolaVideoHero';
import styles from './landing.module.css';

type ProviderPreview = {
  id: string; business_name: string; category: string; city: string; state?: string;
  avg_rating: number; total_reviews: number; image_url?: string; starting_price_kobo?: number | null;
};

type Suggestion = { type: 'Service' | 'Business' | 'Category' | 'Location'; label: string; href?: string; value?: string };

const footerGroups = [
  { title: 'Kajola', links: [['About Us', '/info/about'], ['Blog', '/info/blog'], ['FAQ', '/info/faq'], ['Contact', '/info/contact']] },
  { title: 'Legal & Trust', links: [['Privacy Policy', '/info/privacy'], ['Terms of Service', '/info/terms'], ['Trust Center', '/info/trust'], ['Security', '/info/security']] },
  { title: 'For Businesses', links: [['Kajola for Business', '/info/business'], ['Start onboarding', '/artisan/onboarding'], ['Business Resources', '/info/business-resources']] },
  { title: 'Company', links: [['Careers', '/info/careers'], ['Partners', '/info/partners'], ['About Kajola', '/info/about']] },
  { title: 'Customers', links: [['Discover', '/discovery'], ['Appointments', '/dashboard'], ['Profile', '/auth'], ['Help', '/info/faq']] },
] as const;

function titleCaseLocation(value: string) {
  return value.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}

export default function LandingPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreQuery, setMoreQuery] = useState('');
  const [providers, setProviders] = useState<ProviderPreview[]>([]);

  useEffect(() => {
    fetch('/api/artisans?limit=4').then((response) => response.json()).then((data) => setProviders(data.artisans ?? [])).catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [moreOpen]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const categories = SERVICE_CATEGORIES.filter((item) => item.label.toLowerCase().includes(needle) || item.aliases.some((alias) => alias.includes(needle))).slice(0, 3).map((item) => ({ type: 'Category' as const, label: item.label, href: `/discovery?category=${encodeURIComponent(item.label)}` }));
    const services = POPULAR_SERVICES.filter((item) => item.label.toLowerCase().includes(needle) || item.aliases.some((alias) => alias.includes(needle))).slice(0, 4).map((item) => ({ type: 'Service' as const, label: item.label, href: `/discovery?q=${encodeURIComponent(item.label)}` }));
    const businesses = providers.filter((item) => `${item.business_name} ${item.category}`.toLowerCase().includes(needle)).slice(0, 3).map((item) => ({ type: 'Business' as const, label: item.business_name, href: `/discovery/${item.id}` }));
    const locations = NIGERIA_STATE_LOCATIONS.flatMap(({ state, locations: places }) => places.map((place) => ({ state, place }))).filter(({ state, place }) => `${place} ${state}`.toLowerCase().includes(needle)).slice(0, 4).map(({ state, place }) => ({ type: 'Location' as const, label: `${place}, ${state}`, value: locationSlug(place) }));
    return [...services, ...businesses, ...categories, ...locations];
  }, [providers, query]);

  const visibleMoreGroups = useMemo(() => Object.entries(MORE_CATEGORY_GROUPS).map(([group, items]) => ({ group, items: items.filter((item) => !moreQuery || `${item.label} ${item.aliases.join(' ')}`.toLowerCase().includes(moreQuery.toLowerCase())) })).filter(({ items }) => items.length), [moreQuery]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (city) params.set('city', city);
    router.push(`/discovery${params.size ? `?${params.toString()}` : ''}`);
  }

  function chooseSuggestion(suggestion: Suggestion) {
    setSuggestionsOpen(false);
    if (suggestion.href) router.push(suggestion.href);
    else if (suggestion.value) setCity(suggestion.value);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <KajolaLogoLink className={styles.logo} markClassName={styles.logoMark} />
        <nav className={styles.nav} aria-label="Main navigation"><a href="#categories">Discover</a><a href="#how-it-works">How it works</a><a href="#for-business">For business</a><Link href="/info/about">About</Link></nav>
        <div className={styles.headerActions}><Link className={styles.loginLink} href="/auth/login">Log in</Link><Link className={styles.headerCta} href="/artisan/onboarding">List your business</Link></div>
      </header>

      <KajolaVideoHero />

      <section className={styles.discoveryStart} id="discover-kajola" aria-labelledby="discover-title">
        <div className={styles.discoveryIntro}><p className={styles.kicker}>Discover Kajola</p><h2 id="discover-title">Find trusted services near you.</h2></div>
        <form className={styles.searchPanel} onSubmit={submitSearch} role="search">
          <div className={`${styles.searchField} ${styles.searchSuggest}`}>
            <label htmlFor="marketplace-search">What do you need?</label>
            <input id="marketplace-search" role="combobox" aria-autocomplete="list" placeholder="Search services or businesses" value={query} autoComplete="off" onFocus={() => setSuggestionsOpen(true)} onChange={(event) => { setQuery(event.target.value); setSuggestionsOpen(true); }} aria-expanded={suggestionsOpen && Boolean(query)} aria-controls="marketplace-suggestions" />
            {suggestionsOpen && query ? <div className={styles.suggestions} id="marketplace-suggestions" role="listbox">{suggestions.map((suggestion) => <button type="button" role="option" aria-selected="false" key={`${suggestion.type}-${suggestion.label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(suggestion)}><span>{suggestion.type}</span>{suggestion.label}</button>)}<button type="button" role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()} onClick={() => router.push(`/discovery?category=Other&q=${encodeURIComponent(query)}`)}><span>Other</span>Can&apos;t find it? Search for “{query}”</button></div> : null}
          </div>
          <span className={styles.fieldDivider} />
          <div className={styles.searchField}><label htmlFor="city">Where?</label><select id="city" value={city} onChange={(event) => { setCity(event.target.value); setSuggestionsOpen(false); }}><NigeriaLocationOptions /></select></div>
          <button className={styles.searchButton} type="submit">Find services <span>→</span></button>
        </form>
      </section>

      <section className={styles.categoryBand} id="categories" aria-labelledby="categories-title">
        <div className={styles.categoryHeading}><div><p className={styles.kicker}>Explore Kajola</p><h2 id="categories-title">Popular categories</h2></div><p>Beauty, wellness, home, professional services, and more.</p></div>
        <div className={styles.categoryStrip}>{PRIMARY_CATEGORIES.map((item) => <Link key={item.id} href={`/discovery?category=${encodeURIComponent(item.label)}`} data-testid={`category-${item.id}`}><span aria-hidden="true">{item.icon}</span>{item.label}</Link>)}<button type="button" aria-expanded={moreOpen} aria-controls="more-categories" onClick={() => setMoreOpen(true)}><span aria-hidden="true">＋</span>More...</button></div>
      </section>

      {moreOpen ? <div className={styles.moreBackdrop} onMouseDown={() => setMoreOpen(false)}><section className={styles.morePanel} id="more-categories" role="dialog" aria-modal="true" aria-labelledby="more-title" onMouseDown={(event) => event.stopPropagation()}><div className={styles.moreHeader}><div><p className={styles.kicker}>All of Kajola</p><h2 id="more-title">More categories</h2></div><button type="button" aria-label="Close more categories" onClick={() => setMoreOpen(false)}>×</button></div><label className={styles.moreSearch}>Search categories<input value={moreQuery} onChange={(event) => setMoreQuery(event.target.value)} placeholder="Try home, fitness, repairs…" autoFocus /></label><div className={styles.moreGroups}>{visibleMoreGroups.map(({ group, items }) => <div key={group}><h3>{group}</h3>{items.map((item) => <Link key={item.id} href={`/discovery?category=${encodeURIComponent(item.label)}`} onClick={() => setMoreOpen(false)}><span aria-hidden="true">{item.icon}</span>{item.label}</Link>)}</div>)}</div></section></div> : null}

      <section className={styles.section} id="services"><div className={styles.sectionHeading}><div><p className={styles.kicker}>Easy starting points</p><h2>Popular services</h2></div><Link href="/discovery">Browse the marketplace <span>→</span></Link></div><div className={styles.serviceCloud}>{POPULAR_SERVICES.map((item) => <Link key={item.id} href={`/discovery?q=${encodeURIComponent(item.label)}`} data-testid={`service-${item.id}`}>{item.label}<span>→</span></Link>)}</div></section>

      <section className={styles.recommended} aria-labelledby="recommended-title"><div className={styles.sectionHeading}><div><p className={styles.kicker}>Trusted near you</p><h2 id="recommended-title">Recommended professionals</h2></div><Link href="/discovery">See everyone <span>→</span></Link></div><div className={styles.providerGrid}>{providers.map((provider) => <Link href={`/discovery/${provider.id}`} className={styles.providerCard} key={provider.id}><span className={styles.providerImage}><Image src={provider.image_url ?? '/landing/neighborhood-services.jpg'} alt="" fill sizes="(max-width: 620px) 82vw, 280px" /></span><span className={styles.providerBody}><small>{provider.category}</small><strong>{provider.business_name}</strong><span>★ {provider.avg_rating.toFixed(1)} ({provider.total_reviews})</span><span>{titleCaseLocation(provider.city)}, {provider.state ?? 'Nigeria'}</span><b>{provider.starting_price_kobo ? `From ₦${(provider.starting_price_kobo / 100).toLocaleString()}` : 'View services'} →</b></span></Link>)}</div></section>

      <section className={styles.stepsSection} id="how-it-works"><div className={styles.stepsIntro}><p className={styles.kicker}>Find. Book. Pay. Return.</p><h2>One clear path from need to trusted service.</h2><p>Search the marketplace, compare transparent details, choose real availability, and keep the appointment in one place.</p><Link className={styles.darkButton} href="/discovery">Explore near you <span>→</span></Link></div><ol className={styles.stepsList}>{['Discover', 'Choose', 'Book', 'Pay', 'Attend', 'Review', 'Rebook'].map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{step}</h3><p>{index === 0 ? 'Search by service, business, or location.' : index === 1 ? 'Compare price, reputation, and availability.' : index === 2 ? 'Reserve a real time with your chosen professional.' : index === 3 ? 'Confirm the required deposit securely.' : index === 4 ? 'Arrive with every appointment detail ready.' : index === 5 ? 'Share verified feedback after completion.' : 'Return to a provider you already trust.'}</p></div></li>)}</ol></section>

      <section className={styles.appointmentPreview} aria-labelledby="appointment-title"><div><p className={styles.kicker}>Your appointment, at a glance</p><h2 id="appointment-title">Everything you need before you go.</h2><p>Kajola keeps the provider, service, price, location, and time together—without pretending a booking is confirmed before payment.</p></div><article><div><span className={styles.statusDot} />Confirmed appointment</div><h3>Haircut &amp; Beard</h3><p>Tunde&apos;s Fade Room · Allen Avenue, Ikeja</p><dl><div><dt>Date</dt><dd>Saturday, 10:30 AM</dd></div><div><dt>Professional</dt><dd>Tunde Adeyemi</dd></div><div><dt>Total</dt><dd>₦5,500</dd></div><div><dt>Deposit paid</dt><dd>₦1,650</dd></div></dl><Link href="/discovery/tunde-1/services">View real availability →</Link></article></section>

      <section className={styles.businessSection} id="for-business"><div className={styles.businessImage}><Image src="/landing/salon-owner.jpg" alt="A service business owner in her salon" fill sizes="(max-width: 800px) 100vw, 50vw" /><div className={styles.bookingBadge}><b>Booking confirmed</b><span>Today · 2:30 PM</span></div></div><div className={styles.businessCopy}><p className={styles.kicker}>Kajola for your business</p><h2>Run your business,<br />better.</h2><p>Calendar, bookings, marketing, and payments—all in one Kajola workspace.</p><ul><li><span>✓</span> Calendar and real availability</li><li><span>✓</span> Services, customers, and payments</li><li><span>✓</span> Performance and growth insights</li></ul><Link className={styles.primaryButton} href="/artisan/onboarding">Grow my business <span>→</span></Link></div></section>

      <section className={styles.finalCta}><p className={styles.kicker}>Your neighborhood, connected</p><h2>Good help is closer than you think.</h2><p>Discover the people who make your city work.</p><div><Link className={styles.primaryButton} href="/discovery">Find a professional</Link><Link className={styles.outlineButton} href="/auth/signup">Create an account</Link></div></section>

      <footer className={styles.footer}><div className={styles.footerBrand}><KajolaLogoLink className={styles.logo} markClassName={styles.logoMark} /><p>Africa’s Service Commerce Operating System.</p></div><div className={styles.footerGrid}>{footerGroups.map((group) => <section key={group.title}><h2>{group.title}</h2>{group.links.map(([label, href]) => <Link href={href} key={`${label}-${href}`}>{label}</Link>)}</section>)}</div><p className={styles.footerBase}>© {new Date().getFullYear()} Kajola. Trusted services and practical business tools, built for African markets.</p></footer>

      <nav className={styles.mobileNav} aria-label="Customer mobile navigation"><Link href="/discovery"><span aria-hidden="true">⌕</span>Explore</Link><Link href="/dashboard"><span aria-hidden="true">□</span>Appointments</Link><Link href="/auth"><span aria-hidden="true">○</span>Profile</Link></nav>
    </main>
  );
}
