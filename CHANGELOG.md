# Changelog

## 0.3.0

- 작업별 JSONL 이벤트, 결과 자료, 순번·해시 검증, 미완료 결과의 unknown 복구를 추가했다.
- start_task/finish_task/list_tasks/read_task/read_artifact/list_processes와 선택적 task_id/idempotency_key를 추가했다.
- 중단 요청과 실제 프로세스 종료를 구분하고, 큰 출력을 저장 자료로 조회하게 했다.
- 파일 변경 당시 diff·해시와 제공한 지침·스킬 버전을 기록한다.
- 작업·자료는 기본 30일 보존 정책과 자료당 16 MiB 상한을 사용한다. unknown 자동 작업과 미종료 작업은 자동 정리하지 않는다.
- read_process 출력 위치는 UTF-8 바이트 기준이며, 과거 프로세스도 조회할 수 있다. 기록으로 명령을 자동 재실행하지 않는다.
- 작업 영수증은 MCP 조회 도구로 제공한다. 별도 trajectory GUI, 자체 모델 루프, 파일 복원 기능은 포함하지 않는다.
