# DSH trajectory와 onputer 적용 검토 근거

2026-09-06에 수행한 코드·문서 검토와 제한된 실행 검사 기록이다. 전체 DSH 저장소를 수집한 원문이 아니라 아래 범위에 대한 분석 입력 메모다. 관측 사실과 onputer 적용 제안을 구분한다.

## 1. 위치와 최신성

개발 폴더와 Git 원격 메타데이터를 탐색했지만 기존 clone을 찾지 못했다. 설치된 실행 파일은 /opt/homebrew/bin/dsh이며 npm 설치 패키지는 @deepseek-ai/dsh 0.1.0-rc.7이었다. 사용자 인증 파일과 세션 내용은 열지 않았다.
공식 저장소 https://github.com/deepseek-ai/deepseek-harness.git 을 ~/Documents/Playground/deepseek-harness에 새로 clone했다. master의 HEAD는 d347e703908d0406b7a7ef80e3a0e594d86b2215, 커밋 시각은 2026-09-04T17:16:23+08:00, packages와 CLI 버전은 0.1.3-alpha.1이다. git ls-remote origin HEAD와 일치함을 다시 확인했다. 설치된 dsh와 설정은 변경하지 않았고 분석 clone의 작업 트리는 깨끗했다.
비교 대상은 onputer v0.2.0의 실행 구조(src/http.ts, src/tools.ts, src/jobs.ts, src/files.ts, src/patch.ts, src/context.ts)와 앞서 제안한 제품 로드맵이다. DSH에는 packages/*/*/package.json 기준 255개 패키지 manifest가 있지만 onputer가 그 전체를 필요로 한다는 뜻은 아니다.

## 2. Trajectory의 세 층

DSH의 dsh-session은 append-only 이벤트 로그를 제공한다. 이벤트는 type, 단조 증가 seq, time, data를 가지며 메시지 표면 이벤트에는 surfaceOp와 일부 sourceEventSeqs가 붙는다. tool/call의 callId가 tool/result와 연결된다. turn/start/end와 step/start/end가 작업 흐름을 구분한다. 입력 payload는 snapshotJsonValue로 복사·검증하고 deepFreeze하여 호출자의 이후 수정과 분리한다.
모델 메시지 이력은 deriveMessages로 로그에서 파생된다. user/message는 직접 사용자 입력뿐 아니라 지침·스킬 등 출처를 갖는 주입 문맥도 표현한다. request/header와 request/context, assistant/message 및 실패 attempt 등은 DSH가 모델 루프를 소유하기 때문에 기록할 수 있는 정보다.
projection은 순수 init/apply/view 계산으로 로그에서 현재 상태를 만들고 asOfSeq로 어느 이벤트까지 반영했는지 나타낸다. stateVersion이 캐시 재사용 여부에 관여한다. 캐시는 로그보다 뒤에 저장되도록 durability checkpoint를 거치며, 캐시 불일치 시 로그를 다시 접어서 상태를 만든다.
Trajectory UI는 별도 진실 저장소가 아닌 순수 소비자다. User/Assistant/Tool/Subtool 및 문맥 기록, turn/step 구분, 입력·출력·소요 시간·출처, 제공된 토큰 정보와 첨부를 보여준다. 최신 꼬리부터 열고 이전 기록을 페이지로 가져오며 가상화로 보이는 행만 렌더링한다.
근거: https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/types.ts ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/index.ts ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-projection/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-projection-cache/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-trajectory/README.md

## 3. 저장·복구·재생의 정확한 의미

현재 JSONL 저장 형식은 v2이며 기본 물리 인코딩은 zstd다. compression=none이면 일반 UTF-8 JSONL을 쓴다. header, seq 연속성, 단일 작성자 lease, append 후 fsync, 불완전한 꼬리와 확정 영역의 손상 구분, 이전 형식을 덮어쓰지 않는 인접 버전 마이그레이션을 가진다. Session.append 자체는 메모리 반영이고 durable flush 경계를 별도로 이해해야 한다.
interruptedTurnClosers는 도구 요청만 있고 시작 기록이 없으면 TOOL_NOT_STARTED, 시작했지만 결과가 남지 않았으면 TOOL_OUTCOME_UNKNOWN으로 기록한다. 성공을 추측하지 않고 누락된 tool/result, step/end, interrupted turn/end를 이어 붙인다. 이미 균형 잡힌 로그에는 추가 복구 이벤트가 없다.
세션 fork는 완료된 turn 경계의 이력 prefix를 상속하며 parentSession 등을 기록한다. 코드상 부모 cwd를 그대로 전달하므로 파일 복사·Git worktree 격리와 같은 의미가 아니다.
화면 재구성과 테스트 재실행은 다르다. UI는 로그를 투영하지만 llm-replay는 기록된 모델 stream을 테스트의 모델 응답으로 제공하고 실제 agent 실행을 구동한다. 테스트 도구 동작이 다시 발생할 수 있으므로 격리된 테스트 작업공간과 효과 검증이 중요하다.
jobs-local과 terminal은 프로세스 로컬이다. 지속되는 세션 로그가 있다고 실제 작업·터미널 프로세스가 재시작 뒤 살아나는 것은 아니다.
근거: https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/repair.ts ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/index.ts ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/jobs/jobs-local/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/terminal/terminal/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/test-support/llm-replay/README.md

## 4. 다른 구조의 흡수 후보

높은 가치: (a) jobs-local의 owner별 접근·running/stopping/settled 구분·실제 done 이후 용량 해제, (b) spill-policy의 미리보기와 전체 결과 보관 분리, (c) tool-fs의 결과 시점 diff를 tool/result meta로 보존, (d) agent-instructions의 경로·내용 digest·출처 기반 중복 억제와 변경 안내, (e) session-snapshot의 기록 입력·기대 출력·실제 작업공간 효과를 묶는 회귀 검사.
중간 가치: session-query의 작업공간 권한을 따르는 이력 검색과 정확한 이벤트 읽기; 소유자별 persistent terminal; sandbox와 승인 정책을 따로 두고 UI preset만 묶는 구조.
주의: spill-policy는 이미 provider나 도구에서 잘라 버린 출력을 복구하지 못한다. onputer는 stdout/stderr를 버퍼에서 자르기 전에 별도 보관해야 한다. DSH 지침 탐색은 structured fs 접근에 반응하고 임의 shell 탐색을 해석하지 않는다. 지침 symlink를 외부로 따라가는 DSH 동작은 onputer의 현재 경로 차단 정책과 다르므로 그대로 가져오지 않는다.
보류: Cordis 전체 플러그인 런타임, hot mounting·자기수정, 모델 request-header/surface compaction 전체, subagent 실행 엔진, 초기부터 zstd·과거 v0/v1 migration·SQLite 검색 체계를 모두 들여오기. 전체 복제 대신 현재 문제를 해결하는 작은 설계 원칙을 채택한다.
근거: https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/jobs/jobs-local/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/spill/spill-policy/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/fs/tool-fs/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/context/agent-instructions/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/tool-session-query/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/interaction/permission-presets/README.md ; https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/test-support/session-snapshot/README.md

## 5. onputer에 맞춘 적용 경계와 최소 구조 제안

DSH는 모델+실행 루프를 소유하지만 onputer는 외부 채팅에서 호출하는 MCP 서버다. onputer가 확실히 기록할 수 있는 것은 자신에게 도착한 도구 입력, 반환 결과, 파일 변경, 명령·프로세스 상태, 제공한 지침·스킬이다. 외부 모델의 시스템 프롬프트·내부 추론·전체 채팅·전체 토큰 사용량·TTFT를 알고 있다고 표시해서는 안 된다. 지침을 제공했다는 기록은 모델이 읽고 따랐다는 증거와 다르다.
HTTP를 stateless로 유지해도 저장소에 작업 기록을 남길 수 있다. 안정적인 작업공간 ID, 연결 소유자, task_id, operation_id, event seq를 먼저 정하고 MCP 요청 ID를 전역 작업 ID로 착각하지 않는다. 인증 토큰 자체를 이벤트에 저장하지 않는다.
제안한 이벤트 계열은 task/opened, tool/requested, tool/completed, process/started, process/exited, file/changed, instructions/provided, task/closed다. 이는 DSH 원본 스키마가 아니라 onputer용 초안이다. run_command 호출 응답은 프로세스 시작 응답이므로 process/exited의 성공과 별개로 기록해야 한다.
초기 구조는 작업별 events.jsonl, 큰 출력·diff·필요한 스냅샷을 보관하는 artifacts, 로그에서 다시 만들 수 있는 작업 목록·요약 projection 정도가 적절하다는 판단이다. 위키는 기존 Markdown 전용을 유지하며 JSONL은 별도 실행 기록의 제안이다.
로그가 있어도 정확히 한 번 실행이나 rollback을 보장하지 않는다. 재시작 후 결과가 불확실한 외부 효과는 unknown으로 남기고 자동 재실행하지 않는다. 재시도 중복 방지 키, 파일 복원용 기준 내용, 접근 권한·저장 단계 마스킹·보존 기간은 별도 설계가 필요하다.

## 6. 수행한 제한된 실행 검사

최신 소스의 repair.ts, seq-ranges.ts, util/values를 기존 로컬 tsx loader로 직접 import하여 synthetic 데이터로 다섯 검사를 실행했다. 코드 clone과 설치된 dsh 설정을 변경하지 않았다.
PASS 1: 요청됐지만 시작하지 않은 도구는 TOOL_NOT_STARTED.
PASS 2: 시작 후 결과가 없는 도구는 TOOL_OUTCOME_UNKNOWN이며 sourceEventSeqs로 시작 이벤트에 연결.
PASS 3: 복구된 로그에 다시 적용하면 복구 이벤트가 추가되지 않음.
PASS 4: 출처 seq 구간 인코딩/디코딩 왕복과 역순 구간 거부.
PASS 5: payload 복사가 원본 변경과 분리되고 NaN 같은 손실 JSON을 거부.
이 검사는 순수 helper 동작의 제한된 스모크 테스트다. DSH 전체 테스트, 영속 저장소의 fsync/장애 주입, UI 브라우저 테스트, 실모델 호출, Windows 실기 DSH 테스트, onputer 통합의 성능·효과 검증은 수행하지 않았다. 저장·UI 보장은 소스·문서·테스트 코드를 검토한 관측이며 전체 실행 검증으로 표현하지 않는다.

## 7. 종합 판단과 순서 제안

trajectory의 실행 기록·출처·상태 투영 원칙은 onputer와 궁합이 좋다. 앞서 제안한 이력·작업 영수증·새 채팅 재개의 공통 기반이 된다. 그러나 전체 모델 trajectory나 DSH 런타임을 복제하는 것은 onputer의 현재 역할과 규모에 비해 과하다.
우선 작은 이벤트 기록과 정확한 job lifecycle·큰 출력 보관을 만들고, 그 기록에서 작업 목록·최종 결과 영수증·상세 이력 화면을 투영한다. 이후 지침 digest·이력 검색·제한된 재개 문맥을 연결하고, persistent terminal과 branch/worktree 연계는 별도 요구가 확인될 때 검토한다.
후속 인수 검사는 요청 응답 후 재시작해도 기록 존재, 도구 호출 완료와 프로세스 완료 구분, 취소 요청과 실제 종료 구분, 큰 출력 보관, 손상된 마지막 이벤트 복구와 확정 영역 손상 거부, 캐시 재생성, 외부 효과 자동 재실행 금지, 연결별 이력 접근 구분을 포함해야 한다.
이 결론은 적용 제안이며 onputer의 해당 기능을 구현하거나 우열을 실사용 비교로 입증한 것이 아니다.
