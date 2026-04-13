import { verifyIdToken } from '../../src/lib/firebase-admin';
import { evaluateRedFlag } from '../../src/lib/redflag';
import { saveSessionWithId, getSessionById } from '../../src/lib/firestore';
import { getWeeklyQuota, currentWeekKey } from '../../src/lib/quota';
import { getQuestion } from '../../src/lib/opqrst';
import { Timestamp } from 'firebase-admin/firestore';
import type {
  Answer, ReportRequest, ReportResponse, ReportSection, ChatSummary, RedFlagResult,
} from '../../src/types/index';
import type {
  SessionAnswer, SessionFeatures, ExtendedFeatures, ConversationTurn,
} from '../../src/lib/firestore';

const APP_VERSION = '2026.04';
const AI_MODEL = 'gemini-flash-latest';

// ── Adaptive (chat summary) 빌더 ──────────────────────────

function buildFromSummary(summary: ChatSummary, redFlag: RedFlagResult): {
  features: SessionFeatures;
  extendedFeatures: ExtendedFeatures;
  report: ReportSection;
} {
  const features: SessionFeatures = {
    chiefComplaint: summary.chiefComplaint ?? '',
    onset: summary.onset ?? '',
    painScale: Number(summary.painScale ?? 0),
    associatedSymptoms: summary.associatedSymptoms ?? [],
    previousHistory: summary.previousSimilar ?? '',
    medicationChanges: summary.medications ?? '',
  };

  const extended: ExtendedFeatures = {
    duration: summary.duration,
    character: summary.character,
    location: summary.location,
    radiation: summary.radiation,
    aggravating: summary.aggravating,
    relieving: summary.relieving,
    previousSimilar: summary.previousSimilar,
    chronicConditions: summary.chronicConditions,
    medications: summary.medications,
    narrativeSummary: summary.narrativeSummary,
  };

  const report: ReportSection = {
    chiefComplaint: features.chiefComplaint,
    onset: features.onset,
    painScale: features.painScale,
    associatedSymptoms: features.associatedSymptoms,
    previousHistory: features.previousHistory,
    medicationChanges: features.medicationChanges,
    questionsForDoctor: summary.questionsForDoctor ?? [],
    redFlag,
    generatedAt: new Date().toISOString(),
    algorithmVersion: APP_VERSION,
  };

  return { features, extendedFeatures: extended, report };
}

function turnsToAnswers(history: ConversationTurn[]): SessionAnswer[] {
  // assistant question N → 다음 user 답변을 페어링
  const pairs: SessionAnswer[] = [];
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].role === 'assistant' && history[i + 1].role === 'user') {
      pairs.push({
        questionId: `turn_${pairs.length + 1}`,
        questionText: history[i].content,
        type: 'text',
        value: history[i + 1].content,
      });
    }
  }
  return pairs;
}

// ── Legacy (정적 OPQRST) 빌더 ─────────────────────────────

function str(v: Answer['value'] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}
function num(v: Answer['value'] | undefined): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function arr(v: Answer['value'] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length) return [v];
  return [];
}

function legacyExtractFeatures(answers: Answer[]): SessionFeatures {
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

function legacyAnswers(answers: Answer[]): SessionAnswer[] {
  return answers.map((a) => {
    const q = Array.from({ length: 10 }, (_, i) => getQuestion(i)).find((qq) => qq?.id === a.questionId);
    return {
      questionId: a.questionId,
      questionText: a.questionText,
      type: q?.type ?? 'text',
      value: a.value,
    };
  });
}

// ── 메인 ──────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: ReportRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { sessionId, summary, history, answers } = body;
  if (!sessionId) return Response.json({ error: 'sessionId 필요' }, { status: 400 });

  // 중복 차감 방지
  const existing = await getSessionById(sessionId);
  if (existing?.report) {
    return Response.json({ report: existing.report as ReportSection } satisfies ReportResponse);
  }

  // 쿼터
  const quota = await getWeeklyQuota(uid);
  if (quota.remaining <= 0) {
    return Response.json({ error: '이번 주 문진 작성 횟수를 모두 사용했습니다.', quota }, { status: 429 });
  }

  let sessionAnswers: SessionAnswer[];
  let features: SessionFeatures;
  let extendedFeatures: ExtendedFeatures | undefined;
  let report: ReportSection;
  let redFlag: RedFlagResult;
  const conversationHistory = history;

  if (summary && Array.isArray(history)) {
    // ── 적응형 모드: chat AI 가 만든 summary + redFlag 를 그대로 사용
    redFlag = body.redFlag ?? evaluateRedFlag([]);
    if (!redFlag || !redFlag.level) {
      redFlag = { level: 'ROUTINE', reason: '추가 평가 없음', action: '필요 시 진료 받으세요.' };
    }
    const built = buildFromSummary(summary, redFlag);
    features = built.features;
    extendedFeatures = built.extendedFeatures;
    report = built.report;
    sessionAnswers = turnsToAnswers(history);
  } else if (Array.isArray(answers) && answers.length > 0) {
    // ── 레거시: 정적 OPQRST + Gemini 호출
    const authHeader = req.headers.get('Authorization') ?? '';
    const parseRes = await fetch(`${getBaseUrl(req)}/api/proxy/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ prompt: legacyPrompt(answers) }),
    });
    if (!parseRes.ok) return Response.json({ error: 'AI parsing failed' }, { status: 502 });

    const { result } = await parseRes.json() as {
      result: Omit<ReportSection, 'redFlag' | 'generatedAt' | 'algorithmVersion'>;
    };
    redFlag = evaluateRedFlag(answers);
    features = legacyExtractFeatures(answers);
    sessionAnswers = legacyAnswers(answers);
    report = {
      ...result,
      redFlag,
      generatedAt: new Date().toISOString(),
      algorithmVersion: APP_VERSION,
    };
  } else {
    return Response.json({ error: 'summary+history 또는 answers 가 필요합니다.' }, { status: 400 });
  }

  await saveSessionWithId(sessionId, {
    uid,
    createdAt: Timestamp.now(),
    date: new Date().toISOString().split('T')[0],
    weekKey: currentWeekKey(),
    answers: sessionAnswers,
    features,
    ...(extendedFeatures ? { extendedFeatures } : {}),
    ...(conversationHistory ? { conversationHistory } : {}),
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

function legacyPrompt(answers: Answer[]): string {
  const lines = answers.map((a) => {
    const v = Array.isArray(a.value) ? a.value.join(', ') : String(a.value);
    return `- ${a.questionText}: ${v}`;
  });
  return `다음은 환자의 문진 답변입니다:\n${lines.join('\n')}\n\n위 내용을 바탕으로 예진 보고서 JSON을 생성해주세요.`;
}

function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
