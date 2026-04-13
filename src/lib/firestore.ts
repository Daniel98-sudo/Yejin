import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

function initAdmin() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export function getDb() {
  initAdmin();
  return getFirestore();
}

/**
 * Firestore 스키마:
 * users/{uid}/
 *   - dataConsent: boolean (개보법 §23 동의 여부)
 *   - consentedAt: Timestamp
 *
 * sessions/{sessionId}/
 *   - uid: string (Firebase UID, 익명식별자)
 *   - createdAt: Timestamp
 *   - date: string (YYYY-MM-DD만 — 시간 미저장)
 *   - answers: { questionId, value }[]  ← questionText 제외 (데이터 최소화)
 *   - redFlagLevel: 'EMERGENCY'|'URGENT'|'WARNING'|'ROUTINE'
 *   - chiefComplaintCategory: string (주증상 카테고리, 자유입력 원문 미저장)
 *   - painScale: number
 *   - algorithmVersion: string
 *   ※ 실명·연락처·이메일 등 PII 일절 미저장
 */

export interface SessionRecord {
  uid: string;
  createdAt: Timestamp;
  date: string;
  answers: { questionId: string; value: string | number | string[] }[];
  redFlagLevel: string;
  painScale: number;
  algorithmVersion: string;
}

export interface UserConsent {
  dataConsent: boolean;
  consentedAt: Timestamp;
}

export async function saveUserConsent(uid: string, consent: boolean) {
  const db = getDb();
  await db.collection('users').doc(uid).set(
    {
      dataConsent: consent,
      consentedAt: Timestamp.now(),
    } satisfies UserConsent,
    { merge: true }
  );
}

export async function hasDataConsent(uid: string): Promise<boolean> {
  const db = getDb();
  const doc = await db.collection('users').doc(uid).get();
  return doc.data()?.dataConsent === true;
}

export async function saveSession(record: SessionRecord): Promise<string> {
  const db = getDb();
  const ref = await db.collection('sessions').add(record);
  return ref.id;
}
