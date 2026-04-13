import { initFirebase, getFirebaseAuth } from '../../lib/firebase-client';
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
  type User,
} from 'firebase/auth';

const emailEl = () => document.getElementById('email') as HTMLInputElement;
const passwordEl = () => document.getElementById('password') as HTMLInputElement;
const loginBtn = () => document.getElementById('login-btn') as HTMLButtonElement;
const errEl = () => document.getElementById('error-msg')!;
const verifyEl = () => document.getElementById('verify-msg')!;

function showError(msg: string) {
  errEl().textContent = msg;
  errEl().classList.remove('hidden');
  verifyEl().classList.add('hidden');
}

function showVerifyPrompt(user: User) {
  errEl().classList.add('hidden');
  verifyEl().classList.remove('hidden');

  document.getElementById('resend-btn')!.onclick = async () => {
    await sendEmailVerification(user);
    verifyEl().textContent = '인증 메일을 재발송했습니다. 받은 편지함을 확인해 주세요.';
  };
}

async function init() {
  await initFirebase();

  // 이미 인증된 세션이 있으면 바로 대시보드로
  const auth = getFirebaseAuth();
  const currentUser = auth.currentUser;
  if (currentUser?.emailVerified) {
    const result = await currentUser.getIdTokenResult(true);
    if (result.claims['role'] === 'superadmin' || result.claims['role'] === 'hospital') {
      window.location.href = '/admin/dashboard.html';
      return;
    }
  }

  loginBtn().addEventListener('click', async () => {
    const email = emailEl().value.trim();
    const password = passwordEl().value;
    errEl().classList.add('hidden');
    verifyEl().classList.add('hidden');

    if (!email || !password) { showError('이메일과 비밀번호를 입력해 주세요.'); return; }

    loginBtn().disabled = true;
    loginBtn().textContent = '로그인 중...';

    try {
      const auth = getFirebaseAuth();
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const user = cred.user;

      // 이메일 인증 확인 (항상)
      if (!user.emailVerified) {
        showVerifyPrompt(user);
        loginBtn().disabled = false;
        loginBtn().textContent = '로그인';
        return;
      }

      // Custom Claims에서 role 확인
      const tokenResult = await user.getIdTokenResult(true);
      const role = tokenResult.claims['role'];

      const token = await user.getIdToken();
      sessionStorage.setItem('yejin_admin_token', token);
      sessionStorage.setItem('yejin_admin_role', String(role ?? ''));

      const returnUrl = new URLSearchParams(location.search).get('return');
      const safeReturn = returnUrl && returnUrl.startsWith('/') ? returnUrl : null;

      if (role === 'superadmin') {
        window.location.href = safeReturn ?? '/admin/dashboard.html';
      } else if (role === 'hospital') {
        window.location.href = safeReturn ?? '/hospital/dashboard.html';
      } else {
        // 권한 없는 계정 — 병원 신청 여부 확인
        const statusRes = await fetch('/api/hospital/status', { headers: { Authorization: `Bearer ${token}` } });
        const statusData = await statusRes.json() as { status: string };
        if (statusData.status === 'pending' || statusData.status === 'rejected') {
          window.location.href = '/hospital/pending.html';
        } else {
          showError('관리자 권한이 없는 계정입니다. 병원 회원가입이 필요하신가요?');
          loginBtn().disabled = false;
          loginBtn().textContent = '로그인';
        }
      }

    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? '';
      const messages: Record<string, string> = {
        'auth/user-not-found': '존재하지 않는 이메일입니다.',
        'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
        'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
        'auth/too-many-requests': '너무 많은 시도가 감지됐습니다. 잠시 후 다시 시도하세요.',
      };
      showError(messages[code] ?? '로그인에 실패했습니다. 다시 시도해 주세요.');
      loginBtn().disabled = false;
      loginBtn().textContent = '로그인';
    }
  });

  // Enter 키 지원
  [emailEl(), passwordEl()].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginBtn().click();
    });
  });
}

init();
