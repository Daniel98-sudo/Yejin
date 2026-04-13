import { initFirebase, getFirebaseAuth, logout } from '../../lib/firebase-client';
import { onAuthStateChanged } from 'firebase/auth';
import type { ReportSection } from '../../types/index';

interface HospitalReportRow {
  token: string;
  sessionId: string;
  claimedAt: number;
  expiresAt: number;
  date: string;
  createdAt: number;
  redFlagLevel: string;
  painScale: number;
  patientUidShort: string;
  report?: ReportSection;
}

interface GroupedReports {
  grouped: Array<{ date: string; items: HospitalReportRow[] }>;
  total: number;
}

let authToken = '';

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtExpires(ms: number): string {
  const remain = ms - Date.now();
  if (remain <= 0) return '만료됨';
  const hours = Math.floor(remain / (60 * 60 * 1000));
  const mins = Math.floor((remain % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `${hours}시간 ${mins}분 남음` : `${mins}분 남음`;
}

function renderReport(row: HospitalReportRow): string {
  const r = row.report;
  const symptoms = r?.associatedSymptoms?.length
    ? r.associatedSymptoms.map((s) => `<li>${s}</li>`).join('')
    : '<li>없음</li>';
  const questions = r?.questionsForDoctor?.filter(Boolean).map((q) => `<li>${q}</li>`).join('') || '<li>없음</li>';

  return `
    <div class="report-card">
      <div class="report-head">
        <div>
          <strong style="font-size:15px;">환자 ID ${row.patientUidShort}...</strong>
          <span class="badge badge-${row.redFlagLevel}" style="margin-left:8px;">${row.redFlagLevel}</span>
        </div>
        <div style="text-align:right;">
          <div class="badge-wrap">수신 ${fmtTime(row.claimedAt)}</div>
          <div class="expires">${fmtExpires(row.expiresAt)}</div>
        </div>
      </div>
      <div class="report-body">
        <div>
          <h4>주증상</h4><p>${r?.chiefComplaint ?? '-'}</p>
          <h4 style="margin-top:10px;">발병 시점</h4><p>${r?.onset ?? '-'}</p>
          <h4 style="margin-top:10px;">통증강도</h4><p><strong>${row.painScale}</strong> / 10</p>
          <h4 style="margin-top:10px;">동반 증상</h4><ul>${symptoms}</ul>
        </div>
        <div>
          <h4>과거력</h4><p>${r?.previousHistory ?? '-'}</p>
          <h4 style="margin-top:10px;">최근 약물 변화</h4><p>${r?.medicationChanges ?? '-'}</p>
          <h4 style="margin-top:10px;">응급도 평가</h4>
          <p>${r?.redFlag?.reason ?? '-'}</p>
          <p style="color:var(--text-muted); font-size:12px;">${r?.redFlag?.action ?? ''}</p>
          <h4 style="margin-top:10px;">의사에게 꼭 물어볼 것</h4>
          <ul>${questions}</ul>
        </div>
      </div>
    </div>`;
}

function renderGroup(group: { date: string; items: HospitalReportRow[] }): string {
  return `
    <div class="date-group">
      <div class="date-header">📅 ${group.date} — ${group.items.length}건</div>
      ${group.items.map(renderReport).join('')}
    </div>`;
}

async function loadReports() {
  const res = await fetch('/api/hospital/reports', { headers: { Authorization: `Bearer ${authToken}` } });
  if (!res.ok) {
    document.getElementById('loading')!.innerHTML = '<div style="color:#dc2626;">리포트 로드 실패</div>';
    return;
  }
  const data = await res.json() as GroupedReports;

  document.getElementById('total-count')!.textContent = String(data.total);

  const todayStr = new Date().toISOString().split('T')[0];
  const today = data.grouped.find((g) => g.date === todayStr)?.items.length ?? 0;
  document.getElementById('today-count')!.textContent = String(today);

  const emergencyCount = data.grouped.reduce((sum, g) =>
    sum + g.items.filter((i) => i.redFlagLevel === 'EMERGENCY').length, 0);
  document.getElementById('emergency-count')!.textContent = String(emergencyCount);

  const list = document.getElementById('reports-list')!;
  if (data.grouped.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted); background:var(--surface); border-radius:10px;">
      아직 수신된 문진 보고서가 없습니다.<br/>환자가 QR을 생성하고 병원 계정으로 스캔하면 여기에 표시됩니다.
    </div>`;
  } else {
    list.innerHTML = data.grouped.map(renderGroup).join('');
  }

  document.getElementById('loading')!.classList.add('hidden');
  document.getElementById('content')!.classList.remove('hidden');
}

async function init() {
  await initFirebase();

  onAuthStateChanged(getFirebaseAuth(), async (user) => {
    if (!user) { window.location.href = '/admin/login.html'; return; }

    const result = await user.getIdTokenResult(true);
    const role = result.claims['role'];
    if (role !== 'hospital') { window.location.href = '/hospital/pending.html'; return; }

    authToken = await user.getIdToken();

    const statusRes = await fetch('/api/hospital/status', { headers: { Authorization: `Bearer ${authToken}` } });
    if (statusRes.ok) {
      const s = await statusRes.json() as { name?: string };
      if (s.name) document.getElementById('hospital-name')!.textContent = s.name;
    }

    await loadReports();
  });

  document.getElementById('logout-btn')!.addEventListener('click', () => logout());
}

init();
