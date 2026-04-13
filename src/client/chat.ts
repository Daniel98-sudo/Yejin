import type {
  Answer,
  AnswerResponse,
  Question,
  RedFlagResult,
  StartSessionResponse,
} from '../types/index';

const TOTAL_STEPS = 7;

let sessionId = '';
let answers: Answer[] = [];
let currentStep = 0;

const messagesEl = document.getElementById('messages')!;
const inputAreaEl = document.getElementById('input-area')!;
const progressEl = document.getElementById('progress')!;
const stepLabelEl = document.getElementById('step-label')!;
const overlay = document.getElementById('redflag-overlay')!;

// ── Helpers ──────────────────────────────────────────────

function addBubble(text: string, who: 'ai' | 'user') {
  const div = document.createElement('div');
  div.className = `bubble bubble-${who}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setProgress(step: number) {
  const pct = Math.round((step / TOTAL_STEPS) * 100);
  progressEl.style.width = `${pct}%`;
  stepLabelEl.textContent = `${step} / ${TOTAL_STEPS}`;
}

function showRedFlagOverlay(rf: RedFlagResult, onContinue: () => void) {
  if (rf.level === 'ROUTINE') {
    onContinue();
    return;
  }

  const icons: Record<string, string> = {
    EMERGENCY: '🚨',
    URGENT: '⚠️',
    WARNING: '📋',
  };
  const titles: Record<string, string> = {
    EMERGENCY: '응급 상황 감지',
    URGENT: '빠른 진료 필요',
    WARNING: '진료 권고',
  };

  overlay.classList.remove('hidden', 'EMERGENCY', 'URGENT', 'WARNING');
  overlay.classList.add(rf.level);
  document.getElementById('flag-icon')!.textContent = icons[rf.level];
  document.getElementById('flag-title')!.textContent = titles[rf.level];
  document.getElementById('flag-reason')!.textContent = rf.reason;
  document.getElementById('flag-action')!.textContent = rf.action;

  const btn119 = document.getElementById('flag-119')!;
  if (rf.level === 'EMERGENCY') {
    btn119.classList.remove('hidden');
  }

  document.getElementById('flag-continue')!.onclick = () => {
    overlay.classList.add('hidden');
    onContinue();
  };
}

// ── Input Renderers ───────────────────────────────────────

function renderTextInput(question: Question, onSubmit: (v: string) => void) {
  inputAreaEl.innerHTML = `
    <div class="text-input-wrap">
      <textarea id="txt" rows="2" placeholder="${question.placeholder ?? ''}"></textarea>
      <button class="send-btn" id="send-btn">→</button>
    </div>`;
  const txt = document.getElementById('txt') as HTMLTextAreaElement;
  const btn = document.getElementById('send-btn')!;
  txt.focus();
  const submit = () => {
    const val = txt.value.trim();
    if (!val) return;
    onSubmit(val);
  };
  btn.onclick = submit;
  txt.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };
}

function renderChoices(question: Question, onSubmit: (v: string) => void) {
  const div = document.createElement('div');
  div.className = 'choices';
  (question.options ?? []).forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = opt;
    btn.onclick = () => onSubmit(opt);
    div.appendChild(btn);
  });
  inputAreaEl.innerHTML = '';
  inputAreaEl.appendChild(div);
}

function renderSlider(question: Question, onSubmit: (v: number) => void) {
  inputAreaEl.innerHTML = `
    <div class="slider-wrap">
      <div class="slider-value" id="slider-val">5</div>
      <input type="range" id="slider" min="${question.min ?? 0}" max="${question.max ?? 10}" value="5" />
      <div class="slider-labels"><span>0 (없음)</span><span>10 (극심함)</span></div>
      <button class="btn btn-primary mt-16" id="slider-submit">이 점수로 제출</button>
    </div>`;
  const slider = document.getElementById('slider') as HTMLInputElement;
  const valEl = document.getElementById('slider-val')!;
  slider.oninput = () => { valEl.textContent = slider.value; };
  document.getElementById('slider-submit')!.onclick = () => onSubmit(Number(slider.value));
}

function renderMultiChoice(question: Question, onSubmit: (v: string[]) => void) {
  const selected = new Set<string>();
  const div = document.createElement('div');
  div.className = 'choices';
  (question.options ?? []).forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = opt;
    btn.onclick = () => {
      if (opt === '해당 없음') {
        selected.clear();
        div.querySelectorAll('.choice-btn').forEach((b) => b.classList.remove('selected'));
        selected.add(opt);
        btn.classList.add('selected');
      } else {
        selected.delete('해당 없음');
        if (selected.has(opt)) {
          selected.delete(opt);
          btn.classList.remove('selected');
        } else {
          selected.add(opt);
          btn.classList.add('selected');
        }
      }
    };
    div.appendChild(btn);
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-primary mt-16';
  confirmBtn.textContent = '선택 완료';
  confirmBtn.onclick = () => {
    if (selected.size === 0) selected.add('해당 없음');
    onSubmit([...selected]);
  };

  inputAreaEl.innerHTML = '';
  inputAreaEl.appendChild(div);
  inputAreaEl.appendChild(confirmBtn);
}

// ── Core Flow ─────────────────────────────────────────────

function renderQuestion(question: Question) {
  addBubble(question.text, 'ai');
  inputAreaEl.innerHTML = '';

  const handleAnswer = async (value: string | number | string[]) => {
    const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
    addBubble(displayValue, 'user');
    inputAreaEl.innerHTML = '<div class="loading">다음 질문을 불러오는 중...</div>';

    const answer: Answer = {
      questionId: question.id,
      questionText: question.text,
      value,
    };
    answers = [...answers, answer];
    currentStep += 1;
    setProgress(currentStep);

    const res = await fetch('/api/consultation/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, answers, currentStep }),
    });

    const data: AnswerResponse = await res.json();

    if (data.complete || !data.nextQuestion) {
      inputAreaEl.innerHTML = '';
      showRedFlagOverlay(data.redFlag, goToReport);
    } else {
      showRedFlagOverlay(data.redFlag, () => renderQuestion(data.nextQuestion!));
    }
  };

  switch (question.type) {
    case 'text':
      renderTextInput(question, (v) => handleAnswer(v));
      break;
    case 'choice':
      renderChoices(question, (v) => handleAnswer(v));
      break;
    case 'slider':
      renderSlider(question, (v) => handleAnswer(v));
      break;
    case 'multi-choice':
      renderMultiChoice(question, (v) => handleAnswer(v));
      break;
  }
}

function goToReport() {
  sessionStorage.setItem('yejin_answers', JSON.stringify(answers));
  window.location.href = '/report.html';
}

// ── Init ──────────────────────────────────────────────────

async function init() {
  setProgress(0);
  addBubble('안녕하세요! 저는 예진이예요. 잠깐만요...', 'ai');

  const res = await fetch('/api/consultation/start', { method: 'POST' });
  const data: StartSessionResponse = await res.json();
  sessionId = data.sessionId;

  messagesEl.innerHTML = '';
  renderQuestion(data.firstQuestion);
}

init();
