import { getAdminAuth } from './firebase-admin';

export type AdminRole = 'superadmin' | 'hospital';

/**
 * 요청의 Bearer 토큰을 검증하고 admin role을 반환.
 * 권한 없으면 null.
 */
export async function verifyAdminToken(
  req: Request,
  requiredRole?: AdminRole
): Promise<{ uid: string; role: AdminRole } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const idToken = authHeader.slice(7);
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const role = decoded.role as AdminRole | undefined;

    if (!role || (requiredRole && role !== requiredRole)) return null;

    return { uid: decoded.uid, role };
  } catch {
    return null;
  }
}
