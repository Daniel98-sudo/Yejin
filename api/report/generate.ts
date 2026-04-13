import { verifyIdToken } from '../../src/lib/firebase-admin';
import { evaluateRedFlag } from '../../src/lib/redflag';
import { saveSessionWithId, getSessionById } from '../../src/lib/firestore';
import { getWeeklyQuota } from '../../src/lib/quota';
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

  const { sessionId, answers } = body;
  if (!sessionId || !Array.isArray(answers) || answers.length === 0) {
    return Response.json({ error: 'sessionId 및 answers 가 필요합니다.' }, { status: 400 });
  }

  // 이미 저장된 세션이면 리포트 재사용 (새로고침 시 중복 차감 방지)
  const existing = await getSessionById(sessionId);
  if (existing?.report) {
    return Response.json({ report: existing.report as ReportSection } satisfies ReportResponse);
  }

  // 이번 주 쿼터 체크 — 3회 초과 시 차단
  const quota = await getWeeklyQuota(uid);
  if (quota.remaining <= 0) {
    return Response.json({
      error: '이번 주 문진 작성 횟수(3회)를 모두 사용했습니다.',
      quota,
    }, { status: 429 });
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

  // 세션 + 리포트 저장 (병원 공유 대비 — §28조의2 필수 동의)
  await saveSessionWithId(sessionId, {
    uid,
    createdAt: Timestamp.now(),
    date: new Date().toISOString().split('T')[0],
    answers: answers.map((a) => ({ questionId: a.questionId, value: a.value })),
    redFlagLevel: redFlag.level,
    painScale: Number(answers.find((a) => a.questionId === 'pain_scale')?.value ?? 0),
    algorithmVersion: '2026.04',
    report,
  });

  return Response.json({ report } satisfies ReportResponse);
}

function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
