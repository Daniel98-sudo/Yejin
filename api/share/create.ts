/**
 * POST /api/share/create { sessionId }
 * 환자가 자신의 세션에 대한 공유 토큰 생성 (72시간 병원 열람 동의 전제).
 */
import { verifyIdToken } from '../../src/lib/firebase-admin';
import { createShareToken, getSessionById } from '../../src/lib/firestore';

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { sessionId } = body;
  if (!sessionId) return Response.json({ error: 'sessionId 필요' }, { status: 400 });

  const session = await getSessionById(sessionId);
  if (!session) return Response.json({ error: '해당 세션을 찾을 수 없습니다.' }, { status: 404 });
  if (session.uid !== uid) return Response.json({ error: '본인의 세션만 공유할 수 있습니다.' }, { status: 403 });

  const token = randomToken();
  await createShareToken(token, sessionId, uid);

  const origin = new URL(req.url).origin;
  return Response.json({
    token,
    shareUrl: `${origin}/share.html?t=${token}`,
  });
}
