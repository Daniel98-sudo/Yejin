import { requireAuth, authHeaders } from './auth-guard';
import { logout } from '../lib/firebase-client';

function formatResetDate(ms: number): string {
  const d = new Date(ms);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}년 ${m}월 ${day}일 (월) 00:00 (KST)`;
}

async function init() {
  await requireAuth();

  const res = await fetch('/api/consultation/quota', { headers: authHeaders() });
  if (!res.ok) {
    document.getElementById('quota-num')!.textContent = '?';
    return;
  }
  const data = await res.json() as { remaining: number; limit: number; used: number; resetAt: number };

  document.getElementById('quota-num')!.textContent = `${data.remaining} / ${data.limit}`;
  document.getElementById('quota-reset')!.textContent = `다음 리셋: ${formatResetDate(data.resetAt)}`;

  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  if (data.remaining <= 0) {
    startBtn.disabled = true;
    startBtn.textContent = '이번 주 횟수 모두 사용';
    startBtn.style.opacity = '0.5';
  } else {
    startBtn.addEventListener('click', () => { window.location.href = '/chat.html'; });
  }

  document.getElementById('logout-btn')!.addEventListener('click', () => logout());
}

init();
