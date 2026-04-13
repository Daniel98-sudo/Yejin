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
  const data = await res.json() as { businessCertBase64: string };
  const src = data.businessCertBase64;

  if (src.startsWith('data:image/')) {
    preview.innerHTML = `<img src="${src}" style="max-width:100%; max-height:400px; border-radius:4px;" />`;
  } else if (src.startsWith('data:application/pdf')) {
    preview.innerHTML = `<iframe src="${src}" style="width:100%; height:500px; border:none;"></iframe>
      <a href="${src}" download="business-cert.pdf" style="display:block; margin-top:6px; font-size:12px; color:#2563eb;">📥 PDF 다운로드</a>`;
  } else {
    preview.innerHTML = `<a href="${src}" download>파일 다운로드</a>`;
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
