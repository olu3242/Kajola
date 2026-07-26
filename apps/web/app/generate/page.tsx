'use client';

import { useState, useRef, useCallback } from 'react';

const EXAMPLE_PROMPTS = [
  {
    label: 'Artisan booking — Nigeria',
    text: 'Design the full system architecture for ArtisanHub. It\'s a multi-tenant booking platform for Nigerian artisans (barbers, tailors, mechanics). Clients discover and pay via Paystack. Need full system architecture.',
  },
  {
    label: 'Beauty salon chain — Kenya',
    text: 'Design the full system architecture for GlamPlus. It\'s a multi-branch beauty salon chain in Kenya. Stylists offer services, clients book and pay via M-Pesa. Loyalty stamps, waitlist, and franchise management needed.',
  },
  {
    label: 'Telemedicine — Nigeria',
    text: 'Design the full system architecture for MedConnect. It\'s a telemedicine platform for Nigeria. Patients book video consultations with doctors. Paystack payments, Termii OTP, Whereby video calls.',
  },
  {
    label: 'Home services — Ghana',
    text: 'Design the full system architecture for HomePro Ghana. It\'s a home services marketplace for Ghana. Plumbers, electricians, and cleaners get dispatched. MTN MoMo payments, GPS tracking, photo evidence.',
  },
];

const VERTICALS = [
  'Beauty & Hair', 'Health & Wellness', 'Home Services', 'Fitness & Gym',
  'Automotive', 'Pet Care', 'Logistics', 'Telemedicine', 'Equipment Rental',
  'Wedding & Events', 'Education & Tutoring', 'Food & Catering',
];

const MARKETS = [
  'Nigeria (NGN · Paystack · Termii)',
  'Kenya (KES · M-Pesa · Africa\'s Talking)',
  'Ghana (GHS · MTN MoMo)',
  'Côte d\'Ivoire (XOF · Orange Money)',
  'Nigeria + Ghana',
  'East Africa (KE + UG + TZ)',
  'Pan-Africa',
];

const SECTIONS = [
  'PRD', 'System Architecture', 'Full SQL Schema', 'API Definitions',
  'Frontend Structure', 'Monorepo Layout', 'Automation Engine',
  'Deployment Plan', 'Monetization Strategy', 'Scaling Plan', 'Roadmap',
];

function splitSections(text: string): Record<string, string> {
  const sectionRe = /^##\s+(?:Section\s+\d+[:\s–-]+|(?:\d+\.\s+)?)(.+)$/m;
  const byNumber: Record<string, string> = { All: text };

  SECTIONS.forEach((name, idx) => {
    const n = idx + 1;
    const re = new RegExp(
      `(?:^#{1,3}\\s+(?:Section\\s+${n}[:\\s–-]+|${n}\\.?\\s+).+$)`,
      'im',
    );
    const match = text.search(re);
    if (match !== -1) {
      // Find next section heading
      const rest = text.slice(match);
      const nextMatch = rest.search(/^#{1,3}\s+(?:Section\s+\d+|[1-9]\d*\.)/im);
      byNumber[name] = nextMatch > 0 ? rest.slice(0, nextMatch) : rest;
    }
  });

  return byNumber;
}

function MarkdownBlock({ text }: { text: string }) {
  // Lightweight renderer: code fences, bold, headings, lists
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let key = 0;

  function flushCode() {
    elements.push(
      <div key={key++} style={{ position: 'relative', marginBottom: 16 }}>
        {codeLang && (
          <span style={{
            position: 'absolute', top: 8, right: 10,
            fontSize: 10, color: '#7A8299',
            fontFamily: 'var(--mono, monospace)', textTransform: 'uppercase', letterSpacing: '.08em',
          }}>{codeLang}</span>
        )}
        <pre style={{
          background: '#0D1321', color: '#E4DDD0', borderRadius: 6,
          padding: '28px 16px 14px', overflowX: 'auto', fontSize: 12.5,
          fontFamily: 'var(--mono, "SF Mono", "Fira Code", monospace)', lineHeight: 1.6,
          border: '1px solid #232E48',
        }}>
          {codeLines.join('\n')}
        </pre>
      </div>
    );
    codeLines = [];
    codeLang = '';
  }

  function renderInline(s: string): React.ReactNode {
    const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => {
      if (p.startsWith('`') && p.endsWith('`'))
        return <code key={i} style={{ background: '#1C263E', borderRadius: 3, padding: '1px 5px', fontSize: '0.88em', fontFamily: 'var(--mono, monospace)' }}>{p.slice(1, -1)}</code>;
      if (p.startsWith('**') && p.endsWith('**'))
        return <strong key={i}>{p.slice(2, -2)}</strong>;
      return p;
    });
  }

  for (const raw of lines) {
    const line = raw;
    if (line.startsWith('```')) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^(#{1,6})/)?.[1].length ?? 1;
      const content = line.replace(/^#{1,6}\s+/, '');
      const Tag = `h${Math.min(level + 1, 6)}` as keyof JSX.IntrinsicElements;
      elements.push(
        <Tag key={key++} style={{ marginTop: level === 1 ? 28 : 18, marginBottom: 6, lineHeight: 1.3, fontWeight: 700, color: level <= 2 ? '#C8911A' : 'inherit' }}>
          {renderInline(content)}
        </Tag>
      );
    } else if (/^[-*]\s/.test(line)) {
      elements.push(
        <li key={key++} style={{ marginLeft: 18, marginBottom: 3 }}>{renderInline(line.slice(2))}</li>
      );
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(
        <li key={key++} style={{ marginLeft: 18, marginBottom: 3, listStyleType: 'decimal' }}>{renderInline(line.replace(/^\d+\.\s/, ''))}</li>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={key++} style={{ height: 8 }} />);
    } else {
      elements.push(<p key={key++} style={{ marginBottom: 8 }}>{renderInline(line)}</p>);
    }
  }

  if (inCode) flushCode();

  return <div style={{ fontSize: 14, lineHeight: 1.75 }}>{elements}</div>;
}

export default function GeneratePage() {
  const [prompt, setPrompt] = useState('');
  const [market, setMarket] = useState(MARKETS[0]);
  const [vertical, setVertical] = useState('');
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('All');
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const sections = done ? splitSections(output) : {};
  const availableSections = done ? ['All', ...SECTIONS.filter(s => sections[s])] : [];

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || streaming) return;

    const fullPrompt = [
      prompt.trim(),
      vertical ? `Vertical: ${vertical}.` : '',
      `Target market: ${market}.`,
      'Generate the full 11-section architecture package.',
    ].filter(Boolean).join(' ');

    setOutput('');
    setError('');
    setDone(false);
    setActiveSection('All');
    setStreaming(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? 'Generation failed');
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: rdone, value } = await reader.read();
        if (rdone) break;
        buffer += decoder.decode(value, { stream: true });
        setOutput(buffer);
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      }

      setDone(true);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setStreaming(false);
    }
  }, [prompt, market, vertical, streaming]);

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
    if (output) setDone(true);
  };

  const handleDownload = () => {
    const blob = new Blob([output], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kajola-architecture.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const displayText = done && activeSection !== 'All' ? (sections[activeSection] ?? '') : output;

  return (
    <div style={{ minHeight: '100vh', background: '#0D1321', color: '#E4DDD0', fontFamily: 'system-ui,-apple-system,"Segoe UI",sans-serif' }}>

      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(13,19,33,.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #232E48', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href="/" style={{ fontFamily: 'monospace', fontWeight: 900, letterSpacing: '-.04em', fontSize: 18, color: '#C8911A' }}>Kajola</a>
        <span style={{ fontSize: 12, color: '#7A8299', fontFamily: 'monospace' }}>Architecture Generator</span>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px', display: 'grid', gridTemplateColumns: output ? '380px 1fr' : '1fr', gap: 24, alignItems: 'start' }}>

        {/* Input Panel */}
        <div style={{ background: '#141C32', border: '1px solid #232E48', borderRadius: 10, padding: 24, position: 'sticky', top: 72 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#C8911A', marginBottom: 16 }}>
            Describe your platform
          </div>

          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="e.g. Design the full system architecture for GlamPlus. It's a multi-branch beauty salon chain in Kenya…"
            rows={6}
            style={{
              width: '100%', background: '#0D1321', border: '1px solid #232E48', borderRadius: 6,
              color: '#E4DDD0', padding: '12px 14px', fontSize: 13.5, lineHeight: 1.65,
              fontFamily: 'inherit', resize: 'vertical', outline: 'none',
              transition: 'border-color .2s',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = '#C8911A')}
            onBlur={e => (e.currentTarget.style.borderColor = '#232E48')}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: '#7A8299', fontFamily: 'monospace', letterSpacing: '.06em', textTransform: 'uppercase' }}>Market</label>
              <select
                value={market}
                onChange={e => setMarket(e.target.value)}
                style={{ width: '100%', marginTop: 4, background: '#0D1321', border: '1px solid #232E48', borderRadius: 6, color: '#E4DDD0', padding: '8px 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
              >
                {MARKETS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#7A8299', fontFamily: 'monospace', letterSpacing: '.06em', textTransform: 'uppercase' }}>Vertical</label>
              <select
                value={vertical}
                onChange={e => setVertical(e.target.value)}
                style={{ width: '100%', marginTop: 4, background: '#0D1321', border: '1px solid #232E48', borderRadius: 6, color: '#E4DDD0', padding: '8px 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
              >
                <option value="">— any —</option>
                {VERTICALS.map(v => <option key={v}>{v}</option>)}
              </select>
            </div>
          </div>

          {/* Example chips */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: '#7A8299', fontFamily: 'monospace', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Quick examples</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {EXAMPLE_PROMPTS.map(ex => (
                <button
                  key={ex.label}
                  onClick={() => setPrompt(ex.text)}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 20,
                    border: '1px solid #C8911A33', background: 'rgba(200,145,26,.08)',
                    color: '#C8911A', cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,145,26,.18)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(200,145,26,.08)')}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            {streaming ? (
              <button
                onClick={handleStop}
                style={{ flex: 1, padding: '12px 0', background: '#ef4444', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                style={{
                  flex: 1, padding: '12px 0', background: prompt.trim() ? '#C8911A' : '#232E48',
                  color: prompt.trim() ? '#0D1321' : '#7A8299', borderRadius: 8,
                  fontWeight: 700, fontSize: 14, border: 'none',
                  cursor: prompt.trim() ? 'pointer' : 'not-allowed', transition: 'background .2s',
                }}
              >
                Generate Architecture
              </button>
            )}
            {done && (
              <button
                onClick={handleDownload}
                style={{ padding: '12px 16px', background: '#1C263E', color: '#E4DDD0', border: '1px solid #232E48', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                title="Download as Markdown"
              >
                ↓ .md
              </button>
            )}
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, fontSize: 12.5, color: '#f87171' }}>
              {error}
            </div>
          )}

          {streaming && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#7A8299', fontFamily: 'monospace' }}>
              <span style={{ display: 'inline-block', animation: 'spin 1.5s linear infinite', marginRight: 6 }}>⟳</span>
              Generating full 11-section architecture…
            </div>
          )}
        </div>

        {/* Output Panel */}
        {output && (
          <div style={{ background: '#141C32', border: '1px solid #232E48', borderRadius: 10, overflow: 'hidden' }}>

            {/* Section tabs */}
            {done && availableSections.length > 1 && (
              <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid #232E48', padding: '0 16px', gap: 2, scrollbarWidth: 'none' }}>
                {availableSections.map(s => (
                  <button
                    key={s}
                    onClick={() => setActiveSection(s)}
                    style={{
                      padding: '10px 14px', fontSize: 12, fontFamily: 'inherit', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: '2px solid',
                      borderBottomColor: activeSection === s ? '#C8911A' : 'transparent',
                      background: 'none', color: activeSection === s ? '#C8911A' : '#7A8299',
                      fontWeight: activeSection === s ? 700 : 400, transition: 'color .15s',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Content */}
            <div
              ref={outputRef}
              style={{ padding: 24, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', overflowX: 'hidden' }}
            >
              {streaming && !done && (
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#2B7A6A', marginBottom: 12 }}>
                  ● streaming
                </div>
              )}
              <MarkdownBlock text={displayText} />
              {streaming && (
                <span style={{ display: 'inline-block', width: 2, height: 16, background: '#C8911A', marginLeft: 2, animation: 'blink 1s steps(1) infinite', verticalAlign: 'middle' }} />
              )}
            </div>
          </div>
        )}

        {/* Empty state — full width */}
        {!output && (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
            <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-.04em', marginBottom: 12 }}>
              One prompt. Full architecture.
            </h1>
            <p style={{ fontSize: 16, color: '#7A8299', maxWidth: 520, margin: '0 auto 32px', lineHeight: 1.7 }}>
              Describe your service platform and Kajola generates a complete 11-section architecture package — SQL schema, API definitions, Edge Functions, and more.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, maxWidth: 700, margin: '0 auto' }}>
              {['Full SQL Schema', 'API Definitions', 'Automation Engine', 'Deployment Plan', 'Monetization', 'SORF Lifecycle'].map(s => (
                <div key={s} style={{ background: '#141C32', border: '1px solid #232E48', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#7A8299', fontFamily: 'monospace' }}>
                  {s}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#232E48;border-radius:3px}
      `}</style>
    </div>
  );
}
