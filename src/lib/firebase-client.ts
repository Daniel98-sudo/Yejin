import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  fetchSignInMethodsForEmail,
  type Auth,
  type User,
} from 'firebase/auth';

let app: FirebaseApp;
let auth: Auth;
let initialized = false;

export async function initFirebase(): Promise<void> {
  if (initialized) return;

  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('Firebase 설정을 불러오지 못했습니다.');
  const config = await res.json();

  if (getApps().length === 0) {
    app = initializeApp(config);
  } else {
    app = getApps()[0];
  }
  auth = getAuth(app);
  initialized = true;
}

export function getFirebaseAuth(): Auth {
  if (!auth) throw new Error('Firebase가 초기화되지 않았습니다. initFirebase()를 먼저 호출하세요.');
  return auth;
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
  return result.user;
}

export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
  await sendEmailVerification(cred.user, {
    url: `${window.location.origin}/login.html?verified=1`,
  });
  return cred.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  return cred.user;
}

export async function resendVerification(user: User): Promise<void> {
  await sendEmailVerification(user, {
    url: `${window.location.origin}/login.html?verified=1`,
  });
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email, {
    url: `${window.location.origin}/login.html`,
  });
}

export async function checkEmailProviders(email: string): Promise<string[]> {
  return fetchSignInMethodsForEmail(getFirebaseAuth(), email);
}

export async function logout(): Promise<void> {
  await signOut(getFirebaseAuth());
  sessionStorage.clear();
  window.location.href = '/login.html';
}

export function onAuthChanged(callback: (user: User | null) => void) {
  return onAuthStateChanged(getFirebaseAuth(), callback);
}

export async function getIdToken(): Promise<string | null> {
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

/**
 * 로그인 직후 sessionStorage의 데이터 수집 동의를 Firestore에 기록.
 * 환자 로그인 플로우에서 매 로그인마다 호출.
 */
export async function syncDataConsent(token: string): Promise<void> {
  const raw = sessionStorage.getItem('yejin_data_consent');
  if (raw === null) return;
  try {
    await fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consent: raw === 'true' }),
    });
    sessionStorage.removeItem('yejin_data_consent');
  } catch {
    // 동의 저장 실패는 치명적이지 않음 — 다음 세션에 재시도
  }
}
