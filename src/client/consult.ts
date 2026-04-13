import { requireAuth, authHeaders } from './auth-guard';
import { logout } from '../lib/firebase-client';

function formatResetDate(ms: number): string {
  const d = new Date(ms);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}월 ${day}일 월요일`;
}

function daysUntil(ms: number): number {
  const diff = ms - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

async function init() {
  await requireAuth();

  const res = await fetch('/api/consultation/quota', { headers: authHeaders() });
  if (!res.ok) {
    document.getElementById('quota-num')!.textContent = '?';
    return;
  }
  const data = await res.json() as { remaining: number; limit: number; used: number; resetAt: number };

  document.getElementById('quota-num')!.textContent = `${data.remaining}번`;

  const days = daysUntil(data.resetAt);
  const dayText = days === 0 ? '오늘 밤 자정 이후' : `${days}일 뒤`;
  document.getElementById('quota-reset')!.textContent =
    `${dayText}(${formatResetDate(data.resetAt)})부터 다시 3번 사용하실 수 있어요.`;

  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  if (data.remaining <= 0) {
    startBtn.disabled = true;
    startBtn.textContent = '이번 주 횟수를 모두 쓰셨어요';
    startBtn.style.opacity = '0.5';
  } else {
    startBtn.addEventListener('click', () => { window.location.href = '/chat.html'; });
  }

  document.getElementById('logout-btn')!.addEventListener('click', () => logout());
}

init();
