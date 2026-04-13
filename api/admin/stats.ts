/**
 * GET /api/admin/stats
 * Superadmin 전용 — 대시보드 집계 통계
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { getDb } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDb();

  const [totalSessions, totalUsers] = await Promise.all([
    db.collection('sessions').count().get(),
    db.collection('users').where('dataConsent', '==', true).count().get(),
  ]);

  // Red Flag 등급별 집계
  const flagLevels = ['EMERGENCY', 'URGENT', 'WARNING', 'ROUTINE'];
  const flagCounts = await Promise.all(
    flagLevels.map(async (level) => {
      const snap = await db.collection('sessions').where('redFlagLevel', '==', level).count().get();
      return { level, count: snap.data().count };
    })
  );

  // 최근 7일 세션 수
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
}
