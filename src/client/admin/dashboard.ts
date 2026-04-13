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

    if (role !== 'superadmin' && role !== 'hospital') {
      window.location.href = '/admin/login.html';
      return;
    }

    adminToken = await user.getIdToken();

    document.getElementById('logout-btn')!.addEventListener('click', () => logout());
    document.getElementById('prev-btn')!.addEventListener('click', async () => {
      currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
      await loadSessions(currentOffset).catch(showError);
    });
    document.getElementById('next-btn')!.addEventListener('click', async () => {
      currentOffset += PAGE_SIZE;
      await loadSessions(currentOffset).catch(showError);
    });

    try {
      await Promise.all([loadStats(), loadSessions(0)]);
      document.getElementById('loading')!.classList.add('hidden');
      document.getElementById('dashboard')!.classList.remove('hidden');
    } catch (e) {
      showError(e);
    }
  });
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
