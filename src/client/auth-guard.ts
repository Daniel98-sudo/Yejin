import { initFirebase, onAuthChanged, getIdToken } from '../lib/firebase-client';

/**
 * 모든 보호된 페이지 상단에서 호출.
 * 로그인 안 된 경우 /login.html로 리디렉션하고 null 반환.
 * 로그인된 경우 최신 ID 토큰을 반환.
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
      // 토큰 갱신 (만료 대비)
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
