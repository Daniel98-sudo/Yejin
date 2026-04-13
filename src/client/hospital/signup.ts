import { initFirebase, signUpWithEmail, getFirebaseAuth } from '../../lib/firebase-client';
import { signOut } from 'firebase/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FILE_SIZE = 600 * 1024; // 600KB

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function showMsg(text: string, kind: 'err' | 'ok' | 'info' = 'err') {
  const box = $('msg-box');
  box.innerHTML = `<div class="msg msg-${kind}">${text}</div>`;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleSubmit() {
  const btn = $<HTMLButtonElement>('submit-btn');
  btn.disabled = true;
  const original = btn.textContent;

  try {
    const email = ($('email') as HTMLInputElement).value.trim();
    const password = ($('password') as HTMLInputElement).value;
    const password2 = ($('password2') as HTMLInputElement).value;
    const name = ($('hospital-name') as HTMLInputElement).value.trim();
    const fileInput = $('cert-file') as HTMLInputElement;
    const file = fileInput.files?.[0];

    if (!email || !EMAIL_RE.test(email)) { showMsg('올바른 이메일을 입력해주세요.'); return; }
    if (password.length < 8) { showMsg('비밀번호는 8자 이상으로 설정해주세요.'); return; }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      showMsg('비밀번호는 영문자와 숫자를 모두 포함해야 합니다.'); return;
    }
    if (password !== password2) { showMsg('비밀번호가 일치하지 않습니다.'); return; }
    if (!name || name.length < 2) { showMsg('병원명을 2자 이상 입력해주세요.'); return; }
    if (!file) { showMsg('사업자등록증 파일을 첨부해주세요.'); return; }
    if (file.size > MAX_FILE_SIZE) {
      showMsg(`파일 크기는 600KB 이하여야 합니다. (현재 ${Math.round(file.size / 1024)}KB)`);
      return;
    }

    btn.textContent = '처리 중...';
    showMsg('계정 생성 중...', 'info');

    const user = await signUpWithEmail(email, password);
    const token = await user.getIdToken();

    const base64 = await readFileAsDataURL(file);

    showMsg('서류 업로드 중...', 'info');

    const res = await fetch('/api/hospital/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, businessCertBase64: base64 }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showMsg(err.error ?? '신청 처리에 실패했습니다.');
      return;
    }

    // 가입 직후 세션 로그아웃 — 이메일 인증 후 다시 로그인 유도
    await signOut(getFirebaseAuth());

    showMsg(
      `<strong>신청이 접수되었습니다.</strong><br/>
       1) <code>${email}</code> 로 발송된 인증 메일을 확인해주세요.<br/>
       2) 관리자 승인 후 병원 계정으로 로그인 가능합니다.<br/>
       <a href="/admin/login.html" style="color:#2563eb;">로그인 페이지로 이동 →</a>`,
      'ok'
    );
  } catch (e) {
    const code = (e as { code?: string })?.code ?? '';
    const map: Record<string, string> = {
      'auth/email-already-in-use': '이미 가입된 이메일입니다.',
      'auth/weak-password': '비밀번호가 너무 약합니다.',
      'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
    };
    showMsg(map[code] ?? (e instanceof Error ? e.message : '가입 처리에 실패했습니다.'));
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function init() {
  await initFirebase();
  $('submit-btn').addEventListener('click', handleSubmit);
}

init();
