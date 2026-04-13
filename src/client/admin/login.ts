import { initFirebase, signInWithGoogle } from '../../lib/firebase-client';

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
      const token = await user.getIdToken(true); // force refresh to get claims

      // 관리자 권한 확인
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { uid: string };

      // ID token에서 role claim 확인
      const idTokenResult = await user.getIdTokenResult(true);
      const role = idTokenResult.claims['role'];

      if (role !== 'superadmin' && role !== 'hospital') {
        errEl.textContent = '관리자 권한이 없는 계정입니다.';
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Google 계정으로 로그인';
        return;
      }

      sessionStorage.setItem('yejin_admin_token', token);
      sessionStorage.setItem('yejin_admin_role', String(role));
      window.location.href = '/admin/dashboard.html';
    } catch {
      errEl.textContent = '로그인에 실패했습니다. 다시 시도해주세요.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Google 계정으로 로그인';
    }
  });
}

init();
