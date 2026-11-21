// Canvas LMS (Instructure), read-only. Port of backend/canvas.py. Pure logic: the HTTP call is injected, so it also runs in tests.
export interface CanvasItem {
  id: string; source: 'canvas'; title: string; due: string; time: string; status: 'todo' | 'done'; course: string; courseId: string;
  url: string; points: number | null; score: number | null; kind: string; missing: boolean; late: boolean;
}
export type Http = (url: string, headers: Record<string, string>) => Promise<{ status: number; json: any; headers: Record<string, string> }>;

const DONE = new Set(['submitted', 'graded', 'pending_review']);
const NEXT = /<([^>]+)>;\s*rel="next"/;

export function normalize(course: any, a: any): CanvasItem | null {
  if (!a.due_at || a.published === false) return null;
  const d = new Date(a.due_at), sub = a.submission ?? {}, kinds: string[] = a.submission_types ?? [];
  return {
    id: `canvas:${course.id}:${a.id}`, source: 'canvas', title: a.name || 'Untitled',
    due: d.toLocaleDateString('en-CA'),                                                              // local date, like the rest of the dashboard
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' '),
    status: DONE.has(sub.workflow_state) || sub.submitted_at ? 'done' : 'todo',
    course: course.name || 'Course', courseId: String(course.id), url: a.html_url || '',
    points: a.points_possible ?? null, score: sub.score ?? null,
    kind: kinds.includes('online_quiz') ? 'quiz' : kinds.includes('discussion_topic') ? 'discussion' : 'assignment',
    missing: !!sub.missing, late: !!sub.late,
  };
}

class CanvasHttpError extends Error { status: number; constructor(status: number) { super(`HTTP ${status}`); this.status = status; } }

async function allPages(url: string | null, token: string, http: Http) {
  const out: any[] = [];
  while (url) {
    const r = await http(url, { Authorization: `Bearer ${token}`, Accept: 'application/json+canvas-string-ids' });
    if (r.status >= 400) throw new CanvasHttpError(r.status);
    out.push(...r.json);
    url = (r.headers.link ?? r.headers.Link ?? '').match(NEXT)?.[1] ?? null;
  }
  return out;
}

export async function fetchAll(url: string, token: string, http: Http) {
  const courses = (await allPages(`${url}/api/v1/courses?enrollment_state=active&per_page=100`, token, http)).filter(c => c.name && !c.access_restricted_by_date);
  const items: CanvasItem[] = [];
  for (const c of courses)
    for (const a of await allPages(`${url}/api/v1/courses/${c.id}/assignments?include[]=submission&per_page=100`, token, http)) {
      const n = normalize(c, a); if (n) items.push(n);
    }
  items.sort((a, b) => (a.due + a.time < b.due + b.time ? -1 : 1));
  return { courses: courses.map(c => ({ id: String(c.id), name: c.name, code: c.course_code ?? '' })), items };
}

export function friendly(e: any): string {
  if (e instanceof CanvasHttpError) return ({ 401: 'Canvas rejected the token (401). Check C_API_HERE.', 403: "Canvas says this token can't read that data (403).", 404: 'Canvas address not found (404). Check CANVAS_URL.' } as Record<number, string>)[e.status] ?? `Canvas returned an error (${e.status}).`;
  return "Can't reach Canvas. Check CANVAS_URL and your internet connection.";
}
