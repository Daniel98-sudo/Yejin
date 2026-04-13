/**
 * POST /api/chat/turn
 * 적응형 문진 — 대화 히스토리를 받아 다음 AI 질문을 반환.
 * Gemini 가 OPQRST 체크리스트를 내부적으로 추적하며 1턴 1질문 진행.
 *
 * 요청:
 *   { sessionId, history: [{role:'user'|'assistant', content}], turnCount }
 * 응답:
 *   { assistantMessage, inputType, options?, min?, max?, placeholder?, complete, summary?, redFlag? }
 */
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { verifyIdToken } from '../../src/lib/firebase-admin';

const MAX_TURNS = 16; // 안전 상한

const SYSTEM_PROMPT = `당신은 한국 의료 AI 어시스턴트 "예진이"입니다. 환자가 병원 가기 전 의사 면담 자료를 만들기 위해 환자에게 한국어로 자연스럽게 질문합니다.

## 절대 규칙
1. 한 턴에 **질문 한 개만** 합니다. 짧고 정중하게, 어르신도 알아들을 수 있게.
2. 의학적 진단·처방·치료 권유 금지. 당신은 정보 수집자입니다.
3. 환자의 답변을 **반드시** 다음 질문에 반영합니다(이전에 한 말 인용 OK).
4. 출력은 **JSON 한 덩어리**만, 어떤 다른 텍스트(설명, 코드펜스)도 금지.

## 수집 체크리스트 (모두 채우면 complete: true)
- chiefComplaint: 어디가 어떻게 불편한지 (자유텍스트)
- onset: 언제부터 (텍스트 or 선택)
- duration: 지속 시간/빈도 (텍스트)
- character: 양상 (찌릿/욱신/뻐근/타는듯 등)
- location: 정확한 부위 (좌/우, 위치)
- radiation: 다른 곳으로 뻗는지 (예/아니오 등)
- aggravating: 악화 요인 (자세, 음식, 활동 등)
- relieving: 완화 요인
- painScale: 통증 강도 (slider 0~10)
- associatedSymptoms: 동반 증상 (multi-choice)
- previousSimilar: 이전에 같은 증상 경험
- chronicConditions: 만성질환 (당뇨, 고혈압, 심장질환 등 — multi-choice)
- medications: 복용약/최근 변화 (텍스트)
- redFlagsCheck: 위험 신호 (의식변화, 갑작스런 시야장애, 흉통+호흡곤란, 토혈/혈변, 발열+경부강직 등) — 증상에 따라 적절히 탐색

## 적응 규칙
- 환자가 가슴 통증을 말하면 → 부위, 방사(왼팔/턱), 호흡곤란, 식은땀, 평소 심혈관 질환 등을 깊이 캐기.
- 환자가 두통을 말하면 → 갑작스런 발생인지, 인생 최악인지(천둥두통), 시야 이상, 구토, 발열·경부강직 탐색.
- 환자가 복통을 말하면 → 부위(우하복부=충수돌기), 식사 관련, 구토, 발열, 변·소변 변화.
- 답변이 모호하면 더 구체적으로 다시 묻기 (1회).
- 위험 신호 감지 시 즉시 complete: true + redFlag 표시 (응급실 안내).

## 입력 타입 가이드
- "text": 자유 서술 필요할 때 (placeholder 권장)
- "choice": 명확한 단답 (예/아니오 포함)
- "multi-choice": 복수 선택 가능 (반드시 마지막 옵션에 "해당 없음" 포함)
- "slider": 0~10 척도 (통증 강도 등)

## 종료 조건
- 체크리스트의 핵심 8개 이상 채워짐 → complete: true
- 응급 신호 발견 → 즉시 complete: true
- 턴 수가 너무 많아짐 → complete: true (시스템이 알려줌)

## 응답 JSON 스키마
질문 중:
{
  "assistantMessage": "다음 질문 텍스트",
  "inputType": "text|choice|multi-choice|slider",
  "options": ["..."] (choice/multi-choice 일 때만),
  "min": 0, "max": 10 (slider 일 때만),
  "placeholder": "..." (text 일 때 선택),
  "complete": false
}

종료 시:
{
  "assistantMessage": "감사합니다. 정리해드릴게요.",
  "complete": true,
  "summary": {
    "chiefComplaint": "...",
    "onset": "...",
    "duration": "...",
    "character": "...",
    "location": "...",
    "radiation": "...",
    "aggravating": "...",
    "relieving": "...",
    "painScale": 0,
    "associatedSymptoms": ["..."],
    "previousSimilar": "...",
    "chronicConditions": ["..."],
    "medications": "...",
    "questionsForDoctor": ["환자가 의사에게 꼭 물어볼 것 3개"],
    "narrativeSummary": "환자가 한 모든 말을 의사가 빠르게 파악하도록 정돈한 3-5문장 서술 요약"
  },
  "redFlag": {
    "level": "EMERGENCY|URGENT|WARNING|ROUTINE",
    "reason": "한 줄 사유",
    "action": "환자가 즉시 취해야 할 행동"
  }
}`;

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (m) return m[1].trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i !== -1 && j > i) return s.slice(i, j + 1).trim();
  return s.trim();
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { sessionId?: string; history?: Turn[]; turnCount?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const history = body.history ?? [];
  const turnCount = body.turnCount ?? 0;
  const overLimit = turnCount >= MAX_TURNS;

  // 대화를 평문으로 합쳐 prompt 에 넣음
  const transcript = history.map((t) => `${t.role === 'user' ? '환자' : '예진이'}: ${t.content}`).join('\n');

  const userPrompt = history.length === 0
    ? '대화를 시작합니다. 첫 질문은 환자의 주증상을 자유롭게 묻는 것이어야 합니다. JSON으로만 응답하세요.'
    : `현재까지 대화:\n${transcript}\n\n${overLimit ? '※ 턴 수가 한계에 도달했습니다. 지금까지 정보로 complete: true 를 반환하세요.' : '환자의 마지막 답변을 반영해 다음 질문 1개를 JSON으로만 응답하세요.'}`;

  const { text } = await generateText({
    model: google('gemini-flash-latest'),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    maxOutputTokens: 1024,
    temperature: 0.4,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return Response.json({ error: 'AI 응답 파싱 실패', raw: text }, { status: 502 });
  }

  return Response.json(parsed);
}
