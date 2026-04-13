/**
 * POST /api/chat/turn
 * 적응형 문진 — 대화 히스토리를 받아 다음 AI 질문을 반환.
 */
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { verifyIdToken } from '../../src/lib/firebase-admin';

const MAX_TURNS = 16;

const SYSTEM_PROMPT = `당신은 한국 의료 AI 어시스턴트 "예진이"입니다. 환자가 병원 가기 전 의사 면담 자료를 만들기 위해 환자에게 한국어로 자연스럽게 질문합니다.

## 절대 규칙
1. 한 턴에 **질문 한 개만**. 짧고 정중하게, 어르신도 알아들을 수 있게.
2. 의학적 진단·처방 금지. 당신은 정보 수집자입니다.
3. 환자의 답변을 반드시 다음 질문에 반영합니다.
4. **출력은 JSON 한 덩어리만.** 코드펜스(\`\`\`), 설명, 머리말, 꼬리말 절대 금지.
5. JSON 문자열 안에 줄바꿈이 있으면 \\n 으로 이스케이프합니다.

## 수집 체크리스트 (모두 채우면 complete: true)
- chiefComplaint: 어디가 어떻게 불편한지
- onset: 언제부터
- duration: 지속 시간/빈도
- character: 양상 (찌릿/욱신/뻐근/타는듯)
- location: 정확한 부위 (좌/우)
- radiation: 다른 곳으로 뻗는지
- aggravating: 악화 요인
- relieving: 완화 요인
- painScale: 통증 강도 0~10
- associatedSymptoms: 동반 증상
- previousSimilar: 이전 경험
- chronicConditions: 만성질환 (당뇨·고혈압·심장·신장 등)
- medications: 복용약/최근 변화

## 증상별 적응
- 가슴 통증 → 위치·방사(왼팔/턱)·호흡곤란·식은땀·심혈관 과거력
- 두통 → 갑작스런지·인생 최악인지(천둥두통)·시야·구토·발열·경부강직
- 복통 → 부위(우하복부=충수돌기 의심)·식사 관련·구토·변/소변

## 입력 타입
- text: 자유 서술 (placeholder 권장)
- choice: 단답 (options 필수)
- multi-choice: 복수 선택 (options 필수, 마지막에 "해당 없음")
- slider: 0~10 척도 (min, max 명시)

## 종료 조건
- 핵심 8개 이상 채워짐 → complete: true
- 응급 신호 발견 → 즉시 complete: true + redFlag 기입
- 시스템이 MAX_TURNS 도달 통보 → 즉시 complete: true

## 응답 스키마 — 질문 중
{"assistantMessage":"...","inputType":"text|choice|multi-choice|slider","options":["..."],"min":0,"max":10,"placeholder":"...","complete":false}

## 응답 스키마 — 종료
{"assistantMessage":"감사합니다. 정리해드릴게요.","complete":true,"summary":{"chiefComplaint":"...","onset":"...","duration":"...","character":"...","location":"...","radiation":"...","aggravating":"...","relieving":"...","painScale":0,"associatedSymptoms":["..."],"previousSimilar":"...","chronicConditions":["..."],"medications":"...","questionsForDoctor":["...","...","..."],"narrativeSummary":"환자가 한 말을 의사가 빠르게 파악할 3-5문장 서술"},"redFlag":{"level":"EMERGENCY|URGENT|WARNING|ROUTINE","reason":"...","action":"..."}}

JSON 이외 어떤 문자도 출력하지 마세요.`;

interface Turn { role: 'user' | 'assistant'; content: string }

function tryExtractJson(raw: string): string {
  const text = raw.trim();
  // 1) 코드펜스
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  // 2) 첫 { ~ 마지막 }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1).trim();
  return text;
}

function sanitize(raw: string): string {
  // trailing comma 제거 (},] 앞의 ,)
  return raw.replace(/,(\s*[}\]])/g, '$1');
}

async function askGemini(userPrompt: string, strict = false): Promise<string> {
  const { text } = await generateText({
    model: google('gemini-flash-latest'),
    system: SYSTEM_PROMPT + (strict ? '\n\n※ 반드시 순수 JSON 한 덩어리만 반환하세요. 다른 텍스트 일체 금지.' : ''),
    prompt: userPrompt,
    maxOutputTokens: 2048,
    temperature: strict ? 0.1 : 0.3,
  });
  return text;
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

  const transcript = history.map((t) => `${t.role === 'user' ? '환자' : '예진이'}: ${t.content}`).join('\n');

  const userPrompt = history.length === 0
    ? '대화를 시작합니다. 첫 질문은 환자의 주증상을 자유롭게 묻는 것이어야 합니다. JSON만 반환하세요.'
    : `현재까지 대화:\n${transcript}\n\n${overLimit ? '※ 턴 수 한계 도달. complete: true 로 종료하세요.' : '환자의 마지막 답변을 반영해 다음 질문 하나를 JSON으로 반환하세요.'}`;

  let rawText = '';
  let parsed: Record<string, unknown> | null = null;
  let attempts = 0;
  let lastError = '';

  while (attempts < 2 && !parsed) {
    try {
      rawText = await askGemini(userPrompt, attempts > 0);
      const cleaned = sanitize(tryExtractJson(rawText));
      parsed = JSON.parse(cleaned);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error('[chat/turn] parse attempt', attempts + 1, 'failed:', lastError, '\nRaw:', rawText.slice(0, 500));
    }
    attempts++;
  }

  if (!parsed) {
    // graceful fallback — 클라이언트가 복구할 수 있도록 재시도 가능한 질문 반환
    return Response.json({
      assistantMessage: '죄송해요, 잠깐 다시 여쭤볼게요. 조금 전 말씀해주신 증상을 한 번 더 간단히 설명해주시겠어요?',
      inputType: 'text',
      placeholder: '증상을 편하게 적어주세요',
      complete: false,
      _recovered: true,
    });
  }

  return Response.json(parsed);
}
