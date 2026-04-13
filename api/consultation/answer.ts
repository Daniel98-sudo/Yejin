import { getQuestion, TOTAL_STEPS } from '../../src/lib/opqrst';
import { evaluateRedFlag } from '../../src/lib/redflag';
import { verifyIdToken } from '../../src/lib/firebase-admin';
import type { AnswerRequest, AnswerResponse } from '../../src/types/index';

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: AnswerRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { answers, currentStep } = body;
  if (!Array.isArray(answers)) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const redFlag = evaluateRedFlag(answers);
  const nextStep = currentStep + 1;
  const complete = nextStep >= TOTAL_STEPS;
  const nextQuestion = complete ? null : getQuestion(nextStep);

  const response: AnswerResponse = { nextQuestion, redFlag, complete };
  return Response.json(response);
}
