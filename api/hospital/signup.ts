/**
 * POST /api/hospital/signup
 * 인증된 Firebase 유저가 병원 등록 서류를 제출.
 * 사업자등록증은 Firebase Storage 에 저장, 메타데이터만 Firestore.
 */
import { verifyIdToken, getAdminAuth } from '../../src/lib/firebase-admin';
import { createHospitalRecord, getHospitalRecord } from '../../src/lib/firestore';
import { uploadDataUrl } from '../../src/lib/storage';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

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

  const existing = await getHospitalRecord(uid);
  if (existing) {
    return Response.json({ error: '이미 병원 신청이 접수되었습니다.', status: existing.status }, { status: 409 });
  }

  // 업로드 (확장자는 content-type 에서 추출)
  const typeMatch = cert.match(/^data:([^;]+);base64,/);
  const contentType = typeMatch?.[1] ?? 'application/octet-stream';
  if (!ALLOWED_TYPES.includes(contentType)) {
    return Response.json({ error: 'PDF / JPG / PNG 만 업로드 가능합니다.' }, { status: 400 });
  }

  const ext = contentType === 'application/pdf' ? 'pdf' : contentType === 'image/png' ? 'png' : 'jpg';
  const storagePath = `hospital-docs/${uid}/business-cert.${ext}`;

  let uploaded: { path: string; contentType: string; size: number };
  try {
    uploaded = await uploadDataUrl(storagePath, cert);
  } catch (e) {
    console.error('[hospital/signup] upload failed', e);
    return Response.json({ error: '파일 업로드에 실패했습니다.' }, { status: 500 });
  }

  if (uploaded.size > MAX_FILE_SIZE) {
    return Response.json({ error: '파일 크기는 5MB 이하여야 합니다.' }, { status: 400 });
  }

  const user = await getAdminAuth().getUser(uid);
  await createHospitalRecord(uid, {
    email: user.email ?? '',
    name,
    businessCertPath: uploaded.path,
    businessCertContentType: uploaded.contentType,
  });

  return Response.json({ success: true, status: 'pending' });
}
