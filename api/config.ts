/** 클라이언트에 노출해도 안전한 Firebase 공개 설정만 반환 */
export async function GET(_req: Request): Promise<Response> {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };

  // 필수 키 누락 시 에러
  if (!config.apiKey || !config.projectId) {
    return Response.json({ error: 'Firebase config not set' }, { status: 500 });
  }

  return Response.json(config, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
