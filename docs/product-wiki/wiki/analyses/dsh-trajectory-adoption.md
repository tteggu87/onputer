---
title: "DSH trajectory의 onputer 적용 평가"
type: analysis
status: draft
created: 2026-09-06
updated: 2026-09-06
sources:
  - "[[source-2026-09-06-dsh-trajectory-review]]"
  - "[[source-2026-09-06-product-proposals]]"
tags:
  - onputer
  - dsh
  - architecture
---

# DSH trajectory의 onputer 적용 평가

**실행 기록·출처·현재 상태를 한 로그에서 파생하는 원칙은 적극 참고할 가치가 있다. 다만 DSH 전체 모델 trajectory와 플러그인 런타임을 들여오는 것은 현재 onputer의 역할에 비해 과하다.**

이 평가는 [[source-2026-09-06-dsh-trajectory-review|최신 코드 검토 근거]]에 기반한 적용 제안이다. 현재 onputer에 trajectory를 구현했다는 의미는 아니다. 기준은 DSH `d347e70` / `0.1.3-alpha.1`과 onputer v0.2.0이다. 원격 최신성·로컬 설치 버전·수행한 검사 범위는 출처 페이지에 기록했다.

## DSH의 구조

Trajectory를 화면 하나로 이해하면 핵심을 놓친다. 세 층이 분리되어 있다.

| 층 | 역할 | onputer에서의 가치 |
|---|---|---|
| Session event log | type·seq·time·data로 발생 사실을 누적. callId·출처 seq·turn/step 관계 유지 | 작업·도구·프로세스·파일 변경의 공통 기록 |
| Projection | 로그에서 상태를 계산. asOfSeq로 반영 범위를 표시하고 캐시를 다시 생성 | 작업 목록·최종 결과·재개 문맥이 서로 다른 사실을 갖지 않게 함 |
| Trajectory UI | 같은 로그의 순수 화면 투영. 입력·출력·출처·시간·관계를 탐색 | 일반 사용자 결과 보기와 개발자 상세 진단을 같은 근거로 제공 |

DSH는 모델 루프까지 소유하므로 모델에 보낸 문맥과 반환 stream도 기록한다. onputer는 외부 채팅에서 호출하는 MCP 서버다. **onputer가 관측한 도구 실행과 파일·프로세스 사실을 정확히 기록하는 범위**로 적용해야 한다.

| 기록 항목 | onputer의 관측 가능성 |
|---|---|
| 도구 입력·반환 결과·오류·서버 소요 시간 | 직접 관측 가능 |
| 명령 시작·종료·stdout/stderr·파일 패치와 해시 | 해당 실행·파일 기능에서 직접 관측 가능 |
| 제공한 AGENTS.md·스킬의 경로·내용 버전 | 제공한 사실은 기록 가능; AI가 이해·준수했다는 증거는 아님 |
| 외부 채팅 전체·시스템 프롬프트·모델 내부 추론 | 현재 MCP 서버 경계에서 확보할 수 없음 |
| 모델 전체 토큰 사용량·TTFT | 서버 도구 실행 시간과 다름; 데이터가 없으면 표시하지 않음 |

## 혼동하면 안 되는 네 가지

**1. 메모리 append와 저장 완료는 다르다.** DSH Session의 append는 데이터를 검증·복사·동결해 메모리에 반영한다. JSONL backend의 append/fsync와 session flush가 별도의 영속성 경계다. onputer도 성공 응답의 내구성 의미를 명확히 해야 한다.

**2. 이력 재개는 작업 프로세스 부활이 아니다.** DSH의 jobs-local과 persistent terminal도 프로세스 종료 시 사라진다. 로그에서 이전 상태를 복구해도 명령이 실제로 완료됐는지 알 수 없는 경우가 남는다. DSH의 TOOL_NOT_STARTED와 TOOL_OUTCOME_UNKNOWN 구분이 좋은 참고다.

**3. 화면 재생과 명령 재실행은 다르다.** UI 재구성은 이벤트를 다시 읽는 일이다. DSH llm-replay는 기록된 모델 stream으로 실제 테스트 agent를 구동하므로 도구 효과가 다시 발생할 수 있다. onputer의 이력 보기에서 과거 명령을 자동 재실행해서는 안 된다.

**4. Session fork는 파일 격리가 아니다.** DSH는 완료 turn 경계의 prefix와 parentSession 등을 상속하며 부모 cwd를 전달한다. 파일의 A/B 실험을 안전하게 하려면 별도 작업공간·스냅샷·Git worktree 같은 실제 상태 분리가 필요하다.

## 다른 구조의 흡수 우선순위

| 후보 | 가치 | onputer에 맞춘 적용 |
|---|---|---|
| 정확한 job lifecycle | 높음, 작은 개선부터 가능 | 중단 요청 stopping과 실제 종료를 분리. 작업 owner를 붙이고 실제 settlement 전까지 실행 용량을 점유 |
| 출력 spill·artifact 보관 | 높음 | 큰 stdout/stderr를 버리기 전에 파일로 저장. 채팅에는 제한된 미리보기와 읽기 참조만 반환 |
| 결과 시점 diff·metadata | 높음 | 호출 당시 before/after 해시·diff·결과 파일 참조를 기록. 나중에 현재 파일을 읽어 과거 화면인 것처럼 보여주지 않음 |
| 지침 digest·출처 추적 | 높음 | 경로·내용 hash·적용 범위와 제공 기록으로 변경·중복을 판단. 구조화된 파일 접근에 붙이고 임의 shell 해석은 피함 |
| 기록 기반 회귀 검사 | 높음 | 입력·반환 결과·실제 파일 효과를 함께 고정. 격리된 fixture에서만 효과를 재실행 |
| 작업공간 권한을 따르는 이력 검색 | 중간 | 먼저 목록과 정확한 이벤트 읽기를 제공. 규모에 따라 인덱스를 검토하고 다른 연결의 기록은 노출하지 않음 |
| 소유자별 지속 터미널 | 조건부 | REPL·디버거·연속 셸 상태가 실제로 필요할 때 추가. Windows backend와 정리·동시 입력 제어 비용이 큼 |
| sandbox와 승인 정책의 분리 | 중간 | UI preset은 두 설정을 묶어 보여줄 뿐 실제 집행은 별도로 담당. 이름만 안전 모드인 기능을 피함 |

onputer의 현재 `stop_process`는 중단을 요청하면서 바로 `stopped`로 표시한다. DSH의 stopping→settled 구분은 이 상태 표현을 개선하는 데 직접적인 참고가 된다. 이번 검토에서는 런타임 코드를 수정하지 않았다.

DSH spill-policy도 이미 잘린 데이터를 복원하지 못한다. onputer는 버퍼 상한을 넘기기 **전**, 출력 수집 단계에서 보관해야 한다. 지침 symlink를 외부 경로까지 따라가는 DSH 동작은 onputer의 현재 경로 제한을 완화하는 이유로 삼지 않는다.

## 그대로 가져오지 않을 부분

Cordis 전체 plugin lifecycle·hot mounting·자기수정, 모델 request-header와 surface compaction 전체, subagent 실행 엔진은 초기 도입 대상에서 제외하는 것이 적절하다는 판단이다. 이들은 모델 실행기를 구성하는 DSH의 목표에 맞춰져 있다.

DSH는 검토 시점 packages/*/* 기준 255개 패키지 manifest를 가진다. 숫자만으로 품질이나 속도를 판단할 수는 없지만, onputer의 작은 실행 도구 서버에 그 확장 체계를 그대로 가져와야 한다는 근거도 없다.

영속성의 단일 작성자·순서·손상 탐지 원칙은 중요하다. 그러나 첫 버전부터 기본 zstd 인코딩, 이미 존재하는 DSH v0/v1 역사 이관, 범용 projection registry와 SQLite 검색까지 재현할 필요는 없다. 현재 도입할 이벤트 형식에는 버전과 알 수 없는 필수 이벤트의 처리 규칙을 정의해야 한다.

## onputer용 최소 설계 제안

HTTP는 stateless로 유지해도 작업 기록은 저장할 수 있다. 먼저 안정적인 workspace/연결 owner/task/operation 식별자를 정한다. MCP 요청 ID는 연결 간 재사용·재시도 문맥이 있으므로 전역 작업 ID와 동일시하지 않는다.

초기 구성은 작업별 `events.jsonl`, 큰 출력·diff·필요한 스냅샷을 담는 `artifacts`, 로그에서 다시 만드는 작업 목록·결과 요약 정도로 시작할 수 있다. **기존 제품 위키는 Markdown 전용으로 유지한다. JSONL은 별도 실행 기록에 대한 제안이다.**

다음 이벤트 이름은 DSH 원본이 아닌 onputer용 초안이다.

| 이벤트 계열 | 기록할 사실 |
|---|---|
| task/opened·closed | 작업 제목·workspace·시작 및 종료 판단 |
| tool/requested·completed | operation ID·도구 입력 참조·반환 결과·오류 |
| process/started·exited | process ID·호출 operation·실제 종료 코드·출력 참조 |
| file/changed | 경로·변경 전후 hash·결과 시점 diff·복원 자료 참조 |
| instructions/provided | 경로·scope·digest·실제로 전달한 버전 |

`run_command`의 도구 응답은 프로세스를 시작했다는 결과다. **tool/completed가 process/exited의 성공을 뜻하지 않는다.** 이 구분이 작업 목록과 최종 결과의 신뢰성을 좌우한다.

추가로 재시도 중복 방지 키, 연결별 이력 접근, 저장 시점 민감정보 마스킹, 보존 기간, 복원용 기준 내용이 필요하다. 인증 토큰 자체는 기록하지 않는다. 로그만으로 정확히 한 번 실행이나 외부 효과 rollback이 성립하지 않으며, 불확실한 효과는 unknown으로 남긴다.

## 권장 순서와 후속 검증

기존 [[roadmap|제품 로드맵]]을 바꾸는 확정 결정은 아니다. 이력·결과 보기의 내부 기반으로 다음 순서를 제안한다.

1. 이벤트 저장과 정확한 job lifecycle, 큰 출력 보관.
2. 같은 기록에서 작업 목록·최종 결과 영수증·상세 이력 화면 생성.
3. 지침 digest·권한을 따르는 이력 검색·제한된 재개 문맥.
4. 실제 요구가 확인된 뒤 persistent terminal·branch/worktree 연계 검토.

후속 인수 검사는 재시작 후 기록 존재, 호출 완료와 프로세스 완료 구분, 취소 요청과 실제 종료 구분, 큰 출력 보관, 손상 꼬리와 확정 영역 손상 구분, 캐시 재생성, 외부 효과의 자동 재실행 금지, 연결별 이력 접근 구분을 포함해야 한다.

현재 수행한 것은 [[source-2026-09-06-dsh-trajectory-review#수행한 검사|최신 DSH helper 검사 5개]]와 코드·문서 검토다. 전체 DSH·Windows·실모델·onputer 통합 성능 검증은 아니다. 실제 적용 효과는 아직 미검증이다.

## 제품 경험으로 연결

이 구조는 [[feature-candidates|작업 이력·검증·복원 후보]]와 [[user-experiences|새 채팅 재개·근거가 붙은 결과 화면]]의 공통 기반으로 잘 맞는다. 개발자에게는 상세 trajectory, 일반 사용자에게는 작업 요약을 제공하되 둘이 같은 이벤트를 읽게 한다.

핵심 결론은 **기록 구조는 흡수하고, 모델 실행기 전체는 들여오지 않는 방향**이다. 구현 착수·범위 확정은 [[open-decisions|미결정 사항]]과 함께 별도로 다룬다.
