import { requireAuth, authHeaders } from './auth-guard';

interface Turn { role: 'user' | 'assistant'; content: string }
interface AssistantTurn {
  assistantMessage: string;
  inputType?: 'text' | 'choice' | 'multi-choice' | 'slider';
  options?: string[];
  min?: number;
  max?: number;
  placeholder?: string;
  complete: boolean;
  summary?: Record<string, unknown>;
  redFlag?: { level: string; reason: string; action: string };
}

const messagesEl = document.getElementById('messages')!;
const inputAreaEl = document.getElementById('input-area')!;
const progressEl = document.getElementById('progress')!;
const stepLabelEl = document.getElementById('step-label')!;
const overlay = document.getElementById('redflag-overlay')!;

const TARGET_TURNS = 12; // 진행률 표시용 목표
let history: Turn[] = [];
let sessionId = '';

function genSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function addBubble(text: string, who: 'ai' | 'user') {
  const div = document.createElement('div');
  div.className = `bubble bubble-${who}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setProgress(turnsDone: number) {
  const pct = Math.min(100, Math.round((turnsDone / TARGET_TURNS) * 100));
  progressEl.style.width = `${pct}%`;
  stepLabelEl.textContent = `${turnsDone} / ~${TARGET_TURNS}`;
}

function setLoading(on: boolean) {
  if (on) inputAreaEl.innerHTML = '<div class="loading">잠시만요…</div>';
}

function showRedFlag(rf: AssistantTurn['redFlag'], onContinue: () => void) {
  if (!rf || rf.level === 'ROUTINE') { onContinue(); return; }
  const icons: Record<string, string> = { EMERGENCY: '🚨', URGENT: '⚠️', WARNING: '📋' };
  const titles: Record<string, string> = { EMERGENCY: '응급 상황 감지', URGENT: '빠른 진료 필요', WARNING: '진료 권고' };
  overlay.classList.remove('hidden', 'EMERGENCY', 'URGENT', 'WARNING');
  overlay.classList.add(rf.level);
  document.getElementById('flag-icon')!.textContent = icons[rf.level] ?? '⚠️';
  document.getElementById('flag-title')!.textContent = titles[rf.level] ?? '주의';
  document.getElementById('flag-reason')!.textContent = rf.reason;
  document.getElementById('flag-action')!.textContent = rf.action;
  if (rf.level === 'EMERGENCY') document.getElementById('flag-119')!.classList.remove('hidden');
  document.getElementById('flag-continue')!.onclick = () => {
    overlay.classList.add('hidden');
    onContinue();
  };
}

// ── 입력 위젯 ────────────────────────────────────────────

function renderText(t: AssistantTurn, onSubmit: (v: string) => void) {
  inputAreaEl.innerHTML = `
    <div class="text-input-wrap">
      <textarea id="txt" rows="2" placeholder="${t.placeholder ?? '편하게 말씀해 주세요'}"></textarea>
      <button class="send-btn" id="send-btn">→</button>
    </div>`;
  const txt = document.getElementById('txt') as HTMLTextAreaElement;
  txt.focus();
  const submit = () => { const v = txt.value.trim(); if (v) onSubmit(v); };
  document.getElementById('send-btn')!.onclick = submit;
  txt.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } };
}

function renderChoice(t: AssistantTurn, onSubmit: (v: string) => void) {
  const div = document.createElement('div');
  div.className = 'choices';
  (t.options ?? []).forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => onSubmit(opt));
    div.appendChild(btn);
  });
  inputAreaEl.innerHTML = '';
  inputAreaEl.appendChild(div);
}

function renderMultiChoice(t: AssistantTurn, onSubmit: (v: string[]) => void) {
  const selected = new Set<string>();
  const buttons = new Map<string, HTMLButtonElement>();
  const div = document.createElement('div');
  div.className = 'choices';

  const sync = () => {
    buttons.forEach((b, opt) => {
      const isOn = selected.has(opt);
      if (b.classList.contains('selected') !== isOn) b.classList.toggle('selected', isOn);
    });
  };

  (t.options ?? []).forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => {
      if (opt === '해당 없음') {
        if (selected.has('해당 없음')) selected.clear();
        else { selected.clear(); selected.add('해당 없음'); }
      } else {
        selected.delete('해당 없음');
        if (selected.has(opt)) selected.delete(opt); else selected.add(opt);
      }
      sync();
    });
    buttons.set(opt, btn);
    div.appendChild(btn);
  });

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-primary mt-16';
  confirm.textContent = '선택 완료';
  confirm.addEventListener('click', () => {
    if (selected.size === 0) selected.add('해당 없음');
    onSubmit([...selected]);
  });

  inputAreaEl.innerHTML = '';
  inputAreaEl.appendChild(div);
  inputAreaEl.appendChild(confirm);
}

function renderSlider(t: AssistantTurn, onSubmit: (v: number) => void) {
  const min = t.min ?? 0;
  const max = t.max ?? 10;
  inputAreaEl.innerHTML = `
    <div class="slider-wrap">
      <div class="slider-value" id="slider-val">5</div>
      <input type="range" id="slider" min="${min}" max="${max}" value="5" />
      <div class="slider-labels"><span>${min} (없음)</span><span>${max} (극심함)</span></div>
      <button class="btn btn-primary mt-16" id="slider-submit">이 점수로 제출</button>
    </div>`;
  const slider = document.getElementById('slider') as HTMLInputElement;
  slider.oninput = () => { document.getElementById('slider-val')!.textContent = slider.value; };
  document.getElementById('slider-submit')!.onclick = () => onSubmit(Number(slider.value));
}

function renderInput(t: AssistantTurn, onAnswer: (display: string, raw: string | number | string[]) => void) {
  switch (t.inputType) {
    case 'choice': renderChoice(t, (v) => onAnswer(v, v)); break;
    case 'multi-choice': renderMultiChoice(t, (v) => onAnswer(v.join(', '), v)); break;
    case 'slider': renderSlider(t, (v) => onAnswer(`${v}/10`, v)); break;
    case 'text':
    default: renderText(t, (v) => onAnswer(v, v));
  }
}

// ── Core Loop ───────────────────────────────────────────

async function callTurn(retryCount = 0): Promise<AssistantTurn | null> {
  try {
    const res = await fetch('/api/chat/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ sessionId, history, turnCount: history.filter((t) => t.role === 'user').length }),
    });
    if (res.status === 401) { window.location.href = '/login.html'; return null; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    // 최대 1회 자동 재시도
    if (retryCount < 1) {
      await new Promise((r) => setTimeout(r, 800));
      return callTurn(retryCount + 1);
    }
    showRetryUI(e instanceof Error ? e.message : '네트워크 오류');
    return null;
  }
}

function showRetryUI(msg: string) {
  inputAreaEl.innerHTML = `
    <div style="padding:16px; text-align:center;">
      <div style="color:#dc2626; margin-bottom:12px;">AI 응답을 받지 못했어요.</div>
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">${msg}</div>
      <button id="retry-btn" class="btn btn-primary" style="width:auto; padding:10px 24px;">다시 시도</button>
    </div>`;
  document.getElementById('retry-btn')!.addEventListener('click', () => { nextTurn(); });
}

async function nextTurn() {
  setLoading(true);
  const t = await callTurn();
  if (!t) return;

  addBubble(t.assistantMessage, 'ai');
  history.push({ role: 'assistant', content: t.assistantMessage });
  setProgress(history.filter((h) => h.role === 'user').length);

  if (t.complete) {
    finalize(t);
    return;
  }

  renderInput(t, async (display, raw) => {
    addBubble(display, 'user');
    history.push({ role: 'user', content: typeof raw === 'string' ? raw : JSON.stringify(raw) });
    setProgress(history.filter((h) => h.role === 'user').length);
    await nextTurn();
  });
}

function finalize(t: AssistantTurn) {
  inputAreaEl.innerHTML = '<div class="loading">예진 보고서를 만드는 중…</div>';
  sessionStorage.setItem('yejin_session_id', sessionId);
  sessionStorage.setItem('yejin_chat_history', JSON.stringify(history));
  sessionStorage.setItem('yejin_chat_summary', JSON.stringify(t.summary ?? {}));
  sessionStorage.setItem('yejin_chat_redflag', JSON.stringify(t.redFlag ?? null));

  showRedFlag(t.redFlag, () => { window.location.href = '/report.html'; });
  // 응급 아닌 경우 약간 지연 후 자동 이동
  if (!t.redFlag || t.redFlag.level === 'ROUTINE') {
    setTimeout(() => { window.location.href = '/report.html'; }, 800);
  }
}

async function init() {
  await requireAuth();
  sessionId = genSessionId();
  setProgress(0);
  await nextTurn();
}

init();
