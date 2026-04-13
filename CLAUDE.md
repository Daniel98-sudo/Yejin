# 예진이 — Pre-consultation AI App

운영주체: **주식회사 플로우메이트 (FlowMate Inc.)** · 대표 권도형 · 사업자번호 772-88-04021
배포: https://yejin.vercel.app · 저장소: github.com/Daniel98-sudo/Yejin

---

## 1. 프로젝트 개요

환자가 병원 가기 전 AI 와 문진하여, 의사에게 보여줄 **예진 보고서**를 자동 생성. 환자가 QR 로 보고서를 의료기관에 일시 공유 가능. 슈퍼관리자가 병원 계정 승인·환자 쿼터 관리.

| 항목 | 내용 |
|------|------|
| 대상 | 환자 B2C + 의료기관 B2B |
| 단계 | TypeScript 웹앱 MVP (React 미사용) |
| 최종 목표 | iOS / Android 모바일 앱 |

---

## 2. 기술 스택 (현재)

| 레이어 | 기술 |
|---|---|
| 언어 | TypeScript strict |
| 호스팅·서버리스 | Vercel Functions (Node, Web Fetch API 핸들러: `export async function POST/GET/DELETE`) |
| 클라이언트 번들 | esbuild (React 없음, 페이지마다 entry 1개) |
| AI | **Google Gemini Flash (latest)** via `@ai-sdk/google` |
| 인증 | **Firebase Auth** (Email/Password + Google OAuth) |
| DB | **Cloud Firestore** (Admin SDK 서버 사이드 전용) |
| 파일 저장 | **Firebase Storage** (사업자등록증 등 무거운 파일) |
| QR | `qrcode` npm 패키지 |

> ❌ 구버전 문서에 남아있던 **Claude / Supabase / NestJS** 는 현재 사용하지 **않음**.

---

## 3. Scout/Gemini 개발 파이프라인

전역 규칙은 `~/.claude/CLAUDE.md` 참조. 독립 함수·보일러플레이트·단일 파일 리팩터링은 `~/.claude/scripts/call-pipeline.sh` 로 위임해 토큰 절약.

---

## 4. 핵심 사용자 흐름

### 환자
1. `/` (랜딩) — 면책·연구목적 동의(모두 필수, §28조의2) → "시작하기" 클릭
2. `/login.html` — 이메일/비번 가입 또는 Google 로그인 → 이메일 인증 필수
3. `/consult.html` — 이번 주 남은 횟수 표시 (주 3회, KST 월 00 리셋, 슈퍼관리자가 추가 부여 가능)
4. `/chat.html` — OPQRST 7단계 채팅 문진
5. `/report.html` — Gemini 가 생성한 예진 보고서 + **QR 공유** (72h 동의 후)
6. `/mypage.html` — 계정 정보 · 비밀번호 변경 · 회원탈퇴

### 병원
1. `/admin/login.html` 하단 "🏥 병원 회원가입" → `/hospital/signup.html` (이메일·비번·병원명·사업자등록증 ≤5MB)
2. 가입 시 인증 메일 발송, Firestore `hospitals/{uid}` 에 `status: pending`
3. 슈퍼관리자 승인 후 Custom Claim `role: hospital` 부여
4. 로그인 → `role` 에 따라 `/hospital/dashboard.html` 또는 `/hospital/pending.html`
5. QR 스캔 시 `/share.html?t=` → `/api/share/claim` → 72h 열람권 획득 → 대시보드에 일자별 표시

### 슈퍼관리자
- 로그인 → `/admin/dashboard.html`
- 통계 · 응급도 분포 · 최근 세션
- **🏥 병원 승인 대기**: 사업자등록증 미리보기 + 승인/거부
- **👤 환자 검색**: 이메일로 검색 → 쿼터 +1/+3/초기화 부여, 문진 기록 조회

---

## 5. 디렉토리 맵

```
/api
  /auth/            (현재 미사용 — Firebase 클라이언트 SDK 직접)
  /account/delete   회원탈퇴 (모든 데이터 + Auth 계정 삭제)
  /admin/
    setup           최초 superadmin 부여 (ADMIN_SETUP_SECRET)
    stats           대시보드 집계
    sessions        최근 세션 페이지네이션
    hospitals       승인 대기 목록 + approve/reject
    hospital-cert   사업자등록증 서명 URL (1h)
    user-search     이메일로 유저 조회
    user-sessions   특정 유저의 문진 목록
    grant-quota     이번 주 쿼터 보너스 부여
  /consultation/
    start           세션 시작 (sessionId 발급)
    answer          답변 제출 + Red Flag 평가
    quota           이번 주 남은 횟수
  /hospital/
    signup          병원 등록 (Firestore + Storage)
    status          현재 유저의 hospitals/{uid} status
    reports         claim 한 활성 공유 리포트 (일자별 그룹)
  /share/
    create          환자가 QR 공유 토큰 생성 (30분 내 claim 필요)
    claim           병원이 token 받아 72h 열람권 획득
  /report/generate  Gemini 호출 → 풍부한 SessionRecord 저장
  /proxy/parse      Gemini 라우저 (인증 + JSON 코드펜스 제거)
  /config           공개 Firebase config (캐시 1h)
  /consent          데이터 활용 동의 기록

/src
  /lib/
    firebase-client.ts   클라이언트 Firebase 초기화 + signIn/signUp/logout/syncDataConsent
    firebase-admin.ts    Admin SDK + verifyIdToken
    admin-auth.ts        verifyAdminToken(req, requiredRole)
    firestore.ts         스키마 정의 + 모든 헬퍼 (sessions/users/hospitals/shareTokens)
    storage.ts           Storage 업로드/서명URL/삭제 헬퍼
    quota.ts             KST 주차 키 + 보너스 포함 쿼터 계산
    opqrst.ts            7단계 질문 정의
    redflag.ts           Red Flag 평가 룰
  /client/
    index.ts             랜딩 동의 화면
    login.ts             환자 로그인/가입 (탭)
    consult.ts           이번 주 쿼터 표시
    chat.ts              채팅 문진
    report.ts            보고서 + QR 생성
    share.ts             QR 스캔 랜딩 (병원 claim)
    mypage.ts            계정 관리
    legal.ts             정책 마크다운 렌더러
    auth-guard.ts        보호된 페이지 진입 검증
    /admin/login.ts      관리자/병원 로그인 (역할별 라우팅)
    /admin/dashboard.ts  슈퍼관리자 대시보드 (검색/병원승인/통계)
    /hospital/signup.ts  병원 가입 (파일 업로드)
    /hospital/pending.ts 승인 대기 화면
    /hospital/dashboard.ts  공유 리포트 일자별 표시 (PC 최적화 1080px)
  /types/index.ts        공통 타입

/public
  *.html                 페이지 셸 (esbuild 가 /js/*.js 로 번들)
  /css/styles.css        공통 스타일
  /js/footer.js          공통 푸터 (회사 정보 + 약관 링크) — 빌드 안 거침
  /legal/*.md            정책 원본 (마크다운, 자유 편집)
  /js/                   esbuild 산출물 (커밋 X — public/js 는 .gitignore)
```

> esbuild entry 추가 시 **반드시 `package.json` build 스크립트에 src 경로 등록.**

---

## 6. Firestore 스키마

### `users/{uid}`
```
{ dataConsent: bool, consentedAt: Timestamp,
  quotaBonus?: { weekKey: 'YYYY-W##', amount: number, grantedBy, grantedAt } }
```

### `sessions/{sessionId}` (분석·학습 친화 구조)
```
{
  uid, createdAt, date, weekKey,
  answers: [{ questionId, questionText, type, value }],   // 원본
  features: { chiefComplaint, onset, painScale, associatedSymptoms[],
              previousHistory, medicationChanges },       // 정규화 피처
  redFlagLevel, redFlagReason, redFlagAction,
  painScale,                                              // 인덱싱용 중복 저장
  algorithmVersion, aiModel, appVersion,
  report: ReportSection                                   // Gemini 출력 풀
}
```

### `hospitals/{uid}`
```
{ email, name, businessCertPath (Storage), businessCertContentType,
  status: 'pending'|'approved'|'rejected',
  createdAt, reviewedAt?, reviewedBy? }
```

### `shareTokens/{token}`
```
{ sessionId, patientUid, createdAt,
  claimedAt?, hospitalUid?, expiresAt? (claimedAt + 72h) }
```

### Firestore Rules
**현재 모두 `false`** — 클라이언트는 Firestore 직접 접근 안 함, 모두 API 라우트 경유.
바꿀 일 있으면 Console 에서 신중히.

---

## 7. Firebase Storage

- 버킷: `yejin-ca9d2.firebasestorage.app`
- 경로: `hospital-docs/{uid}/business-cert.{pdf|jpg|png}`
- 클라이언트 → API base64 → 서버 Admin SDK 업로드 (Storage Rules 우회)
- 조회: `getSignedUrl(path, 1h)` 로 임시 URL 발급

---

## 8. 인증 / 권한 (Firebase Custom Claims)

- `role: 'superadmin'` — 모든 admin API 접근
- `role: 'hospital'` — 병원 대시보드 + claim API
- `role` 없음 — 일반 환자

부여 방법:
- Superadmin: `scripts/create-super-admin.ts` (ADMIN_PW 환경변수)
- Hospital: 슈퍼관리자가 `/api/admin/hospitals` POST `{action:'approve'}` 호출

`verifyAdminToken(req, requiredRole)` 가 모든 admin/hospital API 의 가드.
환자 페이지 가드는 클라이언트 `auth-guard.ts` (`requireAuth()`).

---

## 9. 쿼터 시스템

- 환자당 **주 3회** 리포트 생성 (`WEEKLY_LIMIT = 3` in `quota.ts`)
- 주 시작 = **KST 월요일 00:00**, weekKey = `YYYY-W##`
- 차감 시점: `/api/report/generate` 가 Firestore 에 `sessions/{id}` 저장 시
- 새로고침 등 중복 호출은 `existing.report` 체크로 무차감
- 슈퍼관리자가 `setQuotaBonus(uid, weekKey, amount)` 로 일주일 한정 추가 부여 (덮어쓰기, 자동 다음 주 0)
- 쿼리: composite index 회피 위해 `where uid ==` 만 + JS 필터

---

## 10. 환경변수 (Vercel)

| 키 | 용도 |
|---|---|
| `GEMINI_API_KEY` 또는 `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini 호출 |
| `FIREBASE_PROJECT_ID` | yejin-ca9d2 |
| `FIREBASE_CLIENT_EMAIL` | 서비스 계정 이메일 |
| `FIREBASE_PRIVATE_KEY` | 서비스 계정 키 (\n 이스케이프 자동 복원) |
| `FIREBASE_API_KEY` 외 5개 | 클라이언트 공개 config (api/config 가 반환) |
| `ADMIN_SETUP_SECRET` | 최초 superadmin 부여 보호 |

`.firebase-service-account.json` 은 로컬 스크립트(create-super-admin 등)용, .gitignore 등록됨.

---

## 11. 빌드·배포

```bash
npm run build        # esbuild 로 src/client/* → public/js/*
npm run typecheck    # tsc --noEmit
git push             # Vercel 자동 빌드
vercel deploy --prod
vercel alias set <new-url> yejin.vercel.app   # 도메인 alias
```

**중요**: 새 클라이언트 ts 파일을 만들면 `package.json > build > esbuild` 의 entry 목록에 반드시 추가.

---

## 12. 법적 문서 / 회사 정보

- 정책 원본: `public/legal/privacy.md`, `public/legal/terms.md` (자유 편집)
- 뷰어: `/legal.html?doc=privacy|terms`
- 공통 푸터: `public/js/footer.js` — 모든 페이지에 `<script src="/js/footer.js"></script>` 로 자동 주입
- **개보법 §23**(민감정보) + **§28조의2**(가명처리 연구) 기반 동의 모델
- 회사 정보: 주식회사 플로우메이트 / 권도형 / 772-88-04021 / 부산광역시 사하구 감천로 49, 7층 353호

---

## 13. Red Flag 등급

| 등급 | 앱 동작 | 트리거 |
|---|---|---|
| EMERGENCY | 빨간 풀스크린 + 119 버튼 | 천둥두통, AMI 패턴, 통증 ≥9 |
| URGENT | 주황 경고 + 진료 권고 | 통증 ≥8, 충수염 의심 |
| WARNING | 노란 안내 | 3주 이상 기침 등 |
| ROUTINE | 보고서 바로 생성 | 일반 |

평가 로직: `src/lib/redflag.ts` (키워드 + painScale + 동반증상 룰).

---

## 14. 면책 문구 (필수)

**랜딩**: "예진이는 의료기기가 아니며, 의학적 진단을 제공하지 않습니다. 응급 상황에서는 즉시 119에 연락하거나 응급실을 방문하세요."

**보고서 하단**: "이 문서는 AI가 생성한 면담 준비 메모입니다. 의학적 진단이 아니며 의사의 판단을 대체하지 않습니다. 알고리즘 버전: 2026.04"

수정 시 법무 검토 필수.

---

## 15. 개발 원칙

- TypeScript strict, `any` 금지
- 모든 AI 호출은 `/api/proxy/parse` 경유 (키 보호)
- 클라이언트는 Firestore/Storage 직접 호출 안 함 — API 경유만
- Vercel Functions 는 named export (`POST`/`GET`/`DELETE`)
- 새 기능은 필요한 것만 — 미래용 추상화 금지
- 의료/법적 문구 변경 시 별도 승인

---

## 16. 알려진 제약 / TODO

- 관측성(로그·에러 트래킹) 전 라우트 미적용 — 추후 일괄
- Storage Rules 미설정 — 서버 Admin SDK 우회로만 사용
- 클라이언트 직접 업로드 미지원 — 서버 base64 경유
- 가명처리 절차 자동화 미구현 — 현재 UID 그대로 저장 (배치 마이그레이션 필요)
- 카카오/Apple 로그인 미연결 (Google + Email 만)
- 모바일 앱 (React Native) 미시작
