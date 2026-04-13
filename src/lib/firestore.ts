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

let dbConfigured = false;
export function getDb() {
  initAdmin();
  const db = getFirestore();
  if (!dbConfigured) {
    try {
      db.settings({ ignoreUndefinedProperties: true });
      dbConfigured = true;
    } catch {
      // settings 가 이미 호출된 경우 무시
      dbConfigured = true;
    }
  }
  return db;
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

/**
 * sessions/{sessionId} — 분석·학습 용도로 구조화
 *
 *  식별/타임라인
 *    uid, createdAt, date, weekKey
 *
 *  원본 답변 (추후 질문지 변경 추적용)
 *    answers[]: { questionId, questionText, type, value }
 *
 *  정규화된 피처 (쿼리·피처엔지니어링 편의)
 *    features: { chiefComplaint, onset, painScale, associatedSymptoms[], previousHistory, medicationChanges }
 *
 *  아웃컴
 *    redFlagLevel, redFlagReason, redFlagAction
 *
 *  AI 리포트
 *    report: ReportSection
 *
 *  메타
 *    algorithmVersion, aiModel, appVersion
 */
export interface SessionAnswer {
  questionId: string;
  questionText: string;
  type: 'text' | 'choice' | 'slider' | 'multi-choice';
  value: string | number | string[];
}

export interface SessionFeatures {
  chiefComplaint: string;
  onset: string;
  painScale: number;
  associatedSymptoms: string[];
  previousHistory: string;
  medicationChanges: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ExtendedFeatures {
  duration?: string;
  character?: string;
  location?: string;
  radiation?: string;
  aggravating?: string;
  relieving?: string;
  previousSimilar?: string;
  chronicConditions?: string[];
  medications?: string;
  narrativeSummary?: string;
}

export interface SessionRecord {
  uid: string;
  createdAt: Timestamp;
  date: string; // YYYY-MM-DD
  weekKey: string;
  answers: SessionAnswer[];
  features: SessionFeatures;
  extendedFeatures?: ExtendedFeatures;
  conversationHistory?: ConversationTurn[]; // AI 적응형 모드의 전체 대화
  redFlagLevel: string;
  redFlagReason: string;
  redFlagAction: string;
  painScale: number;
  algorithmVersion: string;
  aiModel: string;
  appVersion: string;
  report?: unknown;
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

export async function listSessionsByUid(uid: string, limit = 50): Promise<Array<SessionRecord & { id: string }>> {
  const db = getDb();
  const snap = await db.collection('sessions').where('uid', '==', uid).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionRecord) }));
  rows.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  return rows.slice(0, limit);
}

/**
 * 쿼터 보너스 — 슈퍼관리자가 특정 유저에게 이번 주 한정 추가 횟수를 부여.
 * 주차 경계가 바뀌면 자동으로 0이 됨 (weekKey 비교).
 */
export interface UserProfile {
  dataConsent?: boolean;
  consentedAt?: Timestamp;
  quotaBonus?: { weekKey: string; amount: number; grantedBy?: string; grantedAt?: Timestamp };
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const db = getDb();
  const doc = await db.collection('users').doc(uid).get();
  return doc.exists ? (doc.data() as UserProfile) : null;
}

export async function setQuotaBonus(
  uid: string,
  weekKey: string,
  amount: number,
  grantedBy: string
): Promise<void> {
  const db = getDb();
  await db.collection('users').doc(uid).set(
    {
      quotaBonus: { weekKey, amount, grantedBy, grantedAt: Timestamp.now() },
    },
    { merge: true }
  );
}

/**
 * hospitals/{uid}/
 *   - email: string
 *   - name: string (병원명)
 *   - businessCertPath: string (Firebase Storage 경로 — 원본 파일은 Storage에 저장)
 *   - businessCertContentType: string
 *   - status: 'pending' | 'approved' | 'rejected'
 *   - createdAt: Timestamp
 *   - reviewedAt?: Timestamp
 *   - reviewedBy?: string (superadmin uid)
 */
export type HospitalStatus = 'pending' | 'approved' | 'rejected';

export interface HospitalRecord {
  email: string;
  name: string;
  businessCertPath: string;
  businessCertContentType: string;
  status: HospitalStatus;
  createdAt: Timestamp;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
}

export async function createHospitalRecord(
  uid: string,
  data: { email: string; name: string; businessCertPath: string; businessCertContentType: string }
): Promise<void> {
  const db = getDb();
  await db.collection('hospitals').doc(uid).set({
    ...data,
    status: 'pending',
    createdAt: Timestamp.now(),
  } satisfies HospitalRecord);
}

export async function getHospitalRecord(uid: string): Promise<HospitalRecord | null> {
  const db = getDb();
  const doc = await db.collection('hospitals').doc(uid).get();
  return (doc.exists ? (doc.data() as HospitalRecord) : null);
}

export async function listPendingHospitals(): Promise<Array<HospitalRecord & { uid: string }>> {
  const db = getDb();
  const snap = await db.collection('hospitals').where('status', '==', 'pending').get();
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as HospitalRecord) }));
}

export async function updateHospitalStatus(
  uid: string,
  status: HospitalStatus,
  reviewedBy: string
): Promise<void> {
  const db = getDb();
  await db.collection('hospitals').doc(uid).update({
    status,
    reviewedAt: Timestamp.now(),
    reviewedBy,
  });
}

/**
 * shareTokens/{token}
 * 환자가 생성한 병원 공유 토큰. 스캔한 병원이 claim 하면 72시간 열람 가능.
 */
export interface ShareToken {
  sessionId: string;
  patientUid: string;
  createdAt: Timestamp;
  claimedAt?: Timestamp;
  hospitalUid?: string;
  expiresAt?: Timestamp;
}

export async function createShareToken(token: string, sessionId: string, patientUid: string) {
  const db = getDb();
  await db.collection('shareTokens').doc(token).set({
    sessionId,
    patientUid,
    createdAt: Timestamp.now(),
  } satisfies ShareToken);
}

export async function claimShareToken(
  token: string,
  hospitalUid: string,
  viewHours: number
): Promise<{ sessionId: string } | { error: string }> {
  const db = getDb();
  const ref = db.collection('shareTokens').doc(token);
  const doc = await ref.get();
  if (!doc.exists) return { error: '유효하지 않은 QR 코드입니다.' };

  const data = doc.data() as ShareToken;
  if (data.claimedAt) {
    if (data.hospitalUid === hospitalUid) return { sessionId: data.sessionId };
    return { error: '이미 다른 병원에서 사용된 QR 코드입니다.' };
  }

  // QR 생성 후 30분 내 claim 필요 (만료)
  const createdMs = data.createdAt.toMillis();
  if (Date.now() - createdMs > 30 * 60 * 1000) {
    return { error: 'QR 코드가 만료되었습니다. 환자에게 새 코드를 요청해주세요.' };
  }

  const expiresAt = Timestamp.fromMillis(Date.now() + viewHours * 60 * 60 * 1000);
  await ref.update({
    claimedAt: Timestamp.now(),
    hospitalUid,
    expiresAt,
  });
  return { sessionId: data.sessionId };
}

export async function listHospitalReports(
  hospitalUid: string
): Promise<Array<{ token: string; sessionId: string; claimedAt: Timestamp; expiresAt: Timestamp; session: SessionRecord }>> {
  const db = getDb();
  const now = Timestamp.now();
  const snap = await db
    .collection('shareTokens')
    .where('hospitalUid', '==', hospitalUid)
    .where('expiresAt', '>', now)
    .get();

  const results = await Promise.all(
    snap.docs.map(async (d) => {
      const token = d.data() as ShareToken;
      const sessionDoc = await db.collection('sessions').doc(token.sessionId).get();
      if (!sessionDoc.exists) return null;
      return {
        token: d.id,
        sessionId: token.sessionId,
        claimedAt: token.claimedAt!,
        expiresAt: token.expiresAt!,
        session: sessionDoc.data() as SessionRecord,
      };
    })
  );

  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

export async function getSessionById(sessionId: string): Promise<SessionRecord | null> {
  const db = getDb();
  const doc = await db.collection('sessions').doc(sessionId).get();
  return doc.exists ? (doc.data() as SessionRecord) : null;
}

export async function saveSessionWithId(sessionId: string, record: SessionRecord): Promise<void> {
  const db = getDb();
  await db.collection('sessions').doc(sessionId).set(record);
}
