import { initFirebase, onAuthChanged, getIdToken, getFirebaseAuth } from '../lib/firebase-client';

/**
 * 보호된 페이지 상단에서 호출.
 * - 미로그인 → /login.html 리디렉션
 * - 이메일 미인증 → /login.html 리디렉션 (재인증 유도)
 * - 정상 → 최신 ID 토큰 반환
 */
export async function requireAuth(): Promise<string> {
  await initFirebase();

  return new Promise((resolve) => {
    const unsub = onAuthChanged(async (user) => {
      unsub();
      if (!user) {
        window.location.href = '/login.html';
        return;
      }

      // 이메일/비밀번호 가입자는 인증 필수. Google 등은 자동 인증됨.
      await user.reload();
      const fresh = getFirebaseAuth().currentUser;
      if (!fresh || !fresh.emailVerified) {
        await getFirebaseAuth().signOut();
        window.location.href = '/login.html?unverified=1';
        return;
      }

      const token = await getIdToken();
      if (!token) {
        window.location.href = '/login.html';
        return;
      }
      sessionStorage.setItem('yejin_token', token);
      resolve(token);
    });
  });
}

export function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem('yejin_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
