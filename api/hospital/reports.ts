/**
 * GET /api/hospital/reports
 * 병원 계정이 claim 한 활성 공유(72시간 내)의 리포트 목록.
 */
import { verifyAdminToken } from '../../src/lib/admin-auth';
import { listHospitalReports } from '../../src/lib/firestore';

export async function GET(req: Request): Promise<Response> {
  const admin = await verifyAdminToken(req, 'hospital');
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await listHospitalReports(admin.uid);

  const reports = rows.map((r) => ({
    token: r.token,
    sessionId: r.sessionId,
    claimedAt: r.claimedAt.toMillis(),
    expiresAt: r.expiresAt.toMillis(),
    date: r.session.date,
    createdAt: r.session.createdAt.toMillis(),
    redFlagLevel: r.session.redFlagLevel,
    painScale: r.session.painScale,
    patientUidShort: r.session.uid.slice(0, 8),
    report: r.session.report,
  }));

  // 일자별 그룹핑 (date 기준 내림차순)
  const byDate: Record<string, typeof reports> = {};
  reports.forEach((r) => { (byDate[r.date] ??= []).push(r); });
  const grouped = Object.entries(byDate)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, items: items.sort((x, y) => y.createdAt - x.createdAt) }));

  return Response.json({ grouped, total: reports.length });
}
