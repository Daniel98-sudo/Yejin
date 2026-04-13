/**
 * GET /api/consultation/quota
 * 현재 로그인 유저의 이번 주 문진 쿼터 반환.
 */
import { verifyIdToken } from '../../src/lib/firebase-admin';
import { getWeeklyQuota } from '../../src/lib/quota';

export async function GET(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const quota = await getWeeklyQuota(uid);
  return Response.json(quota);
}
