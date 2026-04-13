import { verifyIdToken } from '../../src/lib/firebase-admin';
import { evaluateRedFlag } from '../../src/lib/redflag';
import { hasDataConsent, saveSession } from '../../src/lib/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import type { Answer, ReportRequest, ReportResponse, ReportSection } from '../../src/types/index';

function buildPrompt(answers: Answer[]): string {
  const lines = answers.map((a) => {
    const value = Array.isArray(a.value) ? a.value.join(', ') : String(a.value);
    return `- ${a.questionText}: ${value}`;
  });
  return `다음은 환자의 문진 답변입니다:\n${lines.join('\n')}\n\n위 내용을 바탕으로 예진 보고서 JSON을 생성해주세요.`;
}

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: ReportRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { answers } = body;
  if (!Array.isArray(answers) || answers.length === 0) {
    return Response.json({ error: 'answers is required' }, { status: 400 });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const parseRes = await fetch(`${getBaseUrl(req)}/api/proxy/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({ prompt: buildPrompt(answers) }),
  });

  if (!parseRes.ok) return Response.json({ error: 'AI parsing failed' }, { status: 502 });

  const { result } = await parseRes.json() as {
    result: Omit<ReportSection, 'redFlag' | 'generatedAt' | 'algorithmVersion'>;
  };

  const redFlag = evaluateRedFlag(answers);
  const report: ReportSection = {
    ...result,
    redFlag,
    generatedAt: new Date().toISOString(),
    algorithmVersion: '2026.04',
  };

  // 동의한 사용자에 한해 익명 세션 데이터 Firestore 저장 (PII 미포함)
  const consent = await hasDataConsent(uid);
  if (consent) {
    await saveSession({
      uid,
      createdAt: Timestamp.now(),
      date: new Date().toISOString().split('T')[0], // 날짜만 저장
      answers: answers.map((a) => ({ questionId: a.questionId, value: a.value })),
      redFlagLevel: redFlag.level,
      painScale: Number(answers.find((a) => a.questionId === 'pain_scale')?.value ?? 0),
      algorithmVersion: '2026.04',
    });
  }

  return Response.json({ report } satisfies ReportResponse);
}

function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
