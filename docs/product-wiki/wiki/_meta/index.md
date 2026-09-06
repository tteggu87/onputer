---
title: "Index"
type: meta
status: active
created: 2026-09-06
updated: 2026-09-06
---

# Index

This file is rebuilt by `python scripts/llm_wiki.py reindex`.

## Meta

- [[ingest-2026-09-06-dsh-review]] - Raw path: `raw/notes/2026-09-06-dsh-trajectory-review.md`
- [[log]] - 사용자 요청에 따라 onputer 저장소의 docs/product-wiki에 Markdown 전용 vault를 생성했다. SQLite는 사용하지 않는다.
- [[dashboard]] - [[onputer-product|제품 개요]]에서 시작하세요. 이 위키는 Markdown만 사용하며 SQLite 검색은 없습니다.
- [[ingest-2026-09-06-product-proposals]] - Raw path: `raw/notes/2026-09-06-onputer-product-proposals.md`

## Analyses

- [[dsh-trajectory-adoption]] - **실행 기록·출처·현재 상태를 한 로그에서 파생하는 원칙은 적극 참고할 가치가 있다. 다만 DSH 전체 모델 trajectory와 플러그인 런타임을 들여오는 것은 현재 onputer의 역할에 비해 과하다.**
- [[open-decisions]] - 이 문서는 [[source-2026-09-06-product-proposals|제안 원문]]에서 드러난 미결정 사항과 기능별 제한을 모았다. 아래 질문을 해결하기 전에는 제안을 확정 요구사항이나 검증된 효과로 바꾸지 않는다.
- [[user-experiences]] - [[source-2026-09-06-product-proposals|제품 제안 대화]]의 사용자 관점과 인상적인 경험을 묶었다. 모두 미래 경험의 예시이며 현재 기능이나 측정 결과가 아니다.
- [[feature-candidates]] - 아래 항목은 모두 [[source-2026-09-06-product-proposals|제품 제안 대화]]에서 나온 **추가 후보**다. 기대 효과는 설계 판단이며 구현 완료나 사용자 검증을 뜻하지 않는다. 기존 기능은 [[onputer-product|제품 개요]]와 구분해 읽는다.
- [[roadmap]] - [[source-2026-09-06-product-proposals|제품 제안 대화]]에서 제시한 순서다. **확정 일정·납기·구현 승인이 아니며** 개발 기간이나 비용도 산정하지 않았다.

## Projects

- [[onputer-product]] - onputer는 웹 채팅 AI가 로컬 컴퓨터의 파일·코드·Git·명령을 다루게 하는 Streamable HTTP MCP 서버다. 간단하고 효과적인 구성을 지향하며 Windows를 주 작업 환경으로, macOS를 함께 지원한다. CodexPro와 별도의 코드베이스·폴더·공개 저장소를 사용한다.

## Sources

- [[source-2026-09-06-dsh-trajectory-review]] - [고정 검토 메모](../../raw/notes/2026-09-06-dsh-trajectory-review.md)는 최신 공식 DSH의 세션·trajectory·영속성·관련 플러그인 코드를 읽고 onputer 적용을 검토한 기록이다. 전체 저장소를 인제스트하거나 DSH 전체 테스트를 실행한 결과는 아니다.
- [[source-2026-09-06-product-proposals]] - 사용자가 실무·프로덕트 설계·사용자·우와 포인트 관점의 추가 기능 제안을 요청한 대화를 Markdown 구조로 옮긴 단일 출처다. 전체 개발 대화의 전사, 사용자 인터뷰 조사, 검증된 제품 성과를 뜻하지 않는다.
