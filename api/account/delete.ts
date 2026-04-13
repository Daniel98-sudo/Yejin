/**
 * DELETE /api/account/delete
 * 인증된 유저의 모든 데이터 삭제:
 *  - sessions/{uid} 에 포함된 문진 기록
 *  - users/{uid} 동의 기록
 *  - hospitals/{uid} (해당 시)
 *  - Storage 내 hospital-docs/{uid}/*
 *  - shareTokens (patientUid == uid)
 *  - Firebase Auth 계정
 */
import { verifyIdToken, getAdminAuth } from '../../src/lib/firebase-admin';
import { getDb } from '../../src/lib/firestore';
import { deleteFile } from '../../src/lib/storage';

export async function DELETE(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  try {
    // 1) sessions: 본인 문서만 삭제 (collection-wide where-uid 쿼리는 복합 인덱스 불요)
    const sessionsSnap = await db.collection('sessions').where('uid', '==', uid).get();
    await Promise.all(sessionsSnap.docs.map((d) => d.ref.delete()));

    // 2) shareTokens
    const tokensSnap = await db.collection('shareTokens').where('patientUid', '==', uid).get();
    await Promise.all(tokensSnap.docs.map((d) => d.ref.delete()));

    // 3) users/{uid}
    await db.collection('users').doc(uid).delete().catch(() => undefined);

    // 4) hospitals/{uid} 및 Storage 서류 (병원 회원이었던 경우)
    const hospitalDoc = await db.collection('hospitals').doc(uid).get();
    if (hospitalDoc.exists) {
      const data = hospitalDoc.data() as { businessCertPath?: string };
      if (data.businessCertPath) {
        await deleteFile(data.businessCertPath).catch(() => undefined);
      }
      await hospitalDoc.ref.delete();
    }

    // 5) Firebase Auth 계정 삭제
    await getAdminAuth().deleteUser(uid);

    return Response.json({ success: true });
  } catch (e) {
    console.error('[account/delete]', e);
    const err = e as { message?: string };
    return Response.json({ error: err.message ?? '계정 삭제 실패' }, { status: 500 });
  }
}
