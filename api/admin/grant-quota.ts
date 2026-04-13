/**
 * POST /api/admin/grant-quota { uid, amount }
 * 슈퍼관리자 전용 — 특정 유저의 이번 주 추가 쿼터 설정 (누적 아닌 덮어쓰기).
 * 다음 주로 넘어가면 weekKey 불일치로 자동 0.
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { setQuotaBonus } from '../../src/lib/firestore';
import { currentWeekKey } from '../../src/lib/quota';

export async function POST(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  let body: { uid?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { uid, amount } = body;
  if (!uid || typeof amount !== 'number' || !Number.isInteger(amount)) {
    return Response.json({ error: 'uid 와 정수 amount 필요' }, { status: 400 });
  }
  if (amount < 0 || amount > 50) {
    return Response.json({ error: 'amount 는 0~50 범위여야 합니다.' }, { status: 400 });
  }

  const weekKey = currentWeekKey();
  await setQuotaBonus(uid, weekKey, amount, admin.uid);

  return Response.json({ success: true, weekKey, amount });
}
