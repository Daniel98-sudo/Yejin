/**
 * GET /api/consultation/history
 * 현재 로그인 환자의 문진 이력 (최근 50건).
 */
import { verifyIdToken } from '../../src/lib/firebase-admin';
import { listSessionsByUid } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await listSessionsByUid(uid, 50);
  const sessions = rows.map((r) => ({
    id: r.id,
    date: r.date,
    createdAt: r.createdAt.toMillis(),
    redFlagLevel: r.redFlagLevel,
    painScale: r.painScale,
    chiefComplaint: r.features?.chiefComplaint ?? '',
    report: r.report,
  }));

  return Response.json({ sessions, total: sessions.length });
}
