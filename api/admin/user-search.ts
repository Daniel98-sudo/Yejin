/**
 * GET /api/admin/user-search?email=...
 * 슈퍼관리자 전용 — 이메일로 환자/유저 조회. Firebase Auth + 쿼터 + 최근 세션 수 반환.
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { getAdminAuth } from '../../src/lib/firebase-admin';
import { getWeeklyQuota } from '../../src/lib/quota';
import { listSessionsByUid } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const email = new URL(req.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email) return Response.json({ error: 'email 쿼리 파라미터 필요' }, { status: 400 });

  try {
    const user = await getAdminAuth().getUserByEmail(email);
    const [quota, sessions] = await Promise.all([
      getWeeklyQuota(user.uid),
      listSessionsByUid(user.uid, 100),
    ]);

    return Response.json({
      user: {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        createdAt: user.metadata.creationTime,
        lastSignInAt: user.metadata.lastSignInTime,
        disabled: user.disabled,
        providers: user.providerData.map((p) => p.providerId),
        customClaims: user.customClaims ?? {},
      },
      quota,
      sessionCount: sessions.length,
    });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'auth/user-not-found') {
      return Response.json({ error: '해당 이메일의 유저가 없습니다.' }, { status: 404 });
    }
    console.error('[admin/user-search]', e);
    return Response.json({ error: err.message ?? '조회 실패' }, { status: 500 });
  }
}
