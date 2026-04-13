/**
 * POST /api/share/claim { token }
 * 병원 계정이 QR 스캔 후 호출 — 72시간 열람 권한 부여.
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { claimShareToken } from '../../src/lib/firestore';

const VIEW_HOURS = 72;

export async function POST(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'hospital');
  if (!admin) return Response.json({ error: '병원 계정으로 로그인 후 스캔해주세요.' }, { status: 403 });

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.token) return Response.json({ error: 'token 필요' }, { status: 400 });

  const result = await claimShareToken(body.token, admin.uid, VIEW_HOURS);
  if ('error' in result) return Response.json({ error: result.error }, { status: 400 });

  return Response.json({ success: true, sessionId: result.sessionId, viewHours: VIEW_HOURS });
}
