/**
 * GET  /api/admin/hospitals                        — 승인 대기 병원 목록 (superadmin)
 * POST /api/admin/hospitals { uid, action }        — action: 'approve' | 'reject'
 *
 * 승인 시 Firebase Custom Claim (role='hospital') 을 부여.
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { getAdminAuth } from '../../src/lib/firebase-admin';
import { listPendingHospitals, updateHospitalStatus, getHospitalRecord } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const list = await listPendingHospitals();
    // Storage 경로는 별도 엔드포인트에서 서명 URL로 제공 — 목록엔 제외
    const summary = list.map(({ businessCertPath, ...rest }) => rest);
    return Response.json({ hospitals: summary });
  } catch (e) {
    const err = e as { message?: string };
    console.error('[admin/hospitals GET]', e);
    return Response.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'superadmin');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  let body: { uid?: string; action?: 'approve' | 'reject' };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { uid, action } = body;
  if (!uid || (action !== 'approve' && action !== 'reject')) {
    return Response.json({ error: 'uid 및 action(approve|reject) 필요' }, { status: 400 });
  }

  const record = await getHospitalRecord(uid);
  if (!record) return Response.json({ error: '해당 병원 신청이 없습니다.' }, { status: 404 });
  if (record.status !== 'pending') {
    return Response.json({ error: `이미 처리된 신청입니다 (${record.status}).` }, { status: 409 });
  }

  if (action === 'approve') {
    // 기존 claims 유지하며 role 추가
    const user = await getAdminAuth().getUser(uid);
    await getAdminAuth().setCustomUserClaims(uid, {
      ...(user.customClaims ?? {}),
      role: 'hospital',
      approvedAt: new Date().toISOString(),
    });
    await updateHospitalStatus(uid, 'approved', admin.uid);
  } else {
    await updateHospitalStatus(uid, 'rejected', admin.uid);
  }

  return Response.json({ success: true });
}

