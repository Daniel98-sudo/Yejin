/**
 * GET /api/admin/sessions?limit=50&offset=0
 * Superadmin 전용 — 수집된 익명 세션 목록 조회
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { getDb } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Number(url.searchParams.get('offset') ?? 0);

  try {
    const db = getDb();
    const snap = await db
      .collection('sessions')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset)
      .get();

    const sessions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const total = (await db.collection('sessions').count().get()).data().count;

    return Response.json({ sessions, total, limit, offset });
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (err.code === 7 || err.message?.includes('Firestore API has not been used')) {
      return Response.json(
        { error: 'Firestore가 아직 활성화되지 않았습니다. Firebase Console에서 Firestore Database를 생성해주세요.' },
        { status: 503 }
      );
    }
    console.error('[admin/sessions]', e);
    return Response.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
