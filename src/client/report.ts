import type { Answer, ReportResponse, ReportSection } from '../types/index';

const loadingEl = document.getElementById('loading')!;
const contentEl = document.getElementById('report-content')!;

function renderBadge(level: string): string {
  return `<span class="badge badge-${level}">${level}</span>`;
}

function renderReport(report: ReportSection) {
  const symptoms = report.associatedSymptoms?.length
    ? report.associatedSymptoms.map((s) => `<li>${s}</li>`).join('')
    : '<li>없음</li>';

  const questions = report.questionsForDoctor?.length
    ? report.questionsForDoctor
        .filter(Boolean)
        .map((q) => `<li>${q}</li>`)
        .join('')
    : '<li>없음</li>';

  contentEl.innerHTML = `
    <div class="report-section">
      <h3>주증상</h3>
      <p>${report.chiefComplaint ?? '-'}</p>
    </div>

    <div class="report-section">
      <h3>발병 시점</h3>
      <p>${report.onset ?? '-'}</p>
    </div>

    <div class="report-section">
      <h3>통증 강도</h3>
      <p class="pain-scale">${report.painScale ?? 0} <span style="font-size:16px;font-weight:400;color:var(--text-muted)">/ 10</span></p>
    </div>

    <div class="report-section">
      <h3>동반 증상</h3>
      <ul>${symptoms}</ul>
    </div>

    <div class="report-section">
      <h3>과거력</h3>
      <p>${report.previousHistory ?? '-'}</p>
    </div>

    <div class="report-section">
      <h3>최근 약물 변화</h3>
      <p>${report.medicationChanges ?? '-'}</p>
    </div>

    <div class="report-section">
      <h3>⭐ 의사에게 꼭 물어볼 것</h3>
      <ul class="questions-list">${questions}</ul>
    </div>

    <div class="report-section">
      <h3>응급도 평가</h3>
      <p>${renderBadge(report.redFlag.level)}</p>
      <p style="margin-top:8px; font-size:14px;">${report.redFlag.reason}</p>
      <p style="margin-top:4px; font-size:14px; color:var(--text-muted);">${report.redFlag.action}</p>
    </div>

    <div style="margin-top:16px;">
      <button class="btn btn-ghost" onclick="window.location.href='/'">처음으로</button>
    </div>
  `;

  loadingEl.classList.add('hidden');
  contentEl.classList.remove('hidden');
}

async function init() {
  const raw = sessionStorage.getItem('yejin_answers');
  if (!raw) {
    window.location.href = '/';
    return;
  }

  const answers: Answer[] = JSON.parse(raw);

  const res = await fetch('/api/report/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });

  if (!res.ok) {
    loadingEl.textContent = '보고서 생성에 실패했습니다. 다시 시도해주세요.';
    return;
  }

  const data: ReportResponse = await res.json();
  renderReport(data.report);
}

init();
