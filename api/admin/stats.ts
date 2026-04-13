/**
 * GET /api/admin/stats
 * Superadmin 전용 — 대시보드 집계 통계
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { getDb } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const db = getDb();

    const [totalSessions, totalUsers] = await Promise.all([
      db.collection('sessions').count().get(),
      db.collection('users').where('dataConsent', '==', true).count().get(),
    ]);

    const flagLevels = ['EMERGENCY', 'URGENT', 'WARNING', 'ROUTINE'];
    const flagCounts = await Promise.all(
      flagLevels.map(async (level) => {
        const snap = await db.collection('sessions').where('redFlagLevel', '==', level).count().get();
        return { level, count: snap.data().count };
      })
    );

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSnap = await db
      .collection('sessions')
      .where('date', '>=', sevenDaysAgo.toISOString().split('T')[0])
      .count()
      .get();

    return Response.json({
      totalSessions: totalSessions.data().count,
      totalConsentedUsers: totalUsers.data().count,
      recentSessions7d: recentSnap.data().count,
      redFlagBreakdown: Object.fromEntries(flagCounts.map((f) => [f.level, f.count])),
    });
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (err.code === 7 || err.message?.includes('Firestore API has not been used')) {
      return Response.json(
        { error: 'Firestore가 아직 활성화되지 않았습니다. Firebase Console에서 Firestore Database를 생성해주세요.' },
        { status: 503 }
      );
    }
    console.error('[admin/stats]', e);
    return Response.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
