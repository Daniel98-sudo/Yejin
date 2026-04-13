import { requireAuth } from './auth-guard';
import {
  getStep, totalSteps, withOtherOption, answersToTsv, getFlowKey, checkImmediateRedFlag,
  OTHER_LABEL, type QStep, type QAnswer,
} from '../lib/questionnaire';

const messagesEl = document.getElementById('messages')!;
const inputAreaEl = document.getElementById('input-area')!;
const progressEl = document.getElementById('progress')!;
const stepLabelEl = document.getElementById('step-label')!;
const overlay = document.getElementById('redflag-overlay')!;

let sessionId = '';
let currentStep = 0;
const collected: Record<string, unknown> = {};
const answers: QAnswer[] = [];

// ── 헬퍼 ─────────────────────────────────────────────────

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

function setProgress() {
  const total = totalSteps(collected);
  const pct = Math.round((currentStep / Math.max(1, total)) * 100);
  progressEl.style.width = `${pct}%`;
  stepLabelEl.textContent = `${currentStep} / ${total}`;
}

function showEmergencyOverlay(reason: string, onContinue: () => void) {
  overlay.classList.remove('hidden', 'EMERGENCY', 'URGENT', 'WARNING');
  overlay.classList.add('EMERGENCY');
  document.getElementById('flag-icon')!.textContent = '🚨';
  document.getElementById('flag-title')!.textContent = '응급 가능성이 감지되었어요';
  document.getElementById('flag-reason')!.textContent = reason;
  document.getElementById('flag-action')!.textContent = '즉시 119에 연락하시거나 가까운 응급실을 방문해주세요. 문진은 계속 진행하실 수 있습니다.';
  document.getElementById('flag-119')!.classList.remove('hidden');
  document.getElementById('flag-continue')!.onclick = () => {
    overlay.classList.add('hidden');
    onContinue();
  };
}

// ── 입력 위젯 ────────────────────────────────────────────

type SubmitFn = (rawValue: string | string[] | number, displayValue: string, otherText?: string) => void;

function renderText(step: QStep, onSubmit: SubmitFn) {
  inputAreaEl.innerHTML = `
    <div class="text-input-wrap">
      <textarea id="txt" rows="2" placeholder="${step.placeholder ?? '편하게 적어주세요'}"></textarea>
      <button class="send-btn" id="send-btn">→</button>
    </div>`;
  const txt = document.getElementById('txt') as HTMLTextAreaElement;
  txt.focus();
  const submit = () => {
    const v = txt.value.trim();
    onSubmit(v, v || '(답변 없음)');
  };
  document.getElementById('send-btn')!.addEventListener('click', submit);
  txt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
}

function renderOtherText(onSubmit: SubmitFn, multiCtx?: { selectedNonOther: string[] }) {
  inputAreaEl.innerHTML = `
    <div style="background:#eff6ff; padding:10px 12px; border-radius:8px; margin-bottom:8px; font-size:13px; color:#1e40af;">
      "기타"에 대해 직접 입력해주세요.
    </div>
    <div class="text-input-wrap">
      <textarea id="other-txt" rows="2" placeholder="자세히 알려주세요"></textarea>
      <button class="send-btn" id="other-send">→</button>
    </div>`;
  const txt = document.getElementById('other-txt') as HTMLTextAreaElement;
  txt.focus();
  const submit = () => {
    const v = txt.value.trim();
    if (!v) return;
    if (multiCtx) {
      const finalArr = [...multiCtx.selectedNonOther, `기타: ${v}`];
      onSubmit(finalArr, finalArr.join(', '), v);
    } else {
      onSubmit(`기타: ${v}`, `기타 — ${v}`, v);
    }
  };
  document.getElementById('other-send')!.addEventListener('click', submit);
  txt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
}

function renderChoice(step: QStep, onSubmit: SubmitFn) {
  const div = document.createElement('div');
  div.className = 'choices';
  (step.options ?? []).forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => {
      if (opt === OTHER_LABEL) renderOtherText(onSubmit);
      else onSubmit(opt, opt);
    });
    div.appendChild(btn);
  });
  inputAreaEl.innerHTML = '';
  inputAreaEl.appendChild(div);
}

function renderMultiChoice(step: QStep, onSubmit: SubmitFn) {
  const selected = new Set<string>();
  const buttons = new Map<string, HTMLButtonElement>();

  const sync = () => {
    buttons.forEach((b, opt) => {
      const isOn = selected.has(opt);
      if (b.classList.contains('selected') !== isOn) b.classList.toggle('selected', isOn);
    });
  };

  const div = document.createElement('div');
  div.className = 'choices';
  (step.options ?? []).forEach((opt) => {
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
    const arr = [...selected];
    if (selected.has(OTHER_LABEL)) {
      const nonOther = arr.filter((x) => x !== OTHER_LABEL);
      renderOtherText(onSubmit, { selectedNonOther: nonOther });
    } else {
      onSubmit(arr, arr.join(', '));
    }
  });

  inputAreaEl.innerHTML = '';
  inputAreaEl.appendChild(div);
  inputAreaEl.appendChild(confirm);
}

function renderSlider(step: QStep, onSubmit: SubmitFn) {
  const min = step.min ?? 0;
  const max = step.max ?? 10;
  const initial = Math.round((min + max) / 2);
  inputAreaEl.innerHTML = `
    <div class="slider-wrap">
      <div class="slider-value" id="slider-val">${initial}</div>
      <input type="range" id="slider" min="${min}" max="${max}" value="${initial}" />
      <div class="slider-labels"><span>${min}</span><span>${max}</span></div>
      <button class="btn btn-primary mt-16" id="slider-submit">이 값으로 제출</button>
    </div>`;
  const slider = document.getElementById('slider') as HTMLInputElement;
  slider.oninput = () => { document.getElementById('slider-val')!.textContent = slider.value; };
  document.getElementById('slider-submit')!.addEventListener('click', () => {
    const v = Number(slider.value);
    onSubmit(v, String(v));
  });
}

function renderInput(step: QStep, onSubmit: SubmitFn) {
  const withOther = withOtherOption(step);
  switch (withOther.inputType) {
    case 'choice': renderChoice(withOther, onSubmit); break;
    case 'multi-choice': renderMultiChoice(withOther, onSubmit); break;
    case 'slider': renderSlider(withOther, onSubmit); break;
    case 'text':
    default: renderText(withOther, onSubmit);
  }
}

// ── 메인 흐름 ─────────────────────────────────────────────

function renderCurrent() {
  const step = getStep(currentStep, collected);
  if (!step) { finalize(); return; }

  setProgress();
  addBubble(step.text, 'ai');

  renderInput(step, (raw, display, otherText) => {
    addBubble(display, 'user');

    answers.push({
      questionId: step.id,
      questionText: step.text,
      inputType: step.inputType,
      rawValue: raw,
      displayValue: display,
      ...(otherText ? { otherText } : {}),
    });
    collected[step.id] = raw;

    // 즉시 응급 신호 체크 (이번 답변까지 누적된 collected 기준)
    const flag = checkImmediateRedFlag(collected);
    if (flag) {
      showEmergencyOverlay(flag.reason, () => {
        currentStep++;
        renderCurrent();
      });
    } else {
      currentStep++;
      renderCurrent();
    }
  });
}

function finalize() {
  inputAreaEl.innerHTML = '<div class="loading">예진 보고서를 만드는 중…</div>';
  const flowKey = getFlowKey(collected);
  const tsv = answersToTsv(answers, flowKey);

  sessionStorage.setItem('yejin_session_id', sessionId);
  sessionStorage.setItem('yejin_questionnaire_tsv', tsv);
  sessionStorage.setItem('yejin_questionnaire_flow', flowKey);
  sessionStorage.setItem('yejin_questionnaire_answers', JSON.stringify(answers));

  // 이전 모드(레거시·AI 챗) 페이로드 정리
  ['yejin_chat_summary', 'yejin_chat_history', 'yejin_chat_redflag', 'yejin_answers'].forEach((k) => {
    sessionStorage.removeItem(k);
  });

  setTimeout(() => { window.location.href = '/report.html'; }, 400);
}

async function init() {
  await requireAuth();
  sessionId = genSessionId();
  setProgress();
  renderCurrent();
}

init();
