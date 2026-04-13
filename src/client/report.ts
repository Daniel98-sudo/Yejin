import type { ReportResponse, ReportSection, ChatSummary, RedFlagResult } from '../types/index';
import { requireAuth, authHeaders } from './auth-guard';
import QRCode from 'qrcode';

const loadingEl = document.getElementById('loading')!;
const contentEl = document.getElementById('report-content')!;
const shareSection = document.getElementById('share-section')!;

let currentSessionId = '';

function renderBadge(level: string): string {
  return `<span class="badge badge-${level}">${level}</span>`;
}

function renderReport(report: ReportSection) {
  const symptoms = report.associatedSymptoms?.length
    ? report.associatedSymptoms.map((s) => `<li>${s}</li>`).join('')
    : '<li>없음</li>';

  const questions = report.questionsForDoctor?.filter(Boolean)
    .map((q) => `<li>${q}</li>`).join('') || '<li>없음</li>';

  contentEl.innerHTML = `
    <div class="report-section"><h3>주증상</h3><p>${report.chiefComplaint ?? '-'}</p></div>
    <div class="report-section"><h3>발병 시점</h3><p>${report.onset ?? '-'}</p></div>
    <div class="report-section">
      <h3>통증 강도</h3>
      <p class="pain-scale">${report.painScale ?? 0} <span style="font-size:16px;font-weight:400;color:var(--text-muted)">/ 10</span></p>
    </div>
    <div class="report-section"><h3>동반 증상</h3><ul>${symptoms}</ul></div>
    <div class="report-section"><h3>과거력</h3><p>${report.previousHistory ?? '-'}</p></div>
    <div class="report-section"><h3>최근 약물 변화</h3><p>${report.medicationChanges ?? '-'}</p></div>
    <div class="report-section">
      <h3>⭐ 의사에게 꼭 물어볼 것</h3>
      <ul class="questions-list">${questions}</ul>
    </div>
    <div class="report-section">
      <h3>응급도 평가</h3>
      <p>${renderBadge(report.redFlag.level)}</p>
      <p style="margin-top:8px;font-size:14px;">${report.redFlag.reason}</p>
      <p style="margin-top:4px;font-size:14px;color:var(--text-muted);">${report.redFlag.action}</p>
    </div>
    <div style="margin-top:16px;">
      <button class="btn btn-ghost" onclick="window.location.href='/consult.html'">처음으로</button>
    </div>
  `;
}

async function generateQR() {
  const btn = document.getElementById('gen-qr-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = '생성 중...';

  try {
    const res = await fetch('/api/share/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ sessionId: currentSessionId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'QR 생성 실패' }));
      alert(err.error ?? 'QR 생성 실패');
      btn.disabled = false;
      btn.textContent = 'QR 코드 생성';
      return;
    }
    const data = await res.json() as { token: string; shareUrl: string };

    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, data.shareUrl, { width: 260, margin: 1, errorCorrectionLevel: 'M' });
    const container = document.getElementById('qr-canvas')!;
    container.innerHTML = '';
    container.appendChild(canvas);

    document.getElementById('qr-url-box')!.textContent = data.shareUrl;
    document.getElementById('qr-container')!.classList.remove('hidden');

    btn.textContent = 'QR 재생성';
    btn.disabled = false;
  } catch (e) {
    alert(e instanceof Error ? e.message : 'QR 생성 실패');
    btn.disabled = false;
    btn.textContent = 'QR 코드 생성';
  }
}

async function init() {
  await requireAuth();

  currentSessionId = sessionStorage.getItem('yejin_session_id') ?? '';
  if (!currentSessionId) { window.location.href = '/consult.html'; return; }

  const tsv = sessionStorage.getItem('yejin_questionnaire_tsv');
  const flowKey = sessionStorage.getItem('yejin_questionnaire_flow');
  const qAnswersRaw = sessionStorage.getItem('yejin_questionnaire_answers');
  const summaryRaw = sessionStorage.getItem('yejin_chat_summary');
  const historyRaw = sessionStorage.getItem('yejin_chat_history');
  const redFlagRaw = sessionStorage.getItem('yejin_chat_redflag');
  const legacyAnswersRaw = sessionStorage.getItem('yejin_answers');

  let body: Record<string, unknown> = { sessionId: currentSessionId };

  if (tsv && flowKey && qAnswersRaw) {
    body = {
      sessionId: currentSessionId,
      mode: 'questionnaire',
      tsv,
      flowKey,
      questionnaireAnswers: JSON.parse(qAnswersRaw),
    };
  } else if (summaryRaw && historyRaw) {
    const summary: ChatSummary = JSON.parse(summaryRaw);
    const history = JSON.parse(historyRaw);
    const redFlag: RedFlagResult | null = redFlagRaw ? JSON.parse(redFlagRaw) : null;
    body = { sessionId: currentSessionId, summary, history, ...(redFlag ? { redFlag } : {}) };
  } else if (legacyAnswersRaw) {
    body = { sessionId: currentSessionId, answers: JSON.parse(legacyAnswersRaw) };
  } else {
    window.location.href = '/consult.html';
    return;
  }

  const res = await fetch('/api/report/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });

  if (res.status === 401) { window.location.href = '/login.html'; return; }

  if (res.status === 429) {
    const err = await res.json() as { error: string };
    loadingEl.innerHTML = `
      <div style="color:#dc2626; text-align:center; padding:24px;">
        <strong>${err.error}</strong><br/>
        <a href="/consult.html" style="color:#2563eb; font-size:13px;">← 돌아가기</a>
      </div>`;
    return;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    loadingEl.innerHTML = `
      <div style="color:#dc2626; text-align:center; padding:24px;">
        <strong>보고서 생성 실패</strong><br/>
        <span style="font-size:13px; color:var(--text-muted);">${errBody.error ?? '알 수 없는 오류'}</span><br/><br/>
        <button onclick="location.reload()" class="btn btn-primary" style="width:auto; padding:10px 24px;">다시 시도</button>
        <a href="/consult.html" style="display:block; margin-top:10px; color:var(--text-muted); font-size:13px;">처음으로</a>
      </div>`;
    return;
  }

  const data: ReportResponse = await res.json();
  renderReport(data.report);

  loadingEl.classList.add('hidden');
  shareSection.classList.remove('hidden');
  contentEl.classList.remove('hidden');

  // 공유 동의 체크박스 → QR 생성 버튼 활성화
  const agree = document.getElementById('share-agree') as HTMLInputElement;
  const genBtn = document.getElementById('gen-qr-btn') as HTMLButtonElement;
  agree.addEventListener('change', () => { genBtn.disabled = !agree.checked; });
  genBtn.addEventListener('click', generateQR);
}

init();
