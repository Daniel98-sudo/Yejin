/**
 * GET /api/hospital/status
 * 현재 로그인한 유저의 병원 승인 상태 반환.
 */
import { verifyIdToken } from '../../src/lib/firebase-admin';
import { getHospitalRecord } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const record = await getHospitalRecord(uid);
  if (!record) return Response.json({ status: 'none' });

  return Response.json({
    status: record.status,
    name: record.name,
    email: record.email,
    createdAt: record.createdAt.toMillis(),
  });
}
