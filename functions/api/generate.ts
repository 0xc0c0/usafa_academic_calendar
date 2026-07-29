import { buildIcs, icsFilename } from '../../src/lib/ics.ts';
import { expandEntries, validateEntries } from '../../src/lib/schedule.ts';
import { getSemester } from '../../src/lib/semesters.ts';

interface Env {
  TURNSTILE_SECRET_KEY?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyTurnstile(secret: string, token: string, remoteIp: string | null): Promise<boolean> {
  const params = new URLSearchParams({ secret, response: token });
  if (remoteIp) params.set('remoteip', remoteIp);
  const resp = await fetch(SITEVERIFY_URL, { method: 'POST', body: params });
  if (!resp.ok) return false;
  const outcome = (await resp.json()) as { success?: boolean };
  return outcome.success === true;
}

/**
 * POST /api/generate
 * Body: { semesterId: string, entries: ScheduleEntry[], turnstileToken: string }
 * Success: text/calendar attachment. Errors: JSON { error }.
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return jsonError(500, 'Server is not configured (missing Turnstile secret). Contact the site owner.');
  }

  let body: { semesterId?: unknown; entries?: unknown; turnstileToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Request body must be JSON.');
  }

  const token = body.turnstileToken;
  if (typeof token !== 'string' || !token) {
    return jsonError(403, 'Captcha token missing. Please complete the verification and try again.');
  }
  const remoteIp = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(secret, token, remoteIp))) {
    return jsonError(403, 'Captcha verification failed. Please try again.');
  }

  const semester = typeof body.semesterId === 'string' ? getSemester(body.semesterId) : undefined;
  if (!semester) {
    return jsonError(400, 'Unknown semester.');
  }

  try {
    const entries = validateEntries(semester, body.entries);
    const meetings = expandEntries(semester, entries);
    const ics = buildIcs(semester, meetings);
    return new Response(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${icsFilename(semester)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid request.');
  }
}
