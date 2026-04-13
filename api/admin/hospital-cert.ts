/**
 * GET /api/admin/hospital-cert?uid=...
 * Superadmin 전용 — 병원의 사업자등록증 원본 data URL 반환 (승인 전 확인용)
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { getHospitalRecord } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const uid = url.searchParams.get('uid');
  if (!uid) return Response.json({ error: 'uid 쿼리 파라미터 필요' }, { status: 400 });

  const record = await getHospitalRecord(uid);
  if (!record) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ businessCertBase64: record.businessCertBase64, name: record.name, email: record.email });
}
