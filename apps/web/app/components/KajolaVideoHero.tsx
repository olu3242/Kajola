'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './landing.module.css';

const statements = ['Be Seen.', 'Be Heard.', 'Believe in Kajola.'] as const;

export default function KajolaVideoHero() {
  const video = useRef<HTMLVideoElement>(null);
  const [statement, setStatement] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const videoSrc = process.env.NEXT_PUBLIC_KAJOLA_HERO_VIDEO_URL?.trim();

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setStatement(2);
      video.current?.pause();
      return;
    }

    void video.current?.play().catch(() => undefined);
    const timer = window.setInterval(() => setStatement((current) => (current + 1) % statements.length), 3000);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  return (
    <section className={styles.hero} aria-labelledby="kajola-frontdoor-title" data-testid="cinematic-frontdoor">
      <video
        ref={video}
        className={styles.heroVideo}
        src={videoSrc || undefined}
        poster="/landing/neighborhood-services.jpg"
        autoPlay={!reducedMotion}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        data-media-ready={Boolean(videoSrc)}
      />
      <div className={styles.heroShade} />
      <div className={styles.heroContent} aria-live="polite" aria-atomic="true">
        <h1 id="kajola-frontdoor-title" data-testid="hero-title" key={statements[statement]}>{statements[statement]}</h1>
      </div>
      <a className={styles.scrollAffordance} href="#discover-kajola" aria-label="Explore Kajola services"><span>Explore</span><i aria-hidden="true">↓</i></a>
    </section>
  );
}
