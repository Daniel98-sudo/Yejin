import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { verifyIdToken } from '../../src/lib/firebase-admin';

const SYSTEM_PROMPT = `당신은 예진이입니다. 환자의 문진 답변을 분석하여 의사에게 보여줄 예진 보고서를 JSON으로 생성합니다.
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트, 마크다운 코드펜스, 설명은 포함하지 마세요.
{
  "chiefComplaint": "주 증상 한 줄 요약",
  "onset": "발병 시점",
  "painScale": 0,
  "associatedSymptoms": ["동반 증상 목록"],
  "previousHistory": "과거력 요약",
  "medicationChanges": "최근 약물 변화",
  "questionsForDoctor": ["의사에게 질문 1", "질문 2", "질문 3"]
}`;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1).trim();
  return text.trim();
}

export async function POST(req: Request): Promise<Response> {
  const uid = await verifyIdToken(req);
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { prompt: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== 'string') {
    return Response.json({ error: 'prompt is required' }, { status: 400 });
  }

  const { text } = await generateText({
    model: google('gemini-flash-latest'),
    system: SYSTEM_PROMPT,
    prompt: body.prompt,
    maxOutputTokens: 2048,
  });

  const cleaned = extractJson(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return Response.json({ error: 'AI response parsing failed', raw: text }, { status: 502 });
  }

  return Response.json({ result: parsed });
}
