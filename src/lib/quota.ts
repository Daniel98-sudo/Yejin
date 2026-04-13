import { getDb, getUserProfile } from './firestore';

export const WEEKLY_LIMIT = 3;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 이번 주 월요일 00:00 을 UTC Date 로 반환 */
export function currentWeekStartKST(now: Date = new Date()): Date {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const day = kstNow.getUTCDay();
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

/** 'YYYY-W##' — ISO 주차 (월요일 시작, KST 기준) */
export function currentWeekKey(now: Date = new Date()): string {
  const monday = currentWeekStartKST(now);
  const kst = new Date(monday.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const weekNum = Math.ceil(((monday.getTime() + KST_OFFSET_MS - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

export interface QuotaStatus {
  used: number;
  limit: number;
  baseLimit: number;
  bonus: number;
  remaining: number;
  resetAt: number;
  weekKey: string;
}

export async function getWeeklyQuota(uid: string): Promise<QuotaStatus> {
  const db = getDb();
  const weekStartMs = currentWeekStartKST().getTime();
  const weekKey = currentWeekKey();

  const snap = await db.collection('sessions').where('uid', '==', uid).get();
  const used = snap.docs.filter((d) => {
    const c = d.data().createdAt;
    const ms = typeof c?.toMillis === 'function' ? c.toMillis() : Number(c ?? 0);
    return ms >= weekStartMs;
  }).length;

  const profile = await getUserProfile(uid);
  const bonus = profile?.quotaBonus?.weekKey === weekKey ? (profile.quotaBonus.amount ?? 0) : 0;
  const limit = WEEKLY_LIMIT + bonus;

  return {
    used,
    limit,
    baseLimit: WEEKLY_LIMIT,
    bonus,
    remaining: Math.max(0, limit - used),
    resetAt: nextResetKST().getTime(),
    weekKey,
  };
}
