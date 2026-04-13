import { initFirebase, signInWithGoogle } from '../lib/firebase-client';

async function init() {
  await initFirebase();

  document.getElementById('google-login')!.addEventListener('click', async () => {
    const btn = document.getElementById('google-login') as HTMLButtonElement;
    const errEl = document.getElementById('error-msg')!;
    btn.disabled = true;
    btn.textContent = '로그인 중...';
    errEl.classList.add('hidden');

    try {
      const user = await signInWithGoogle();
      const token = await user.getIdToken();
      sessionStorage.setItem('yejin_token', token);
      window.location.href = '/';
    } catch (e) {
      errEl.textContent = '로그인에 실패했습니다. 다시 시도해주세요.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Google로 계속하기';
    }
  });
}

init();
