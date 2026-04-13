import { initFirebase, getFirebaseAuth, logout } from '../lib/firebase-client';
import {
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
  type User,
} from 'firebase/auth';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let currentUser: User | null = null;
let currentRole: string | null = null;

function showMsg(target: string, text: string, kind: 'err' | 'ok' = 'err') {
  $(target).innerHTML = `<div class="msg msg-${kind}">${text}</div>`;
}

function formatDate(ms: number | null): string {
  if (!ms) return '-';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function roleLabel(role: string | null, hospitalStatus?: string): string {
  if (role === 'superadmin') return '슈퍼 관리자';
  if (role === 'hospital') return '병원 회원 (승인 완료)';
  if (hospitalStatus === 'pending') return '병원 회원 (승인 대기)';
  if (hospitalStatus === 'rejected') return '병원 회원 (승인 거부됨)';
  return '환자 회원';
}

async function loadQuota(token: string) {
  const res = await fetch('/api/consultation/quota', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return;
  const data = await res.json() as { remaining: number; limit: number; resetAt: number };
  $('quota-section').classList.remove('hidden');
  $('info-quota').textContent = `${data.remaining}번 / ${data.limit}번`;
  const reset = new Date(data.resetAt);
  $('info-reset').textContent = `${reset.getMonth() + 1}월 ${reset.getDate()}일 월요일`;
}

async function loadPage(user: User) {
  currentUser = user;
  const token = await user.getIdToken();
  const tokenResult = await user.getIdTokenResult();
  currentRole = (tokenResult.claims['role'] as string) ?? null;

  // 병원 회원 상태 추가 조회
  let hospitalStatus: string | undefined;
  if (!currentRole || currentRole === 'hospital') {
    try {
      const r = await fetch('/api/hospital/status', { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) hospitalStatus = ((await r.json()) as { status: string }).status;
    } catch {}
  }

  $('info-email').textContent = user.email ?? '-';
  $('info-created').textContent = formatDate(user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : null);
  $('info-verified').textContent = user.emailVerified ? '완료' : '미인증';
  $('info-role').textContent = roleLabel(currentRole, hospitalStatus);

  // 돌아가기 링크 역할별 조정
  const back = $('back-link') as HTMLAnchorElement;
  if (currentRole === 'superadmin') back.href = '/admin/dashboard.html';
  else if (currentRole === 'hospital') back.href = '/hospital/dashboard.html';
  else back.href = '/consult.html';

  // 환자에게만 쿼터 섹션 표시
  if (!currentRole) await loadQuota(token);

  // 소셜 전용 계정(비밀번호 없음)은 비밀번호 변경 불가
  const providerIds = user.providerData.map((p) => p.providerId);
  if (!providerIds.includes('password')) {
    $('password-section').innerHTML = `
      <h3>🔒 비밀번호</h3>
      <p style="font-size:13px; color:var(--text-muted); margin:0;">
        이 계정은 Google 로그인으로 가입되어 비밀번호가 설정되어 있지 않습니다.
      </p>`;
  }

  $('loading').classList.add('hidden');
  $('mypage-content').classList.remove('hidden');
}

async function changePassword() {
  const btn = $<HTMLButtonElement>('pw-submit');
  const current = ($('pw-current') as HTMLInputElement).value;
  const next = ($('pw-new') as HTMLInputElement).value;
  const next2 = ($('pw-new2') as HTMLInputElement).value;

  if (!current || !next || !next2) { showMsg('pw-msg', '모든 필드를 입력해주세요.'); return; }
  if (next.length < 8) { showMsg('pw-msg', '새 비밀번호는 8자 이상이어야 합니다.'); return; }
  if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) { showMsg('pw-msg', '영문자와 숫자를 모두 포함해야 합니다.'); return; }
  if (next !== next2) { showMsg('pw-msg', '새 비밀번호가 일치하지 않습니다.'); return; }
  if (!currentUser || !currentUser.email) return;

  btn.disabled = true;
  btn.textContent = '변경 중...';
  try {
    const cred = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, cred);
    await updatePassword(currentUser, next);
    showMsg('pw-msg', '비밀번호가 변경되었습니다.', 'ok');
    ['pw-current', 'pw-new', 'pw-new2'].forEach((id) => { ($(id) as HTMLInputElement).value = ''; });
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    const map: Record<string, string> = {
      'auth/wrong-password': '현재 비밀번호가 올바르지 않습니다.',
      'auth/invalid-credential': '현재 비밀번호가 올바르지 않습니다.',
      'auth/weak-password': '새 비밀번호가 너무 약합니다.',
      'auth/requires-recent-login': '보안을 위해 로그아웃 후 다시 로그인한 뒤 시도해주세요.',
    };
    showMsg('pw-msg', map[code] ?? '비밀번호 변경에 실패했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = '비밀번호 변경';
  }
}

async function deleteAccount() {
  if (!currentUser) return;

  const confirmText = prompt('회원탈퇴를 진행하려면 이메일을 정확히 입력해주세요.\n(취소하려면 Esc)');
  if (confirmText !== currentUser.email) {
    if (confirmText !== null) showMsg('del-msg', '이메일이 일치하지 않아 취소되었습니다.');
    return;
  }
  if (!confirm('정말 탈퇴하시겠습니까? 모든 데이터가 영구 삭제됩니다.')) return;

  const btn = $<HTMLButtonElement>('delete-btn');
  btn.disabled = true;
  btn.textContent = '삭제 중...';

  try {
    const token = await currentUser.getIdToken();
    const res = await fetch('/api/account/delete', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '삭제 실패' }));
      // requires-recent-login 대응: 로그아웃 후 재로그인 유도
      if (res.status === 401 || (err.error ?? '').includes('recent')) {
        alert('보안을 위해 다시 로그인한 뒤 탈퇴를 진행해주세요.');
        await logout();
        return;
      }
      showMsg('del-msg', err.error ?? '삭제 실패');
      btn.disabled = false;
      btn.textContent = '회원탈퇴';
      return;
    }

    // 서버가 Admin SDK로 Auth 계정까지 삭제했으므로 클라이언트는 signOut 후 홈으로
    try { await deleteUser(currentUser); } catch {}
    alert('탈퇴가 완료되었습니다. 이용해주셔서 감사합니다.');
    sessionStorage.clear();
    window.location.href = '/';
  } catch (e) {
    showMsg('del-msg', e instanceof Error ? e.message : '삭제 실패');
    btn.disabled = false;
    btn.textContent = '회원탈퇴';
  }
}

async function init() {
  await initFirebase();

  onAuthStateChanged(getFirebaseAuth(), async (user) => {
    if (!user) { window.location.href = '/login.html'; return; }
    if (!user.emailVerified) { window.location.href = '/login.html?unverified=1'; return; }
    await loadPage(user);
  });

  $('pw-submit').addEventListener('click', changePassword);
  $('delete-btn').addEventListener('click', deleteAccount);
  $('logout-btn').addEventListener('click', () => logout());
}

init();
