import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const BUCKET_NAME = `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;

function initAdmin() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: BUCKET_NAME,
  });
}

function getBucket() {
  initAdmin();
  return getStorage().bucket(BUCKET_NAME);
}

/** data URL (예: "data:application/pdf;base64,JVBERi...") 를 Storage에 업로드 */
export async function uploadDataUrl(
  path: string,
  dataUrl: string
): Promise<{ path: string; contentType: string; size: number }> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL');

  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');

  const file = getBucket().file(path);
  await file.save(buffer, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0' },
  });

  return { path, contentType, size: buffer.length };
}

/** 지정 경로의 파일을 임시 서명 URL로 반환 (기본 1시간) */
export async function getSignedUrl(path: string, expiresInMs = 60 * 60 * 1000): Promise<string> {
  const [url] = await getBucket().file(path).getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMs,
  });
  return url;
}

export async function deleteFile(path: string): Promise<void> {
  await getBucket().file(path).delete({ ignoreNotFound: true });
}
