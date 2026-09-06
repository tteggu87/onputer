# onputer 제품 위키

onputer의 제품 방향과 기능 제안을 연결해 읽는 **Markdown 전용 위키**입니다. SQLite·그래프 DB·별도 검색 서버는 사용하지 않습니다.

Obsidian에서 이 `product-wiki` 폴더를 vault로 열거나 아래 Markdown 문서를 바로 읽으세요.

1. [제품 개요](wiki/projects/onputer-product.md)
2. [실무·제품 설계 기능 후보](wiki/analyses/feature-candidates.md)
3. [사용자 경험과 우와 포인트](wiki/analyses/user-experiences.md)
4. [우선순위와 완료 기준](wiki/analyses/roadmap.md)
5. [미결정 사항과 검증 질문](wiki/analyses/open-decisions.md)

전체 목록은 [위키 인덱스](wiki/_meta/index.md), 최근 변경은 [작업 기록](wiki/_meta/log.md), 원문은 [제품 제안 대화](raw/notes/2026-09-06-onputer-product-proposals.md)입니다.

## 상태 구분

현재 구현은 v0.2.0 / f546732 시점의 기록입니다. 추가 기능은 **제안**이며 전체 구현이 승인되거나 효과가 검증된 상태가 아닙니다. 실제 제품 사용법은 [onputer README](../../README.md)를 확인하세요.

## 유지보수

에이전트는 [AGENTS.md](AGENTS.md) → 인덱스 → 최근 로그 순으로 읽고 관련 위키 링크를 따라 근거를 확인합니다. 원문은 `raw/`에 보존하고 해석·결정·비교는 `wiki/`에 갱신합니다.

```sh
python scripts/llm_wiki.py status
python scripts/llm_wiki.py lint
python scripts/llm_wiki.py reindex
```

Windows에서는 Python 3 설치 후 `python` 또는 `py`를 사용할 수 있습니다. 이 도구는 문서 관리용이며 onputer MCP 서버 실행에는 필요하지 않습니다.

다음 유지보수 요청 예시:

> onputer 제품 위키의 AGENTS.md와 인덱스를 읽고, 연결할 웹 서비스를 선택한 결정을 추가해줘. 기존 제안과 결정된 범위를 구분하고 관련 페이지와 로그를 갱신해줘.

새 원문을 빠짐없이 반영하는 작업은 설치된 `llm-wiki-loop` 스킬을 사용합니다. 이 폴더에는 해당 검증 실행기를 복사하지 않습니다.
