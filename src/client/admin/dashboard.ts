import { initFirebase, getFirebaseAuth, logout } from '../../lib/firebase-client';
import { onAuthStateChanged } from 'firebase/auth';

const FLAG_COLORS: Record<string, string> = {
  EMERGENCY: '#dc2626',
  URGENT: '#ea580c',
  WARNING: '#ca8a04',
  ROUTINE: '#16a34a',
};

let currentOffset = 0;
const PAGE_SIZE = 20;
let adminToken = '';

function adminHeaders() {
  return { Authorization: `Bearer ${adminToken}` };
}

async function loadStats() {
  const res = await fetch('/api/admin/stats', { headers: adminHeaders() });
  if (res.status === 403) { window.location.href = '/admin/login.html'; return; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`/api/admin/stats: ${err.error ?? res.statusText}`);
  }

  const data = await res.json() as {
    totalSessions: number;
    totalConsentedUsers: number;
    recentSessions7d: number;
    redFlagBreakdown: Record<string, number>;
  };

  document.getElementById('stat-total')!.textContent = String(data.totalSessions);
  document.getElementById('stat-users')!.textContent = String(data.totalConsentedUsers);
  document.getElementById('stat-recent')!.textContent = String(data.recentSessions7d);
  document.getElementById('stat-emergency')!.textContent = String(data.redFlagBreakdown['EMERGENCY'] ?? 0);

  const total = Object.values(data.redFlagBreakdown).reduce((a, b) => a + b, 0) || 1;
  document.getElementById('flag-chart')!.innerHTML = Object.entries(data.redFlagBreakdown)
    .map(([level, count]) => `
      <div class="flag-bar">
        <span style="width:90px;color:${FLAG_COLORS[level]};font-weight:600;">${level}</span>
        <div class="bar"><div class="fill" style="width:${Math.round((count/total)*100)}%;background:${FLAG_COLORS[level]};"></div></div>
        <span style="width:40px;text-align:right;color:var(--text-muted);">${count}</span>
      </div>`).join('');
}

async function loadSessions(offset: number) {
  const res = await fetch(`/api/admin/sessions?limit=${PAGE_SIZE}&offset=${offset}`, {
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`/api/admin/sessions: ${err.error ?? res.statusText}`);
  }
  const data = await res.json() as {
    sessions: Array<{ id: string; uid: string; date: string; painScale: number; redFlagLevel: string }>;
    total: number;
  };

  document.getElementById('total-badge')!.textContent = `(총 ${data.total}건)`;
  const tbody = document.getElementById('sessions-table')!;
  tbody.innerHTML = data.sessions.map((s) => `
    <tr>
      <td>${s.date ?? '-'}</td>
      <td style="font-family:monospace;color:var(--text-muted);">${(s.uid ?? '').slice(0, 8)}...</td>
      <td>${s.painScale ?? '-'}</td>
      <td><span class="badge badge-${s.redFlagLevel}">${s.redFlagLevel}</span></td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">데이터 없음</td></tr>';

  (document.getElementById('prev-btn') as HTMLButtonElement).disabled = offset === 0;
  (document.getElementById('next-btn') as HTMLButtonElement).disabled = offset + PAGE_SIZE >= data.total;
}

async function init() {
  await initFirebase();
  const auth = getFirebaseAuth();

  // auth 상태 복원을 기다린 후 권한 확인
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = '/admin/login.html';
      return;
    }

    const tokenResult = await user.getIdTokenResult(true);
    const role = tokenResult.claims['role'];

    if (role !== 'superadmin') {
      window.location.href = '/admin/login.html';
      return;
    }

    adminToken = await user.getIdToken();

    document.getElementById('logout-btn')!.addEventListener('click', () => logout());
    document.getElementById('search-btn')!.addEventListener('click', searchUser);
    document.getElementById('search-email')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') searchUser();
    });
    document.getElementById('prev-btn')!.addEventListener('click', async () => {
      currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
      await loadSessions(currentOffset).catch(showError);
    });
    document.getElementById('next-btn')!.addEventListener('click', async () => {
      currentOffset += PAGE_SIZE;
      await loadSessions(currentOffset).catch(showError);
    });

    try {
      await Promise.all([loadStats(), loadSessions(0), loadHospitals()]);
      document.getElementById('loading')!.classList.add('hidden');
      document.getElementById('dashboard')!.classList.remove('hidden');
    } catch (e) {
      showError(e);
    }
  });
}

interface HospitalSummary {
  uid: string;
  email: string;
  name: string;
  createdAt: { _seconds?: number; seconds?: number } | number;
}

async function loadHospitals() {
  const res = await fetch('/api/admin/hospitals', { headers: adminHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`/api/admin/hospitals: ${err.error ?? res.statusText}`);
  }

  const data = await res.json() as { hospitals: HospitalSummary[] };
  const list = data.hospitals ?? [];
  const badge = document.getElementById('hospital-badge')!;
  const container = document.getElementById('hospital-list')!;
  badge.textContent = list.length ? `(${list.length}건)` : '';

  if (list.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); font-size:13px; padding:12px 0;">대기 중인 병원 신청이 없습니다.</div>';
    return;
  }

  container.innerHTML = list.map((h) => `
    <div class="hospital-row" data-uid="${h.uid}" style="border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; align-items:start; gap:12px;">
        <div>
          <div style="font-weight:600;">${h.name}</div>
          <div style="font-size:12px; color:var(--text-muted);">${h.email}</div>
          <div style="font-size:11px; color:var(--text-muted); font-family:monospace;">${h.uid.slice(0, 12)}...</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn-view" data-uid="${h.uid}" style="padding:6px 12px; font-size:12px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; cursor:pointer;">서류 보기</button>
          <button class="btn-approve" data-uid="${h.uid}" style="padding:6px 12px; font-size:12px; background:#16a34a; color:white; border:none; border-radius:6px; cursor:pointer;">승인</button>
          <button class="btn-reject" data-uid="${h.uid}" style="padding:6px 12px; font-size:12px; background:#fef2f2; color:#dc2626; border:1px solid #fecaca; border-radius:6px; cursor:pointer;">거부</button>
        </div>
      </div>
      <div class="cert-preview hidden" style="margin-top:10px; padding:10px; background:#f8fafc; border-radius:6px;"></div>
    </div>`).join('');

  container.querySelectorAll('.btn-view').forEach((btn) => {
    btn.addEventListener('click', () => viewCert((btn as HTMLElement).dataset.uid!));
  });
  container.querySelectorAll('.btn-approve').forEach((btn) => {
    btn.addEventListener('click', () => reviewHospital((btn as HTMLElement).dataset.uid!, 'approve'));
  });
  container.querySelectorAll('.btn-reject').forEach((btn) => {
    btn.addEventListener('click', () => reviewHospital((btn as HTMLElement).dataset.uid!, 'reject'));
  });
}

async function viewCert(uid: string) {
  const row = document.querySelector(`.hospital-row[data-uid="${uid}"]`)!;
  const preview = row.querySelector('.cert-preview') as HTMLElement;

  if (!preview.classList.contains('hidden') && preview.innerHTML) {
    preview.classList.add('hidden');
    return;
  }

  preview.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">로딩 중...</div>';
  preview.classList.remove('hidden');

  const res = await fetch(`/api/admin/hospital-cert?uid=${encodeURIComponent(uid)}`, { headers: adminHeaders() });
  if (!res.ok) { preview.innerHTML = '서류 로드 실패'; return; }
  const data = await res.json() as { url: string; contentType: string };

  if (data.contentType.startsWith('image/')) {
    preview.innerHTML = `<img src="${data.url}" style="max-width:100%; max-height:400px; border-radius:4px;" />`;
  } else if (data.contentType === 'application/pdf') {
    preview.innerHTML = `<iframe src="${data.url}" style="width:100%; height:500px; border:none;"></iframe>
      <a href="${data.url}" target="_blank" rel="noopener" style="display:block; margin-top:6px; font-size:12px; color:#2563eb;">📥 새 탭에서 열기</a>`;
  } else {
    preview.innerHTML = `<a href="${data.url}" target="_blank" rel="noopener">파일 다운로드</a>`;
  }
}

async function reviewHospital(uid: string, action: 'approve' | 'reject') {
  const label = action === 'approve' ? '승인' : '거부';
  if (!confirm(`정말 이 병원 계정을 ${label}하시겠습니까?`)) return;

  const res = await fetch('/api/admin/hospitals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify({ uid, action }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    alert(`처리 실패: ${err.error ?? res.statusText}`);
    return;
  }

  await loadHospitals();
}

// ─── 환자 검색 / 쿼터 관리 ────────────────────────────────

interface UserSearchResult {
  user: {
    uid: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
    lastSignInAt?: string;
    disabled: boolean;
    providers: string[];
    customClaims: Record<string, unknown>;
  };
  quota: { used: number; limit: number; baseLimit: number; bonus: number; remaining: number; weekKey: string };
  sessionCount: number;
}

let lastSearchedUid = '';

async function searchUser() {
  const email = (document.getElementById('search-email') as HTMLInputElement).value.trim().toLowerCase();
  const result = document.getElementById('search-result')!;
  if (!email) { result.innerHTML = ''; return; }

  result.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">검색 중...</div>';
  const res = await fetch(`/api/admin/user-search?email=${encodeURIComponent(email)}`, { headers: adminHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
    result.innerHTML = `<div style="color:#dc2626; font-size:13px; padding:10px; background:#fef2f2; border-radius:6px;">${err.error ?? '검색 실패'}</div>`;
    return;
  }
  const data = await res.json() as UserSearchResult;
  lastSearchedUid = data.user.uid;

  const role = (data.user.customClaims['role'] as string) ?? '환자';
  result.innerHTML = `
    <div style="border:1px solid var(--border); border-radius:10px; padding:14px; background:#f8fafc;">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
        <div>
          <div style="font-weight:600; font-size:14px;">${data.user.email}</div>
          <div style="font-size:11px; color:var(--text-muted); font-family:monospace;">${data.user.uid}</div>
        </div>
        <div style="font-size:11px; text-align:right; color:var(--text-muted);">
          역할: <strong>${role}</strong><br/>
          ${data.user.emailVerified ? '✅ 인증됨' : '❌ 미인증'}
          ${data.user.disabled ? ' · 🚫 비활성' : ''}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; padding:10px; background:white; border-radius:6px; font-size:13px; margin-bottom:10px;">
        <div><div style="color:var(--text-muted); font-size:11px;">이번주 사용</div><strong>${data.quota.used} / ${data.quota.limit}</strong></div>
        <div><div style="color:var(--text-muted); font-size:11px;">남은 횟수</div><strong>${data.quota.remaining}번</strong></div>
        <div><div style="color:var(--text-muted); font-size:11px;">추가 부여</div><strong>+${data.quota.bonus}</strong></div>
      </div>

      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <button class="btn-bonus" data-amount="1" style="padding:6px 12px; font-size:12px; background:#16a34a; color:white; border:none; border-radius:6px; cursor:pointer;">+1 부여</button>
        <button class="btn-bonus" data-amount="3" style="padding:6px 12px; font-size:12px; background:#16a34a; color:white; border:none; border-radius:6px; cursor:pointer;">+3 부여</button>
        <button class="btn-bonus" data-amount="0" style="padding:6px 12px; font-size:12px; background:#fef2f2; color:#dc2626; border:1px solid #fecaca; border-radius:6px; cursor:pointer;">초기화</button>
        <button id="btn-view-sessions" style="padding:6px 12px; font-size:12px; background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; border-radius:6px; cursor:pointer; margin-left:auto;">문진 ${data.sessionCount}건 보기</button>
      </div>

      <div id="user-sessions"></div>
    </div>`;

  result.querySelectorAll('.btn-bonus').forEach((btn) => {
    btn.addEventListener('click', () => grantQuota(Number((btn as HTMLElement).dataset.amount)));
  });
  document.getElementById('btn-view-sessions')!.addEventListener('click', viewUserSessions);
}

async function grantQuota(amount: number) {
  if (!lastSearchedUid) return;
  const res = await fetch('/api/admin/grant-quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify({ uid: lastSearchedUid, amount }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
    alert(err.error ?? '부여 실패');
    return;
  }
  alert(amount === 0 ? '이번 주 추가 쿼터가 초기화되었습니다.' : `이번 주 추가 +${amount} 부여되었습니다.`);
  await searchUser();
}

async function viewUserSessions() {
  const target = document.getElementById('user-sessions')!;
  if (target.innerHTML) { target.innerHTML = ''; return; }
  if (!lastSearchedUid) return;

  target.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">불러오는 중...</div>';
  const res = await fetch(`/api/admin/user-sessions?uid=${encodeURIComponent(lastSearchedUid)}`, { headers: adminHeaders() });
  if (!res.ok) { target.innerHTML = '조회 실패'; return; }

  const data = await res.json() as { sessions: Array<{
    id: string; date: string; createdAt: number; redFlagLevel: string; painScale: number;
    features: { chiefComplaint: string; onset: string };
  }> };

  if (data.sessions.length === 0) {
    target.innerHTML = '<div style="color:var(--text-muted); font-size:13px; padding:8px;">문진 기록이 없습니다.</div>';
    return;
  }

  target.innerHTML = `
    <div style="margin-top:10px; max-height:320px; overflow-y:auto; border-top:1px solid var(--border); padding-top:10px;">
      <table style="width:100%; font-size:12px;">
        <thead><tr style="color:var(--text-muted);"><th style="text-align:left;padding:4px;">날짜</th><th style="text-align:left;padding:4px;">주증상</th><th style="text-align:left;padding:4px;">통증</th><th style="text-align:left;padding:4px;">응급도</th></tr></thead>
        <tbody>${data.sessions.map((s) => `
          <tr>
            <td style="padding:4px;">${s.date}</td>
            <td style="padding:4px;">${(s.features?.chiefComplaint ?? '-').slice(0, 30)}</td>
            <td style="padding:4px;">${s.painScale}/10</td>
            <td style="padding:4px;"><span class="badge badge-${s.redFlagLevel}">${s.redFlagLevel}</span></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function showError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const loading = document.getElementById('loading')!;
  loading.innerHTML = `
    <div style="color:#dc2626; text-align:center; padding:24px;">
      <strong>데이터 로드 실패</strong><br/>
      <span style="font-size:13px; color:var(--text-muted);">${msg}</span><br/><br/>
      <button onclick="location.reload()" class="btn btn-ghost" style="font-size:13px;">다시 시도</button>
    </div>`;
  loading.classList.remove('hidden');
  console.error('[dashboard]', e);
}

init();
