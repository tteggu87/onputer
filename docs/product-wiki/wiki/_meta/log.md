---
title: "작업 기록"
type: meta
status: active
created: 2026-09-06
updated: 2026-09-06
---

# 작업 기록

## [2026-09-06] ingest | 제품 제안 위키 생성

사용자 요청에 따라 onputer 저장소의 docs/product-wiki에 Markdown 전용 vault를 생성했다. SQLite는 사용하지 않는다.

고정 원문 한 건의 도입과 아홉 절을 읽고 [[source-2026-09-06-product-proposals|출처 페이지]], [[onputer-product|제품 개요]], [[feature-candidates|기능 후보]], [[user-experiences|사용 경험]], [[roadmap|우선순위]], [[open-decisions|미결정 사항]]으로 연결했다.

구현 스냅샷·추가 제안·미확정 결정을 구분했다. 원문 반영 위치는 [[ingest-2026-09-06-product-proposals|반영 내역]]에 기록했다. 문서 생성은 추가 기능 전체의 구현 승인을 의미하지 않는다.

검증은 로컬 lint와 llm-wiki-loop의 단일 출처 절차를 사용한다. 완료 증거는 state/wiki_runs의 해당 실행 기록에 남긴다.

원문 경로: `raw/notes/2026-09-06-onputer-product-proposals.md`. 인덱스 요약이 YAML 메타데이터를 본문으로 오인하지 않도록 이 vault의 로컬 CLI를 보완했다.

## [2026-09-06] ingest | DSH Trajectory Review

- Registered source at `raw/notes/2026-09-06-dsh-trajectory-review.md`
- Created or reused `[[source-2026-09-06-dsh-trajectory-review]]`
- Pending LLM synthesis or ontology-backed ingest into the broader wiki

## [2026-09-06] analysis | DSH trajectory와 onputer 적용 검토

공식 DSH 최신 master d347e70 / 0.1.3-alpha.1을 새 clone에서 확인하고 이벤트·projection·trajectory·저장·복구와 관련 구조를 검토했다. 기존 설치 0.1.0-rc.7과 실행 설정은 변경하지 않았다.

원문 경로: `raw/notes/2026-09-06-dsh-trajectory-review.md`. [[source-2026-09-06-dsh-trajectory-review|코드 검토 근거]] → [[dsh-trajectory-adoption|적용 평가]] → [[feature-candidates|후보]] → [[roadmap|우선순위]] 순으로 연결했다.

최신 소스의 순수 helper 검사 다섯 개가 통과했으며, 전체 DSH·실모델·UI·Windows 통합 검증으로 확대 해석하지 않는다. onputer 런타임 기능은 구현하지 않았다. [[ingest-2026-09-06-dsh-review|반영 내역]]은 검토 메모 여덟 단위를 다룬다.
