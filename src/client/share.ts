import { initFirebase, getFirebaseAuth, logout } from '../lib/firebase-client';
import { onAuthStateChanged } from 'firebase/auth';

const statusMsg = () => document.getElementById('status-msg')!;
const detail = () => document.getElementById('detail')!;
const cta = () => document.getElementById('cta')!;

function setState(title: string, body: string, kind: 'info' | 'err' | 'ok' = 'info') {
  statusMsg().textContent = title;
  detail().innerHTML = body;
  if (kind === 'err') {
    detail().style.background = '#fef2f2';
    detail().style.borderColor = '#fecaca';
    detail().style.color = '#991b1b';
  } else if (kind === 'ok') {
    detail().style.background = '#f0fdf4';
    detail().style.borderColor = '#bbf7d0';
    detail().style.color = '#166534';
  }
}

async function claim(token: string) {
  const user = getFirebaseAuth().currentUser;
  if (!user) { promptLogin(token); return; }

  const tokenResult = await user.getIdTokenResult(true);
  const role = tokenResult.claims['role'];
  if (role !== 'hospital') {
    setState(
      '병원 계정 필요',
      `이 QR은 병원 계정으로만 수신할 수 있습니다. 현재 계정 역할: <code>${String(role ?? 'none')}</code>`,
      'err'
    );
    cta().innerHTML = `<button id="logout-btn" class="btn btn-ghost" style="width:100%;">로그아웃</button>`;
    document.getElementById('logout-btn')!.addEventListener('click', () => logout());
    return;
  }

  setState('인증 확인 중...', '잠시만 기다려주세요.');

  const idToken = await user.getIdToken();
  const res = await fetch('/api/share/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'claim 실패' }));
    setState('수신 실패', err.error ?? '알 수 없는 오류', 'err');
    cta().innerHTML = `<a href="/hospital/dashboard.html" class="btn btn-primary" style="width:100%; display:block; text-align:center;">대시보드로 이동</a>`;
    return;
  }

  const data = await res.json() as { viewHours: number };
  setState(
    '수신 완료',
    `향후 <strong>${data.viewHours}시간</strong> 동안 병원 대시보드에서 이 환자의 예진 보고서를 열람할 수 있습니다.`,
    'ok'
  );
  cta().innerHTML = `<a href="/hospital/dashboard.html" class="btn btn-primary" style="width:100%; display:block; text-align:center;">대시보드로 이동 →</a>`;
}

function promptLogin(token: string) {
  setState(
    '병원 계정 로그인 필요',
    '병원 계정으로 로그인한 뒤 이 페이지로 다시 접속해주세요. 로그인 후 같은 링크로 돌아오면 자동 처리됩니다.',
    'err'
  );
  const returnUrl = `/share.html?t=${encodeURIComponent(token)}`;
  cta().innerHTML = `<a href="/admin/login.html?return=${encodeURIComponent(returnUrl)}" class="btn btn-primary" style="width:100%; display:block; text-align:center;">관리자·병원 로그인</a>`;
}

async function init() {
  await initFirebase();

  const params = new URLSearchParams(location.search);
  const token = params.get('t');
  if (!token) { setState('잘못된 링크', 'QR 토큰이 없습니다.', 'err'); return; }

  onAuthStateChanged(getFirebaseAuth(), async (user) => {
    if (!user) { promptLogin(token); return; }
    await claim(token);
  });
}

init();
