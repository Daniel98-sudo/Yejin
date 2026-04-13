import { requireAuth, authHeaders } from './auth-guard';
import type { ReportSection } from '../types/index';

interface HistoryItem {
  id: string;
  date: string;
  createdAt: number;
  redFlagLevel: string;
  painScale: number;
  chiefComplaint: string;
  report?: ReportSection;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderReport(r?: ReportSection): string {
  if (!r) return '<p style="color:var(--text-muted);">리포트 데이터가 없습니다.</p>';
  const symptoms = r.associatedSymptoms?.length
    ? r.associatedSymptoms.map((s) => `<li>${s}</li>`).join('')
    : '<li>없음</li>';
  const questions = r.questionsForDoctor?.filter(Boolean).map((q) => `<li>${q}</li>`).join('') || '<li>없음</li>';
  return `
    <div class="report-section"><h3>주증상</h3><p>${r.chiefComplaint ?? '-'}</p></div>
    <div class="report-section"><h3>발병 시점</h3><p>${r.onset ?? '-'}</p></div>
    <div class="report-section"><h3>통증 강도</h3><p>${r.painScale ?? 0} / 10</p></div>
    <div class="report-section"><h3>동반 증상</h3><ul>${symptoms}</ul></div>
    <div class="report-section"><h3>과거력</h3><p>${r.previousHistory ?? '-'}</p></div>
    <div class="report-section"><h3>최근 약물 변화</h3><p>${r.medicationChanges ?? '-'}</p></div>
    <div class="report-section"><h3>의사에게 물어볼 것</h3><ul>${questions}</ul></div>
    <div class="report-section">
      <h3>응급도 평가</h3>
      <p><span class="badge badge-${r.redFlag.level}">${r.redFlag.level}</span></p>
      <p style="margin-top:6px; font-size:13px;">${r.redFlag.reason}</p>
    </div>`;
}

function render(items: HistoryItem[]) {
  const container = document.getElementById('list-container')!;
  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px; color:var(--text-muted);">
        아직 작성한 문진이 없습니다.<br/>
        <a href="/consult.html" style="color:#2563eb;">문진 시작하기 →</a>
      </div>`;
    return;
  }

  container.innerHTML = items.map((s) => `
    <div class="hcard" data-id="${s.id}">
      <div class="hcard-head">
        <span class="hcard-date">${s.date} ${fmtTime(s.createdAt)}</span>
        <span class="badge badge-${s.redFlagLevel}">${s.redFlagLevel}</span>
      </div>
      <div class="hcard-title">${s.chiefComplaint || '주증상 미기록'}</div>
      <div class="hcard-sub">통증 ${s.painScale ?? 0}/10</div>
      <div class="hdetail" id="d-${s.id}">${renderReport(s.report)}</div>
    </div>`).join('');

  container.querySelectorAll('.hcard').forEach((card) => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.id!;
      document.getElementById(`d-${id}`)!.classList.toggle('open');
    });
  });
}

async function init() {
  await requireAuth();

  const res = await fetch('/api/consultation/history', { headers: authHeaders() });
  const loading = document.getElementById('loading')!;

  if (!res.ok) {
    loading.innerHTML = '<div style="color:#dc2626;">기록을 불러오지 못했습니다.</div>';
    return;
  }

  const data = await res.json() as { sessions: HistoryItem[] };
  render(data.sessions);

  loading.classList.add('hidden');
  document.getElementById('list-container')!.classList.remove('hidden');
}

init();
