/**
 * POST /api/hospital/signup
 * 인증된 Firebase 유저가 병원 등록 서류를 제출.
 * 이메일 인증 완료 여부와 무관하게 받지만, 이후 승인 전까지 병원 기능 사용 불가.
 */
import { verifyIdToken } from '../../src/lib/firebase-admin';
import { createHospitalRecord, getHospitalRecord } from '../../src/lib/firestore';
import { getAdminAuth } from '../../src/lib/firebase-admin';

const MAX_CERT_SIZE = 900_000; // ~900KB base64 payload (Firestore 1MB 문서 제한 대응)

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; businessCertBase64?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  const cert = body.businessCertBase64 ?? '';

  if (!name || name.length < 2) {
    return Response.json({ error: '병원명을 2자 이상 입력해주세요.' }, { status: 400 });
  }
  if (!cert.startsWith('data:')) {
    return Response.json({ error: '사업자등록증 파일이 필요합니다.' }, { status: 400 });
  }
  if (cert.length > MAX_CERT_SIZE) {
    return Response.json({ error: '사업자등록증 파일은 600KB 이하로 업로드해주세요.' }, { status: 400 });
  }

  // 이미 제출했는지 확인 (중복 방지)
  const existing = await getHospitalRecord(uid);
  if (existing) {
    return Response.json({ error: '이미 병원 신청이 접수되었습니다.', status: existing.status }, { status: 409 });
  }

  const user = await getAdminAuth().getUser(uid);
  await createHospitalRecord(uid, {
    email: user.email ?? '',
    name,
    businessCertBase64: cert,
  });

  return Response.json({ success: true, status: 'pending' });
}
