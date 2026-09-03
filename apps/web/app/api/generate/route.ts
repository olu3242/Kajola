import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

function loadSkillMd(): string {
  // Resolve relative to the repo root (apps/web is two levels deep)
  const skillPath = join(process.cwd(), '..', '..', 'SKILL.md');
  try {
    return readFileSync(skillPath, 'utf-8');
  } catch {
    // Fallback: walk up from CWD until we find SKILL.md (handles different launch dirs)
    const altPath = join(process.cwd(), 'SKILL.md');
    return readFileSync(altPath, 'utf-8');
  }
}

export async function POST(req: NextRequest) {
  const { prompt } = await req.json();

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
    return new Response(JSON.stringify({ error: 'Prompt must be at least 10 characters.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const skillMd = loadSkillMd();
  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = client.messages.stream({
          model: 'claude-opus-5',
          max_tokens: 16000,
          system: skillMd,
          messages: [{ role: 'user', content: prompt.trim() }],
        });

        for await (const event of anthropicStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upstream error';
        controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache, no-store',
    },
  });
}
