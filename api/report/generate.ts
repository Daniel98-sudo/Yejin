import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
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
import type { QAnswer } from '../../src/lib/questionnaire';

const APP_VERSION = '2026.04';
const AI_MODEL = 'gemini-flash-latest';

// ── Questionnaire 모드 (정형 문진 + 단 1회 AI 분석) ────────

const ANALYSIS_SYSTEM_PROMPT = `당신은 한국 의료 AI 분석가입니다. 환자가 작성한 정형 문진(TSV)을 받아 의사가 즉시 활용할 수 있는 예진 보고서를 생성합니다.

원칙:
- 의학적 진단·처방 금지. 정보 정리·구조화·위험신호 탐지만 수행.
- 환자가 적은 자유텍스트(특히 chief_complaint_detail, medications, 기타 항목)를 의학적 맥락으로 정돈.
- 응급 가능성을 적극적으로 평가 (천둥두통/뇌졸중 신호/심근경색 동반증상/의식변화/혈변 등).
- "questionsForDoctor" 는 환자가 적은 질문 + 의학적으로 추가 확인이 필요한 핵심 질문을 합쳐 3~5개.
- "narrativeSummary" 는 의사가 5초 안에 환자 상태를 파악할 수 있게 시작-양상-동반증상-위험인자 흐름으로 3~5문장.
- "differentialHints" 는 감별진단 키워드 2~4개. 의사 참고용이지 진단 아님을 명시 톤.

출력은 아래 JSON 한 덩어리만. 다른 텍스트·코드펜스 금지.

{
  "chiefComplaint": "한 줄 요약 (예: '우측 측두부 박동성 두통, 어제 저녁부터 6/10')",
  "onset": "발병 시점 자연어",
  "painScale": 0,
  "associatedSymptoms": ["..."],
  "previousHistory": "관련 과거력·만성질환 요약",
  "medicationChanges": "복용약/최근 변화 정돈",
  "questionsForDoctor": ["...", "..."],
  "narrativeSummary": "3~5문장 진료 요약",
  "differentialHints": ["감별 키워드 2~4개"],
  "redFlag": {
    "level": "EMERGENCY|URGENT|WARNING|ROUTINE",
    "reason": "한 줄 사유",
    "action": "환자가 즉시 취할 행동"
  }
}`;

function tryExtractJson(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1).trim();
  return text;
}

interface AnalysisResult {
  chiefComplaint: string;
  onset: string;
  painScale: number;
  associatedSymptoms: string[];
  previousHistory: string;
  medicationChanges: string;
  questionsForDoctor: string[];
  narrativeSummary?: string;
  differentialHints?: string[];
  redFlag: { level: string; reason: string; action: string };
}

async function analyzeQuestionnaire(tsv: string, flowKey: string): Promise<AnalysisResult> {
  const userPrompt =
    `[증상 카테고리: ${flowKey}]\n\n[정형 문진 응답 (TSV)]\n${tsv}\n\n` +
    `위 데이터를 분석하여 위 스키마의 JSON 한 덩어리만 출력하세요.`;

  let attempts = 0;
  let lastErr: unknown = null;
  while (attempts < 2) {
    try {
      const { text } = await generateText({
        model: google(AI_MODEL),
        system: ANALYSIS_SYSTEM_PROMPT + (attempts > 0 ? '\n\n※ 반드시 순수 JSON 한 덩어리만 출력. 코드펜스·설명 금지.' : ''),
        prompt: userPrompt,
        maxOutputTokens: 2048,
        temperature: attempts > 0 ? 0.1 : 0.3,
      });
      const cleaned = tryExtractJson(text).replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(cleaned) as AnalysisResult;
    } catch (e) {
      lastErr = e;
      console.error('[analyzeQuestionnaire] attempt', attempts + 1, 'failed:', e instanceof Error ? e.message : e);
    }
    attempts++;
  }
  throw lastErr ?? new Error('Gemini 분석 실패');
}

function fallbackAnalysisFromAnswers(qAnswers: QAnswer[]): AnalysisResult {
  const byId: Record<string, QAnswer> = Object.fromEntries(qAnswers.map((a) => [a.questionId, a]));
  const v = (id: string): string => {
    const a = byId[id]; if (!a) return '';
    if (Array.isArray(a.rawValue)) return a.rawValue.join(', ');
    return String(a.rawValue ?? '');
  };
  const arr = (id: string): string[] => {
    const a = byId[id]; if (!a) return [];
    return Array.isArray(a.rawValue) ? a.rawValue.filter((x) => x !== '해당 없음') : [];
  };
  const pain = Number(byId['pain_scale']?.rawValue ?? 0) || 0;

  const detail = v('chief_complaint_detail');
  const category = v('chief_complaint_category');
  const onset = v('onset');

  const associated = [
    ...arr('h_associated'), ...arr('c_associated'), ...arr('a_associated'),
    ...arr('r_associated'), ...arr('d_associated'), ...arr('f_associated'),
    ...arr('m_associated'), ...arr('sk_systemic'), ...arr('u_associated'),
  ].filter(Boolean);

  const chronic = arr('chronic_conditions').join(', ');
  const meds = v('medications');
  const userQuestion = v('questions_for_doctor');

  const questions: string[] = [];
  if (userQuestion) questions.push(userQuestion);
  questions.push('현재 증상의 가장 가능성 있는 원인은 무엇인가요?');
  questions.push('어떤 추가 검사가 필요할까요?');

  // 간단 redFlag — 이미 클라이언트에서 즉시 응급 룰 평가하지만 서버에서도 보수적으로
  let level: AnalysisResult['redFlag']['level'] = 'ROUTINE';
  let reason = '추가 평가 없음';
  let action = '필요 시 진료를 받으세요.';
  if (pain >= 9) { level = 'URGENT'; reason = '극심한 통증 (NRS 9 이상)'; action = '빠른 시일 내 진료를 받으세요.'; }
  if (associated.some((s) => ['한쪽 팔다리 힘 빠짐', '말이 어눌해짐', '의식이 흐려짐', '식은땀'].includes(s))) {
    level = 'EMERGENCY'; reason = '응급 동반 증상 감지'; action = '즉시 119 또는 응급실로 가세요.';
  }

  return {
    chiefComplaint: detail || category || '증상 정보',
    onset: onset || '미상',
    painScale: pain,
    associatedSymptoms: associated,
    previousHistory: chronic || '특이 사항 없음',
    medicationChanges: meds || '없음',
    questionsForDoctor: questions,
    narrativeSummary: `[자동 요약] ${category}. ${detail}. 발병: ${onset}. 통증 ${pain}/10. 동반: ${associated.join(', ') || '없음'}. (AI 분석 일시 실패로 raw 데이터 기반 요약)`,
    differentialHints: [],
    redFlag: { level, reason, action },
  };
}

function questionnaireToSessionAnswers(answers: QAnswer[]): SessionAnswer[] {
  return answers.map((a) => ({
    questionId: a.questionId,
    questionText: a.questionText,
    type: a.inputType,
    value: a.rawValue,
  }));
}

function buildFromAnalysis(result: AnalysisResult, qAnswers: QAnswer[]): {
  features: SessionFeatures;
  extendedFeatures: ExtendedFeatures;
  redFlag: RedFlagResult;
  report: ReportSection;
} {
  const byId = Object.fromEntries(qAnswers.map((a) => [a.questionId, a.rawValue]));
  const arr = (v: unknown): string[] => Array.isArray(v) ? v as string[] : v ? [String(v)] : [];

  const features: SessionFeatures = {
    chiefComplaint: result.chiefComplaint,
    onset: result.onset,
    painScale: Number(result.painScale ?? 0),
    associatedSymptoms: result.associatedSymptoms ?? [],
    previousHistory: result.previousHistory,
    medicationChanges: result.medicationChanges,
  };

  const extendedFeatures: ExtendedFeatures = {
    duration: typeof byId['duration_pattern'] === 'string' ? byId['duration_pattern'] as string : undefined,
    character: typeof byId['h_character'] === 'string' ? byId['h_character'] as string :
               typeof byId['c_character'] === 'string' ? byId['c_character'] as string : undefined,
    location: typeof byId['h_location'] === 'string' ? byId['h_location'] as string :
              typeof byId['c_location'] === 'string' ? byId['c_location'] as string :
              typeof byId['a_location'] === 'string' ? byId['a_location'] as string :
              typeof byId['m_location'] === 'string' ? byId['m_location'] as string : undefined,
    radiation: arr(byId['c_radiation']).join(', ') || undefined,
    aggravating: arr(byId['g_aggravating']).join(', ') || undefined,
    relieving: arr(byId['g_relieving']).join(', ') || undefined,
    chronicConditions: arr(byId['chronic_conditions']),
    medications: typeof byId['medications'] === 'string' ? byId['medications'] as string : undefined,
    narrativeSummary: result.narrativeSummary,
  };

  const redFlag: RedFlagResult = {
    level: (result.redFlag?.level as RedFlagResult['level']) ?? 'ROUTINE',
    reason: result.redFlag?.reason ?? '추가 평가 없음',
    action: result.redFlag?.action ?? '필요 시 진료 받으세요.',
  };

  const report: ReportSection = {
    chiefComplaint: features.chiefComplaint,
    onset: features.onset,
    painScale: features.painScale,
    associatedSymptoms: features.associatedSymptoms,
    previousHistory: features.previousHistory,
    medicationChanges: features.medicationChanges,
    questionsForDoctor: result.questionsForDoctor ?? [],
    redFlag,
    generatedAt: new Date().toISOString(),
    algorithmVersion: APP_VERSION,
  };

  return { features, extendedFeatures, redFlag, report };
}

// ── Adaptive (chat summary) 빌더 (이전 모드 호환) ─────────

function buildFromSummary(summary: ChatSummary, redFlag: RedFlagResult): {
  features: SessionFeatures; extendedFeatures: ExtendedFeatures; report: ReportSection;
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
    duration: summary.duration, character: summary.character, location: summary.location,
    radiation: summary.radiation, aggravating: summary.aggravating, relieving: summary.relieving,
    previousSimilar: summary.previousSimilar, chronicConditions: summary.chronicConditions,
    medications: summary.medications, narrativeSummary: summary.narrativeSummary,
  };
  const report: ReportSection = {
    chiefComplaint: features.chiefComplaint, onset: features.onset, painScale: features.painScale,
    associatedSymptoms: features.associatedSymptoms, previousHistory: features.previousHistory,
    medicationChanges: features.medicationChanges,
    questionsForDoctor: summary.questionsForDoctor ?? [],
    redFlag, generatedAt: new Date().toISOString(), algorithmVersion: APP_VERSION,
  };
  return { features, extendedFeatures: extended, report };
}

function turnsToAnswers(history: ConversationTurn[]): SessionAnswer[] {
  const pairs: SessionAnswer[] = [];
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].role === 'assistant' && history[i + 1].role === 'user') {
      pairs.push({
        questionId: `turn_${pairs.length + 1}`, questionText: history[i].content,
        type: 'text', value: history[i + 1].content,
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
function arrLegacy(v: Answer['value'] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length) return [v];
  return [];
}
function legacyExtractFeatures(answers: Answer[]): SessionFeatures {
  const byId = Object.fromEntries(answers.map((a) => [a.questionId, a.value]));
  return {
    chiefComplaint: str(byId['chief_complaint']), onset: str(byId['onset']),
    painScale: num(byId['pain_scale']), associatedSymptoms: arrLegacy(byId['associated_symptoms']),
    previousHistory: str(byId['previous_history']), medicationChanges: str(byId['medication_changes']),
  };
}
function legacyAnswers(answers: Answer[]): SessionAnswer[] {
  return answers.map((a) => {
    const q = Array.from({ length: 10 }, (_, i) => getQuestion(i)).find((qq) => qq?.id === a.questionId);
    return { questionId: a.questionId, questionText: a.questionText, type: q?.type ?? 'text', value: a.value };
  });
}
function legacyPrompt(answers: Answer[]): string {
  const lines = answers.map((a) => {
    const v = Array.isArray(a.value) ? a.value.join(', ') : String(a.value);
    return `- ${a.questionText}: ${v}`;
  });
  return `다음은 환자의 문진 답변입니다:\n${lines.join('\n')}\n\n위 내용을 바탕으로 예진 보고서 JSON을 생성해주세요.`;
}

// ── 메인 ──────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: ReportRequest & {
    mode?: 'questionnaire';
    tsv?: string;
    flowKey?: string;
    questionnaireAnswers?: QAnswer[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { sessionId } = body;
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
  let conversationHistory: ConversationTurn[] | undefined;

  if (body.mode === 'questionnaire' && body.tsv && body.flowKey && body.questionnaireAnswers) {
    // ── 정형 문진 모드: Gemini 분석 → 실패 시 raw answers 로 fallback
    let analysis: AnalysisResult;
    try {
      analysis = await analyzeQuestionnaire(body.tsv, body.flowKey);
    } catch (e) {
      console.error('[generate] analysis failed, using fallback:', e instanceof Error ? e.message : e);
      analysis = fallbackAnalysisFromAnswers(body.questionnaireAnswers);
    }
    const built = buildFromAnalysis(analysis, body.questionnaireAnswers);
    features = built.features;
    extendedFeatures = built.extendedFeatures;
    redFlag = built.redFlag;
    report = built.report;
    sessionAnswers = questionnaireToSessionAnswers(body.questionnaireAnswers);
  } else if (body.summary && Array.isArray(body.history)) {
    // ── 적응형 챗 모드 (이전)
    redFlag = body.redFlag ?? { level: 'ROUTINE', reason: '추가 평가 없음', action: '필요 시 진료 받으세요.' };
    const built = buildFromSummary(body.summary, redFlag);
    features = built.features;
    extendedFeatures = built.extendedFeatures;
    report = built.report;
    sessionAnswers = turnsToAnswers(body.history);
    conversationHistory = body.history;
  } else if (Array.isArray(body.answers) && body.answers.length > 0) {
    // ── 레거시 정적 OPQRST
    const authHeader = req.headers.get('Authorization') ?? '';
    const parseRes = await fetch(`${getBaseUrl(req)}/api/proxy/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ prompt: legacyPrompt(body.answers) }),
    });
    if (!parseRes.ok) return Response.json({ error: 'AI parsing failed' }, { status: 502 });
    const { result } = await parseRes.json() as {
      result: Omit<ReportSection, 'redFlag' | 'generatedAt' | 'algorithmVersion'>;
    };
    redFlag = evaluateRedFlag(body.answers);
    features = legacyExtractFeatures(body.answers);
    sessionAnswers = legacyAnswers(body.answers);
    report = { ...result, redFlag, generatedAt: new Date().toISOString(), algorithmVersion: APP_VERSION };
  } else {
    return Response.json({ error: 'questionnaire / summary+history / answers 중 하나 필요' }, { status: 400 });
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

function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
