import {
  initFirebase,
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  resendVerification,
  resetPassword,
  syncDataConsent,
  onAuthChanged,
  getFirebaseAuth,
} from '../lib/firebase-client';
import type { User } from 'firebase/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = 'signin' | 'signup';
let mode: Mode = 'signin';
let pendingUser: User | null = null;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function setMode(next: Mode) {
  mode = next;
  document.querySelectorAll('.auth-tab').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.mode === mode);
  });
  $('password2-field').classList.toggle('hidden', mode !== 'signup');
  $('pw-hint').classList.toggle('hidden', mode !== 'signup');
  $<HTMLButtonElement>('submit-btn').textContent = mode === 'signup' ? '가입하기' : '로그인';
  ($('password') as HTMLInputElement).autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  clearMsg();
}

function showMsg(text: string, kind: 'err' | 'ok' | 'info' = 'err', html = false) {
  const box = $('msg-box');
  box.innerHTML = `<div class="msg msg-${kind}"></div>`;
  const inner = box.firstElementChild as HTMLElement;
  if (html) inner.innerHTML = text; else inner.textContent = text;
}

function clearMsg() { $('msg-box').innerHTML = ''; }

const FIREBASE_ERRORS: Record<string, string> = {
  'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
  'auth/user-not-found': '존재하지 않는 계정입니다.',
  'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
  'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인 탭에서 시도해주세요.',
  'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
  'auth/account-exists-with-different-credential':
    '이미 이메일 또는 다른 방법으로 가입된 계정입니다. 원래 방법으로 로그인해주세요.',
  'auth/popup-closed-by-user': '로그인 창이 닫혔습니다.',
  'auth/popup-blocked': '팝업이 차단되었습니다. 브라우저 설정을 확인해주세요.',
};

function errMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  return FIREBASE_ERRORS[code] ?? '요청 처리에 실패했습니다. 다시 시도해주세요.';
}

async function proceedAfterLogin(user: User) {
  const token = await user.getIdToken();
  sessionStorage.setItem('yejin_token', token);
  await syncDataConsent(token);
  window.location.href = '/consult.html';
}

function showVerifyPrompt(user: User) {
  pendingUser = user;
  showMsg(
    `<strong>이메일 인증이 필요합니다.</strong><br/>
     <code>${user.email}</code> 로 인증 메일을 보냈습니다. 메일의 링크를 클릭한 뒤
     <button class="link-btn" id="reload-verify">여기를 눌러 다시 확인</button>해주세요.
     <br/><button class="link-btn" id="resend-btn">인증 메일 재전송</button>`,
    'info', true,
  );
  $('reload-verify').addEventListener('click', async () => {
    if (!pendingUser) return;
    await pendingUser.reload();
    if (pendingUser.emailVerified) {
      await proceedAfterLogin(pendingUser);
    } else {
      showMsg('아직 인증이 완료되지 않았습니다. 메일의 링크를 클릭해주세요.', 'info');
    }
  });
  $('resend-btn').addEventListener('click', async () => {
    if (!pendingUser) return;
    try {
      await resendVerification(pendingUser);
      showMsg('인증 메일을 재전송했습니다. 받은 편지함을 확인해주세요.', 'ok');
    } catch (e) {
      showMsg(errMessage(e), 'err');
    }
  });
}

async function handleEmailSubmit() {
  const email = ($('email') as HTMLInputElement).value.trim();
  const password = ($('password') as HTMLInputElement).value;
  const submitBtn = $<HTMLButtonElement>('submit-btn');

  if (!email || !password) { showMsg('이메일과 비밀번호를 입력해주세요.'); return; }
  if (!EMAIL_RE.test(email)) { showMsg('이메일 형식이 올바르지 않습니다.'); return; }

  if (mode === 'signup') {
    const password2 = ($('password2') as HTMLInputElement).value;
    if (password.length < 8) { showMsg('비밀번호는 8자 이상으로 설정해주세요.'); return; }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      showMsg('비밀번호는 영문자와 숫자를 모두 포함해야 합니다.'); return;
    }
    if (password !== password2) { showMsg('비밀번호가 일치하지 않습니다.'); return; }
  }

  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '처리 중...';

  try {
    const user = mode === 'signup'
      ? await signUpWithEmail(email, password)
      : await signInWithEmail(email, password);

    if (!user.emailVerified) {
      showVerifyPrompt(user);
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      return;
    }
    await proceedAfterLogin(user);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';

    // 가입 시도인데 이미 존재하는 이메일 → 같은 비밀번호로 로그인 시도
    // 이전 가입 시도가 인증 완료 안 된 경우 자동 복구 + 인증 메일 재발송
    if (mode === 'signup' && code === 'auth/email-already-in-use') {
      try {
        const user = await signInWithEmail(email, password);
        if (!user.emailVerified) {
          await resendVerification(user);
          showVerifyPrompt(user);
          showMsg(`이전에 가입을 시작하셨던 이메일입니다. ${email} 로 인증 메일을 다시 보냈습니다. 메일을 확인해주세요.`, 'info');
        } else {
          await proceedAfterLogin(user);
        }
      } catch (e2) {
        const code2 = (e2 as { code?: string }).code ?? '';
        if (code2 === 'auth/wrong-password' || code2 === 'auth/invalid-credential') {
          showMsg('이미 다른 비밀번호로 가입된 이메일입니다. <strong>로그인</strong> 탭에서 시도하시거나, 비밀번호를 잊으셨다면 "비밀번호를 잊으셨나요?"를 눌러주세요.', 'err', true);
        } else {
          showMsg(errMessage(e2));
        }
      }
    } else {
      showMsg(errMessage(e));
    }

    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function handleGoogleLogin() {
  const btn = $<HTMLButtonElement>('google-login');
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.textContent = '로그인 중...';
  clearMsg();

  try {
    const user = await signInWithGoogle();
    // Google은 이미 이메일 인증된 계정만 제공
    await proceedAfterLogin(user);
  } catch (e) {
    showMsg(errMessage(e));
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function handleForgotPassword() {
  const email = ($('email') as HTMLInputElement).value.trim();
  if (!email) { showMsg('비밀번호를 재설정할 이메일을 입력 칸에 먼저 적어주세요.'); return; }
  try {
    await resetPassword(email);
    showMsg(`비밀번호 재설정 메일을 ${email} 로 보냈습니다.`, 'ok');
  } catch (e) {
    showMsg(errMessage(e));
  }
}

function handlePendingBanner() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === '1') {
    showMsg('이메일 인증이 완료되었습니다. 로그인해주세요.', 'ok');
  }
  if (params.get('unverified') === '1') {
    showMsg('이메일 인증이 필요합니다. 로그인 후 인증 메일을 확인해주세요.', 'info');
  }
}

async function init() {
  await initFirebase();

  // 이미 인증된 세션이 있으면 바로 채팅으로
  onAuthChanged(async (user) => {
    if (!user) return;
    await user.reload();
    const fresh = getFirebaseAuth().currentUser;
    if (fresh && fresh.emailVerified) {
      const token = await fresh.getIdToken();
      sessionStorage.setItem('yejin_token', token);
      await syncDataConsent(token);
      window.location.href = '/consult.html';
    }
  });

  document.querySelectorAll('.auth-tab').forEach((el) => {
    el.addEventListener('click', () => setMode((el as HTMLElement).dataset.mode as Mode));
  });

  $('submit-btn').addEventListener('click', handleEmailSubmit);
  $('google-login').addEventListener('click', handleGoogleLogin);
  $('forgot-btn').addEventListener('click', handleForgotPassword);

  [$('email'), $('password'), $('password2')].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') handleEmailSubmit();
    });
  });

  handlePendingBanner();
}

init();
