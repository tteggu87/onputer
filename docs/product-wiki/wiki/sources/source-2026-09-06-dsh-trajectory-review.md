---
title: "DSH trajectory 코드 검토 근거"
type: source
status: active
created: 2026-09-06
updated: 2026-09-06
raw_path: "raw/notes/2026-09-06-dsh-trajectory-review.md"
upstream_commit: "d347e703908d0406b7a7ef80e3a0e594d86b2215"
tags:
  - onputer
  - dsh
  - source
---

# DSH trajectory 코드 검토 근거

## 검토 범위와 최신성

[고정 검토 메모](../../raw/notes/2026-09-06-dsh-trajectory-review.md)는 최신 공식 DSH의 세션·trajectory·영속성·관련 플러그인 코드를 읽고 onputer 적용을 검토한 기록이다. 전체 저장소를 인제스트하거나 DSH 전체 테스트를 실행한 결과는 아니다.

2026-09-06에 기존 clone을 찾아보았으나 찾지 못해 `~/Documents/Playground/deepseek-harness`에 공식 저장소를 새로 clone했다. `master` HEAD는 `d347e703908d0406b7a7ef80e3a0e594d86b2215`, 커밋 시각은 `2026-09-04T17:16:23+08:00`, CLI·패키지 버전은 `0.1.3-alpha.1`이다. 원격 HEAD와 일치를 재확인했다.

설치된 `/opt/homebrew/bin/dsh`의 npm 패키지는 `0.1.0-rc.7`이었다. 설치 환경·인증·사용자 세션 내용을 변경하거나 열지 않았다. clone은 수정하지 않았다. 비교 대상은 onputer v0.2.0과 [[source-2026-09-06-product-proposals|제품 제안 대화]]다.

## 확인한 사실

- Session은 불변 이벤트를 추가하고 모델 메시지와 각종 상태는 로그에서 파생한다. 메모리 append와 durable flush는 다르다.
- Trajectory는 이 로그의 UI 투영이다. 별도 진실 저장소가 아니다.
- JSONL의 현재 형식은 v2이며 zstd가 기본, 일반 JSONL은 선택이다. 세션별 단일 작성자·fsync·손상 구분·버전 이관 구조를 가진다.
- 중단 복구는 시작되지 않은 도구와 결과가 불명인 도구를 구분한다. fork는 이력 상속이며 파일 격리를 뜻하지 않는다.
- jobs-local·terminal은 프로세스 로컬이다. 로그의 영속성과 프로세스의 생존은 다르다.
- 작업 owner·stopping 상태, 결과 spill, 결과 시점 diff, 지침 digest, 기록 기반 테스트가 흡수 후보이다.
- 외부 모델 루프를 소유하지 않는 onputer는 자신이 관측한 실행 사실만 기록해야 한다.

## 절별 반영 경로

| 원문 단위 | 반영 위치 |
|---|---|
| 도입·1. 최신성 | 이 페이지의 검토 범위와 최신성 |
| 2. 세 층 | [[dsh-trajectory-adoption#DSH의 구조|로그·상태·화면]] |
| 3. 저장·복구·재생 | [[dsh-trajectory-adoption#혼동하면 안 되는 네 가지|복구와 재생의 의미]] |
| 4. 흡수 후보 | [[dsh-trajectory-adoption#다른 구조의 흡수 우선순위|후보와 보류]] |
| 5. 최소 구조 | [[dsh-trajectory-adoption#onputer용 최소 설계 제안|관측 경계와 설계]] |
| 6. 제한 검사 | 이 페이지의 수행한 검사 |
| 7. 종합 판단 | [[dsh-trajectory-adoption#권장 순서와 후속 검증|순서와 인수 기준]] |

## 수행한 검사

최신 소스의 `repair.ts`, `seq-ranges.ts`, `util/values`를 로컬 tsx loader로 직접 import해 synthetic 데이터에 적용했다.

1. 요청만 있고 시작 기록이 없는 도구 → `TOOL_NOT_STARTED`.
2. 시작했지만 완료 결과가 없는 도구 → `TOOL_OUTCOME_UNKNOWN`, 시작 이벤트 출처 연결.
3. 복구된 균형 로그를 다시 복구 → 추가 이벤트 없음.
4. 출처 seq 구간의 인코딩·디코딩 왕복, 잘못된 역순 구간 거부.
5. payload snapshot의 원본 변경 격리, NaN 같은 손실 JSON 거부.

다섯 검사 모두 통과했다. DSH 전체 테스트·fsync 장애 주입·UI·실모델·Windows DSH 실행·onputer 통합 성능은 검증하지 않았다. 실행 코드와 결과는 `state/wiki_runs/dsh-helper-probe.mts`, `state/wiki_runs/dsh-helper-probe-result.txt`에 보존한다.

## 1차 근거

- [Session 이벤트 타입](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/types.ts)
- [Session append·flush·fork](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/index.ts)
- [중단 복구](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/repair.ts)
- [JSONL 영속성](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/README.md)
- [Projection](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-projection/README.md)
- [Projection cache](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-projection-cache/README.md)
- [Trajectory UI](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-trajectory/README.md)
- [작업 lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/jobs/jobs-local/README.md)
- [출력 spill](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/spill/spill-policy/README.md)
- [파일 결과 meta](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/fs/tool-fs/README.md)
- [지침 탐색·digest](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/context/agent-instructions/README.md)
- [세션 검색](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/tool-session-query/README.md)
- [터미널](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/terminal/terminal/README.md)
- [권한 preset](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/interaction/permission-presets/README.md)
- [모델 응답 replay](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/test-support/llm-replay/README.md)
- [세션 snapshot 테스트](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/test-support/session-snapshot/README.md)

검토 결론은 [[dsh-trajectory-adoption|onputer 적용 분석]], 단위별 대응은 [[ingest-2026-09-06-dsh-review|반영 내역]]에서 읽는다. 링크된 저장소 전체의 내용이나 제안의 제품 효과까지 검증됐다고 해석하지 않는다.
