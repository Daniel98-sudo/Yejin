import { verifyIdToken } from '../../src/lib/firebase-admin';
import { evaluateRedFlag } from '../../src/lib/redflag';
import { saveSessionWithId, getSessionById } from '../../src/lib/firestore';
import { getWeeklyQuota, currentWeekKey } from '../../src/lib/quota';
import { getQuestion } from '../../src/lib/opqrst';
import { Timestamp } from 'firebase-admin/firestore';
import type { Answer, ReportRequest, ReportResponse, ReportSection } from '../../src/types/index';
import type { SessionAnswer, SessionFeatures } from '../../src/lib/firestore';

const APP_VERSION = '2026.04';
const AI_MODEL = 'gemini-flash-latest';

function buildPrompt(answers: Answer[]): string {
  const lines = answers.map((a) => {
    const value = Array.isArray(a.value) ? a.value.join(', ') : String(a.value);
    return `- ${a.questionText}: ${value}`;
  });
  return `다음은 환자의 문진 답변입니다:\n${lines.join('\n')}\n\n위 내용을 바탕으로 예진 보고서 JSON을 생성해주세요.`;
}

function normalizeAnswer(a: Answer): SessionAnswer {
  // opqrst 질문지에서 step 검색하여 type 보강
  const q = Array.from({ length: 10 }, (_, i) => getQuestion(i)).find((qq) => qq?.id === a.questionId);
  return {
    questionId: a.questionId,
    questionText: a.questionText,
    type: q?.type ?? 'text',
    value: a.value,
  };
}

function str(v: string | number | string[] | undefined): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
function num(v: string | number | string[] | undefined): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function arr(v: string | number | string[] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length) return [v];
  return [];
}

function extractFeatures(answers: Answer[]): SessionFeatures {
  const byId = Object.fromEntries(answers.map((a) => [a.questionId, a.value]));
  return {
    chiefComplaint: str(byId['chief_complaint']),
    onset: str(byId['onset']),
    painScale: num(byId['pain_scale']),
    associatedSymptoms: arr(byId['associated_symptoms']),
    previousHistory: str(byId['previous_history']),
    medicationChanges: str(byId['medication_changes']),
  };
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

  // 중복 차감 방지
  const existing = await getSessionById(sessionId);
  if (existing?.report) {
    return Response.json({ report: existing.report as ReportSection } satisfies ReportResponse);
  }

  // 쿼터 체크
  const quota = await getWeeklyQuota(uid);
  if (quota.remaining <= 0) {
    return Response.json({
      error: '이번 주 문진 작성 횟수를 모두 사용했습니다.',
      quota,
    }, { status: 429 });
  }

  // Gemini 호출
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
  const features = extractFeatures(answers);
  const report: ReportSection = {
    ...result,
    redFlag,
    generatedAt: new Date().toISOString(),
    algorithmVersion: APP_VERSION,
  };

  await saveSessionWithId(sessionId, {
    uid,
    createdAt: Timestamp.now(),
    date: new Date().toISOString().split('T')[0],
    weekKey: currentWeekKey(),
    answers: answers.map(normalizeAnswer),
    features,
    redFlagLevel: redFlag.level,
    redFlagReason: redFlag.reason,
    redFlagAction: redFlag.action,
    painScale: features.painScale,
    algorithmVersion: APP_VERSION,
    aiModel: AI_MODEL,
    appVersion: APP_VERSION,
    report,
  });

  return Response.json({ report } satisfies ReportResponse);
}

function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
