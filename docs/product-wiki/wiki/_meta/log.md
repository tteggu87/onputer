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
