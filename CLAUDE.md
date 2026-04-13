# 예진이 — Pre-consultation AI App
## Claude 개발 가이드 (현재 단계: TypeScript 웹앱 MVP)

---

## 1. 프로젝트 개요

환자가 병원 가기 전 AI와 문진하여, 의사에게 보여줄 **예진 보고서**를 자동 생성하는 앱.

| 항목 | 내용 |
|------|------|
| 목표 출시 | 2026년 7월 (3개월) |
| 대상 | 일반 환자 B2C |
| 현재 단계 | TypeScript 웹앱 (Vercel) — React 미사용 |
| 최종 목표 | iOS / Android 모바일 앱 |
| MVP 핵심 | 예진 보고서 생성 하나에 집중 |

---

## 2. 현재 단계 기술 스택

> React는 현 단계에서 사용하지 않는다. 순수 TypeScript 기반 웹앱으로 시작.

| 레이어 | 기술 | 비고 |
|--------|------|------|
| 언어 | TypeScript (strict mode) | React 없음 |
| 플랫폼 | Vercel | 배포 + Serverless Functions |
| 백엔드 API | Vercel Functions (TypeScript) | NestJS는 모바일 전환 시점에 도입 |
| AI | Claude API (`claude-sonnet-4-5-20251001`) | 문진 엔진 + 보고서 생성 |
| 인증 | Supabase Auth + JWT | OAuth, 소셜 로그인 |
| DB | Supabase PostgreSQL | 의료 데이터는 국내 서버 원칙 — 현단계 예외 허용, 모바일 전환 시 NCP 이전 |
| 환경변수 | Vercel env + `.env.local` | API 키 절대 코드에 미포함 |

---

## 3. 팀워크 시스템 — Scout/Gemini 파이프라인

전역 규칙 (`~/.claude/CLAUDE.md`) 참조. 요약:
- **Scout (Llama 4)** 가 초안 → **Gemini Flash (latest)** 가 검증/개선 → Claude가 파일 반영
- 독립 함수·보일러플레이트·단일 파일 리팩터링은 파이프라인으로 위임
- 호출: `echo '{"task":"...","context":"...","instructions":"..."}' | bash ~/.claude/scripts/call-pipeline.sh`

---

## 4. 보안 필수 원칙

> 의료 데이터를 다루는 앱. 아래 항목은 타협 불가.

- **API 키**: Claude, Clova, Supabase 키는 절대 클라이언트 코드에 포함하지 않는다. Vercel Functions 경유만 허용.
- **토큰 저장**: JWT는 httpOnly 쿠키 또는 서버 세션에만 저장. localStorage 금지.
- **전송**: HTTPS only. HTTP 요청 차단.
- **주민번호**: 생년월일 6자리만 추출. 전체 저장 금지.
- **OCR 이미지**: 처리 후 24시간 내 삭제 스케줄러 필수.
- **접근 로그**: API 호출 일시·사용자 ID 전량 기록.

---

## 5. 필수 면책 문구

> 법무 검토 완료 버전. 임의 수정 금지. 변경 시 의뢰인 승인 필요.

**앱 최초 실행 동의 화면**
```
예진이는 의료기기가 아니며, 의학적 진단을 제공하지 않습니다.
본 앱이 제공하는 정보는 의사와의 면담을 준비하기 위한 참고 자료이며,
의사의 진단·처방을 대체하지 않습니다.
응급 상황에서는 즉시 119에 연락하거나 응급실을 방문하세요.
```

**모든 보고서 하단 (필수)**
```
이 문서는 AI가 생성한 면담 준비 메모입니다.
의학적 진단이 아니며 의사의 판단을 대체하지 않습니다.
알고리즘 버전: 2026.04
```

---

## 6. MVP 핵심 기능 범위

현 단계에서 구현하는 것:
- 채팅 문진 (OPQRST 알고리즘)
- Red Flag 감지 및 경고 (EMERGENCY / URGENT / WARNING / ROUTINE)
- 예진 보고서 생성

현 단계에서 구현하지 않는 것 (v2):
- 건보공단 마이헬스웨이 연동
- 음성 문진 (STT)
- 처방전 / 약봉지 OCR
- 병원 예약 연동
- PDF 공유
- 모바일 앱 (React Native)

---

## 7. 문진 엔진 — OPQRST 알고리즘

| 단계 | 질문 유형 | 입력 방식 |
|------|-----------|-----------|
| 1. 주증상 | 자유입력 | 텍스트 |
| 2. 발병 시점 | 4지선다 | 버튼 |
| 3. 통증 강도 | 수치 슬라이더 | 0~10 |
| 4. 동반 증상 | 복수 선택 | 체크박스 |
| 5. 이전 경험 | 4지선다 | 버튼 |
| 6. 최근 약물 변화 | 4지선다 | 버튼 |
| 7. 의사에게 질문 | 텍스트 3개 | 자유 입력 |

### Red Flag 등급
| 등급 | 앱 동작 | 예시 |
|------|---------|------|
| EMERGENCY | 빨간 풀스크린 + 119 버튼 | 천둥두통, AMI 패턴 |
| URGENT | 주황 경고 배너 | 충수염 의심 |
| WARNING | 노란 안내 카드 | 3주 이상 기침 |
| ROUTINE | 보고서 바로 생성 | 일반 감기 |

---

## 8. API 구조 (Vercel Functions)

```
/api/auth/         — 인증 (Supabase Auth 연동)
/api/consultation/ — 예진 세션 생성·답변 제출·Red Flag 평가
/api/report/       — 보고서 생성·조회
/api/proxy/parse   — Claude API 프록시 (키 보호)
```

---

## 9. 개발 원칙

- TypeScript strict mode 필수. `any` 금지.
- Vercel Functions는 요청당 단일 책임 원칙 준수.
- Claude API 호출은 반드시 `/api/proxy/parse` 경유. 클라이언트 직접 호출 금지.
- 컴포넌트/모듈은 현재 필요한 것만 만든다. 미래를 위한 추상화 금지.
- 보고서 생성 로직 변경 시 면책 문구 표시 여부 반드시 확인.
