/**
 * GET /api/admin/user-sessions?uid=...
 * 슈퍼관리자 전용 — 특정 유저의 문진 세션 + 리포트 반환.
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { listSessionsByUid } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const uid = new URL(req.url).searchParams.get('uid');
  if (!uid) return Response.json({ error: 'uid 필요' }, { status: 400 });

  const rows = await listSessionsByUid(uid, 100);
  const sessions = rows.map((r) => ({
    id: r.id,
    date: r.date,
    createdAt: r.createdAt.toMillis(),
    weekKey: r.weekKey,
    redFlagLevel: r.redFlagLevel,
    painScale: r.painScale,
    features: r.features,
    report: r.report,
  }));

  return Response.json({ sessions, total: sessions.length });
}
