import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicShell } from '../../components/shells';
import { Card, PageHeader } from '../../components/ui';
import { INFO_PAGES, InfoPageSlug } from '../../../lib/info-pages';

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return Object.keys(INFO_PAGES).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const page = INFO_PAGES[params.slug as InfoPageSlug];
  return page ? { title: `${page.title} | Kajola`, description: page.summary } : {};
}

export default function InfoPage({ params }: Props) {
  const page = INFO_PAGES[params.slug as InfoPageSlug];
  if (!page) notFound();
  return <PublicShell><PageHeader eyebrow={page.eyebrow} title={page.title} description={page.summary} /><div className="kj-stack">{page.sections.map(([title, body]) => <Card key={title}><h2 className="kj-heading-3">{title}</h2><p className="kj-muted">{body}</p></Card>)}</div></PublicShell>;
}
