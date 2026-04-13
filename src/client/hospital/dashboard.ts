import { initFirebase, getFirebaseAuth, logout } from '../../lib/firebase-client';
import { onAuthStateChanged } from 'firebase/auth';

async function init() {
  await initFirebase();

  onAuthStateChanged(getFirebaseAuth(), async (user) => {
    if (!user) { window.location.href = '/admin/login.html'; return; }

    const result = await user.getIdTokenResult(true);
    const role = result.claims['role'];

    if (role !== 'hospital') {
      window.location.href = '/hospital/pending.html';
      return;
    }

    const token = await user.getIdToken();
    const res = await fetch('/api/hospital/status', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json() as { name?: string };
      document.getElementById('hospital-name')!.textContent = data.name ?? '';
    }

    document.getElementById('loading')!.classList.add('hidden');
    document.getElementById('content')!.classList.remove('hidden');
  });

  document.getElementById('logout-btn')!.addEventListener('click', () => logout());
}

init();
