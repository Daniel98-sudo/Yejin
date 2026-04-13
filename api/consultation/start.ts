import { getQuestion } from '../../src/lib/opqrst';
import { verifyIdToken } from '../../src/lib/firebase-admin';
import type { StartSessionResponse } from '../../src/types/index';

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const firstQuestion = getQuestion(0);

  if (!firstQuestion) {
    return Response.json({ error: 'Failed to load questions' }, { status: 500 });
  }

  const response: StartSessionResponse = { sessionId, firstQuestion };
  return Response.json(response);
}
