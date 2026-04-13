import { getDb } from './firestore';
import { Timestamp } from 'firebase-admin/firestore';

export const WEEKLY_LIMIT = 3;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준, 이번 주 월요일 00:00 을 UTC Date 로 반환 */
export function currentWeekStartKST(now: Date = new Date()): Date {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const day = kstNow.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysFromMonday = (day + 6) % 7;
  const monday = new Date(kstNow);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - daysFromMonday);
  return new Date(monday.getTime() - KST_OFFSET_MS);
}

/** 다음 리셋(월요일 00:00 KST) UTC Date */
export function nextResetKST(now: Date = new Date()): Date {
  const start = currentWeekStartKST(now);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms
}

export async function getWeeklyQuota(uid: string): Promise<QuotaStatus> {
  const db = getDb();
  const weekStart = currentWeekStartKST();
  const snap = await db
    .collection('sessions')
    .where('uid', '==', uid)
    .where('createdAt', '>=', Timestamp.fromDate(weekStart))
    .count()
    .get();

  const used = snap.data().count;
  const remaining = Math.max(0, WEEKLY_LIMIT - used);
  return {
    used,
    limit: WEEKLY_LIMIT,
    remaining,
    resetAt: nextResetKST().getTime(),
  };
}
