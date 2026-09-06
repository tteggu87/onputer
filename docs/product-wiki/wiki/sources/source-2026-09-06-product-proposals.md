---
title: "onputer 제품 확장 제안 대화"
type: source
status: active
created: 2026-09-06
updated: 2026-09-06
raw_path: "raw/notes/2026-09-06-onputer-product-proposals.md"
tags:
  - onputer
  - source
---

# onputer 제품 확장 제안 대화

## 출처와 성격

사용자가 실무·프로덕트 설계·사용자·우와 포인트 관점의 추가 기능 제안을 요청한 대화를 Markdown 구조로 옮긴 단일 출처다. 전체 개발 대화의 전사, 사용자 인터뷰 조사, 검증된 제품 성과를 뜻하지 않는다.

[고정 원문](../../raw/notes/2026-09-06-onputer-product-proposals.md)을 보존했다. 출처 작성일은 2026-09-06이며 구현 맥락은 v0.2.0 / f546732 시점이다. 위키화 요청은 후보 전체의 구현 승인이 아니다.

## 핵심 주장

현재 파일·코드·Git·명령·지침 도구를 작업 이력과 결과 확인 경험으로 연결하자는 제안이다. 실무에서는 이력·검증·진단·복원, 제품 구조에서는 작업 단위·선택 확장·연결별 권한, 사용자 경험에서는 쉬운 연결과 결과 전달을 강조한다.

## 원문 절별 읽기 경로

| 원문 단위 | 보존한 정보 | 위키 페이지 |
|---|---|---|
| 도입 | 출처 성격, 문서화와 구현 승인 구분 | 이 페이지의 출처와 성격 |
| 1. 방향과 기반 | 간단한 MCP·Windows 중심·독립 저장소·19개 도구·현 상태의 빈틈 | [[onputer-product|제품 개요]] |
| 2. 실무 | 이력·체크포인트·검증·환경·로그와 외부 효과 복원 한계 | [[feature-candidates#실무 효용 후보|실무 후보]] |
| 3. 설계 | 작업 ID·확장 분리·권한·연결 검증·역할 경계 | [[feature-candidates#제품 구조 후보|제품 구조 후보]] |
| 4. 사용자 | 관리 화면·연결 진단·트레이·결과 전달·지침 안내 | [[user-experiences#일상 사용의 마찰을 줄이는 후보|사용자 후보]] |
| 5. 우와 경험 | 다음 채팅 재개·결과 근거·화면 비교·반복 절차의 예시와 제한 | [[user-experiences|경험 네 가지]] |
| 6. 참고와 보류 | CodexPro에서 참고할 세 항목과 우선순위가 낮은 후보 | [[roadmap#CodexPro에서 참고할 부분|참고·보류]] |
| 7. 순서 | 다섯 단계와 각각의 완료 기준, 공통 기록 기반 | [[roadmap#순차 구현 제안|순차 구현]] |
| 8. 우선 묶음·판단 | 관리 화면·이력·최종 결과의 묶음, 기대 효과와 미정 사항 | [[roadmap#먼저 만들 묶음에 대한 제안|우선 묶음]], [[open-decisions|미결정 사항]] |
| 9. 근거·범위 | 고정 커밋 코드·MCP 명세·기능 검증과 제품 효과 검증의 차이 | 아래 근거와 검증 범위 |

## 근거와 검증 범위

- [공개 저장소](https://github.com/tteggu87/onputer)
- [기준 커밋 README](https://github.com/tteggu87/onputer/blob/f546732a63b2ba7bed17daeb373f8a7e8b810704/README.md)
- 코드 확인 대상: `scripts/launch.mjs`, `src/config.ts`, `src/http.ts`, `src/jobs.ts`, `src/context.ts`, `src/tools.ts`, `README.md`.
- [MCP 도구 결과: 이미지·리소스 링크](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP 인증 설계 참고](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

외부 문서는 원문에 포함된 근거 링크이며 이 위키 작업에서 해당 문서 전체를 별도로 수집·인제스트한 것은 아니다. 이후 코드 변경은 새 출처로 갱신해야 한다.

## 불확실성과 열린 질문

기대 효과는 설계 판단이다. 대상 웹 서비스, 대표 작업, 기능 범위, 일정·비용과 측정 기준은 확정되지 않았다. 자세한 구분은 [[open-decisions|미결정 사항]]에 모았다.

## 반영 확인

[[ingest-2026-09-06-product-proposals|원문 반영 내역]]에서 제목·절 단위 10개의 대응 위치를 확인한다. [[onputer-product|제품 개요]]가 읽기 시작점이다.
