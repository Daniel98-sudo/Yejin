import { initFirebase, getFirebaseAuth, logout } from '../../lib/firebase-client';
import { onAuthStateChanged } from 'firebase/auth';

async function checkStatus() {
  const user = getFirebaseAuth().currentUser;
  if (!user) { window.location.href = '/admin/login.html'; return; }

  // 최신 토큰(custom claim 포함) 강제 갱신
  const tokenResult = await user.getIdTokenResult(true);
  const role = tokenResult.claims['role'];

  if (role === 'hospital') {
    window.location.href = '/hospital/dashboard.html';
    return;
  }

  const token = await user.getIdToken();
  const res = await fetch('/api/hospital/status', { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json() as { status: string; name?: string };

  const statusMsg = document.getElementById('status-msg')!;
  const detail = document.getElementById('detail')!;

  if (data.status === 'rejected') {
    statusMsg.textContent = '신청이 반려되었습니다.';
    detail.innerHTML = '관리자에 의해 병원 신청이 반려되었습니다. 문의사항이 있으시면 관리자에게 연락해주세요.';
    detail.style.background = '#fef2f2';
    detail.style.borderColor = '#fecaca';
    detail.style.color = '#991b1b';
  } else if (data.status === 'none') {
    statusMsg.textContent = '신청 기록이 없습니다.';
    detail.innerHTML = `<a href="/hospital/signup.html" style="color:#2563eb;">병원 회원가입 →</a>`;
  } else {
    statusMsg.textContent = `${data.name ?? '병원'} — 승인 대기 중`;
  }
}

async function init() {
  await initFirebase();

  onAuthStateChanged(getFirebaseAuth(), async (user) => {
    if (!user) { window.location.href = '/admin/login.html'; return; }
    await checkStatus();
  });

  document.getElementById('refresh-btn')!.addEventListener('click', checkStatus);
  document.getElementById('logout-btn')!.addEventListener('click', () => logout());
}

init();
