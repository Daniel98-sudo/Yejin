import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
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
