import { getDb } from './firestore';

export const WEEKLY_LIMIT = 3;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 이번 주 월요일 00:00 을 UTC Date 로 반환 */
export function currentWeekStartKST(now: Date = new Date()): Date {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const day = kstNow.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysFromMonday = (day + 6) % 7;
  const monday = new Date(kstNow);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - daysFromMonday);
  return new Date(monday.getTime() - KST_OFFSET_MS);
}

export function nextResetKST(now: Date = new Date()): Date {
  const start = currentWeekStartKST(now);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
}

export async function getWeeklyQuota(uid: string): Promise<QuotaStatus> {
  const db = getDb();
  const weekStartMs = currentWeekStartKST().getTime();

  // composite index 불필요한 단일 필드 쿼리 + 메모리 필터.
  // 주 3회 제한 × 90일 보관 → 유저당 최대 ~40 문서로 경량.
  const snap = await db.collection('sessions').where('uid', '==', uid).get();
  const used = snap.docs.filter((d) => {
    const c = d.data().createdAt;
    const ms = typeof c?.toMillis === 'function' ? c.toMillis() : Number(c ?? 0);
    return ms >= weekStartMs;
  }).length;

  return {
    used,
    limit: WEEKLY_LIMIT,
    remaining: Math.max(0, WEEKLY_LIMIT - used),
    resetAt: nextResetKST().getTime(),
  };
}
