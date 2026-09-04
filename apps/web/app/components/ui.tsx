import Link, { LinkProps } from 'next/link';
import { AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { buttonClass, ButtonVariant, classNames } from '@kajola/ui';
import { NIGERIA_STATE_LOCATIONS, locationSlug } from '../../lib/nigeria-locations';

export function KajolaLogoLink({ className, markClassName }: { className?: string; markClassName?: string }) {
  return <Link className={classNames('kj-logo-link', className)} href="/" aria-label="Kajola home"><span className={classNames('kj-logo-link__mark', markClassName)}>K</span><span>Kajola</span></Link>;
}

export function Brand() {
  return <KajolaLogoLink className="kj-shell__brand" markClassName="kj-shell__mark" />;
}

export function Button({ variant = 'primary', block, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; block?: boolean }) {
  return <button className={classNames(buttonClass(variant), block && 'kj-button--block', className)} {...props} />;
}

export function ButtonLink({ variant = 'primary', className, children, ...props }: LinkProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & { variant?: ButtonVariant; children: ReactNode }) {
  return <Link className={classNames(buttonClass(variant), className)} {...props}>{children}</Link>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input className={classNames('kj-input', props.className)} {...props} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={classNames('kj-select', props.className)} {...props} />; }
export function NigeriaLocationOptions({ allLabel = 'All Nigeria locations' }: { allLabel?: string }) {
  return <><option value="">{allLabel}</option>{NIGERIA_STATE_LOCATIONS.map(({ state, locations }) => <optgroup label={state} key={state}>{locations.map((location) => <option value={locationSlug(location)} key={location}>{location}</option>)}</optgroup>)}</>;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={classNames('kj-textarea', props.className)} {...props} />; }

export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return <label className="kj-field" htmlFor={htmlFor}>{label}{children}</label>;
}

export function Card({ children, interactive = false, className }: { children: ReactNode; interactive?: boolean; className?: string }) {
  return <div className={classNames('kj-card', interactive && 'kj-card--interactive', className)}>{children}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info' }) {
  return <span className={classNames('kj-badge', tone !== 'neutral' && `kj-badge--${tone}`)}>{children}</span>;
}

export function Alert({ children, tone = 'info' }: { children: ReactNode; tone?: 'success' | 'error' | 'info' }) {
  return <div className={`kj-alert kj-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Card><p className="kj-stat__label">{label}</p><p className="kj-stat__value">{value}</p>{sub ? <p className="kj-muted kj-small">{sub}</p> : null}</Card>;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="kj-empty"><h2 className="kj-heading-3">{title}</h2><p>{children}</p>{action}</div>;
}

export function Skeleton({ count = 3 }: { count?: number }) {
  return <div className="kj-stack" aria-label="Loading" aria-busy="true">{Array.from({ length: count }, (_, index) => <div className="kj-skeleton" key={index} />)}</div>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="kj-page-header"><div>{eyebrow ? <p className="kj-page-header__eyebrow">{eyebrow}</p> : null}<h1>{title}</h1>{description ? <p className="kj-page-header__description">{description}</p> : null}</div>{action}</header>;
}
