/**
 * POST /api/consent
 * 로그인 직후 데이터 수집 동의 여부를 Firestore에 기록.
 */
import { verifyIdToken } from '../src/lib/firebase-admin';
import { saveUserConsent } from '../src/lib/firestore';

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { consent: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  await saveUserConsent(uid, body.consent === true);
  return Response.json({ success: true });
}
