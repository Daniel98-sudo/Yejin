/**
 * GET /api/admin/hospital-cert?uid=...
 * Superadmin 전용 — 병원 사업자등록증의 임시 서명 URL 반환 (1시간 만료)
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { getHospitalRecord } from '../../src/lib/firestore';
import { getSignedUrl } from '../../src/lib/storage';

export async function GET(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const uid = url.searchParams.get('uid');
  if (!uid) return Response.json({ error: 'uid 쿼리 파라미터 필요' }, { status: 400 });

  const record = await getHospitalRecord(uid);
  if (!record) return Response.json({ error: 'Not found' }, { status: 404 });

  const signedUrl = await getSignedUrl(record.businessCertPath);

  return Response.json({
    url: signedUrl,
    contentType: record.businessCertContentType,
    name: record.name,
    email: record.email,
  });
}
