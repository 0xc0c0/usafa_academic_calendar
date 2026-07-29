import ical from 'node-ical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/generate.ts';

const SECRET = '1x0000000000000000000000000000000AA';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function mockSiteverify(success: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    expect(url).toContain('challenges.cloudflare.com/turnstile/v0/siteverify');
    return new Response(JSON.stringify({ success }), { status: 200 });
  });
}

const validBody = {
  semesterId: 'fall-2026',
  turnstileToken: 'test-token',
  entries: [{ dayType: 'M', periods: [3, 4], title: 'Comp Sci 110', location: 'Fairchild 2G5' }],
};

afterEach(() => vi.restoreAllMocks());

describe('POST /api/generate', () => {
  it('returns a downloadable .ics when the captcha passes', async () => {
    mockSiteverify(true);
    const resp = await onRequestPost({ request: makeRequest(validBody), env: { TURNSTILE_SECRET_KEY: SECRET } });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toContain('text/calendar');
    expect(resp.headers.get('Content-Disposition')).toBe('attachment; filename="usafa-fall-2026.ics"');
    const text = await resp.text();
    const events = Object.values(ical.sync.parseICS(text)).filter((c) => c.type === 'VEVENT');
    expect(events).toHaveLength(41);
  });

  it('rejects a failed captcha with 403', async () => {
    mockSiteverify(false);
    const resp = await onRequestPost({ request: makeRequest(validBody), env: { TURNSTILE_SECRET_KEY: SECRET } });
    expect(resp.status).toBe(403);
    expect((await resp.json()).error).toMatch(/Captcha/);
  });

  it('rejects a missing token with 403 without calling siteverify', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const resp = await onRequestPost({
      request: makeRequest({ ...validBody, turnstileToken: undefined }),
      env: { TURNSTILE_SECRET_KEY: SECRET },
    });
    expect(resp.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails safe with 500 when the server has no Turnstile secret', async () => {
    const resp = await onRequestPost({ request: makeRequest(validBody), env: {} });
    expect(resp.status).toBe(500);
    expect((await resp.json()).error).toMatch(/not configured/);
  });

  it('rejects an unknown semester with 400', async () => {
    mockSiteverify(true);
    const resp = await onRequestPost({
      request: makeRequest({ ...validBody, semesterId: 'summer-2099' }),
      env: { TURNSTILE_SECRET_KEY: SECRET },
    });
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toMatch(/Unknown semester/);
  });

  it('rejects invalid cart payloads with 400 and a helpful message', async () => {
    mockSiteverify(true);
    const resp = await onRequestPost({
      request: makeRequest({ ...validBody, entries: [{ dayType: 'M', periods: [9] }] }),
      env: { TURNSTILE_SECRET_KEY: SECRET },
    });
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toMatch(/1-6/);
  });

  it('rejects non-JSON bodies with 400', async () => {
    const resp = await onRequestPost({
      request: makeRequest('this is not json'),
      env: { TURNSTILE_SECRET_KEY: SECRET },
    });
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toMatch(/JSON/);
  });
});
