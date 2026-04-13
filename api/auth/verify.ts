import { verifyIdToken } from '../../src/lib/firebase-admin';

/** 클라이언트가 Firebase ID 토큰을 전달하면 유효성을 확인하고 uid를 반환 */
export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ uid });
}
