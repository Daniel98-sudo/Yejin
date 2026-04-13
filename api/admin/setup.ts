/**
 * POST /api/admin/setup
 * Super Admin 최초 1회 설정 엔드포인트.
 * ADMIN_SETUP_SECRET 환경변수와 일치하는 secret을 전달해야만 실행됨.
 */
import { getAdminAuth } from '../../src/lib/firebase-admin';

export async function POST(req: Request): Promise<Response> {
  let body: { secret: string; uid: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { secret, uid } = body;

  // 시크릿 검증
  if (!process.env.ADMIN_SETUP_SECRET || secret !== process.env.ADMIN_SETUP_SECRET) {
    return Response.json({ error: 'Invalid secret' }, { status: 403 });
  }

  if (!uid) {
    return Response.json({ error: 'uid is required' }, { status: 400 });
  }

  // Firebase Custom Claims 설정
  await getAdminAuth().setCustomUserClaims(uid, {
    role: 'superadmin',
    grantedAt: new Date().toISOString(),
  });

  return Response.json({ success: true, message: `uid ${uid} 에 superadmin 권한이 부여됐습니다.` });
}
