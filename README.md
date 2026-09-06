# onputer

웹 채팅에서 내 컴퓨터의 파일·터미널·Git을 다루는 작은 **Streamable HTTP MCP 서버**입니다.
Windows를 주 작업 환경으로 설계하고 macOS와 Linux도 지원합니다.
연결한 AI가 `AGENTS.md`와 스킬을 읽고 작업하도록 필요한 문맥을 제공합니다.

제품 방향과 추가 기능 제안은 [제품 위키](docs/product-wiki/README.md)에서 읽을 수 있습니다. 구현된 기능과 제안 단계 기능을 구분해 기록합니다.

## 빠른 시작

1. **Node.js 22 이상**을 [설치](https://nodejs.org/)합니다. Git 작업을 하려면 [Git](https://git-scm.com/downloads)도 설치합니다.
2. 이 저장소를 내려받고 압축을 풉니다. 또는 `git clone https://github.com/tteggu87/onputer.git`을 실행합니다.
3. Windows는 **`start-onputer.bat`**, macOS는 **`start-onputer.command`**를 실행합니다.
4. 처음 표시되는 질문에 작업할 폴더의 전체 경로를 입력합니다. Enter만 누르면 onputer 폴더를 사용합니다.
5. 설치·빌드가 끝나 `onputer ready`가 나오면 준비 완료입니다. 연결 정보는 **`.onputer/connection.txt`**에 있습니다.

처음에는 npm 다운로드를 위한 인터넷 연결이 필요합니다. 이후에는 잠금 파일이 바뀔 때만 의존성을 다시 설치합니다.
실행창을 열어둔 채 사용하고, **Ctrl+C**로 서버와 실행 중인 작업을 종료합니다. 자동 백그라운드 서비스 설치는 하지 않습니다.
토큰은 처음 한 번 생성한 뒤 재사용합니다. 설정을 바꾸고 서버를 다시 시작하면 적용됩니다.

macOS에서 실행 권한이 없다면 터미널에서 `chmod +x start-onputer.command`를 한 번 실행하세요.
Windows에서 새로 설치한 Node.js나 Git을 찾지 못하면 실행창을 닫고 다시 시작하세요.

폴더를 직접 지정할 수도 있습니다.

```bat
start-onputer.bat --root "C:\Users\me\Documents\My Project"
```

```sh
./start-onputer.command --root "/Users/me/Documents/My Project"
```

Linux 또는 일반 터미널에서는 `npm start -- --root "/path/to/project"`를 사용합니다.
`--port 8790`으로 포트를 변경할 수 있고, `--setup-only --no-prompt`는 설정·설치·빌드만 수행합니다.
`--root`는 기존 설정의 작업공간 목록을 지정한 하나로 교체합니다.

## 웹 서비스에 연결

로컬 주소는 `http://127.0.0.1:8788/mcp`입니다. 같은 컴퓨터의 MCP 클라이언트에서 사용할 수 있습니다.
**외부 웹 서비스는 이 로컬 주소에 직접 접근할 수 없습니다.** 별도 HTTPS 터널이나 리버스 프록시를 로컬 8788 포트에 연결해야 합니다.
onputer는 터널 제공자를 내장하거나 자동으로 공개하지 않습니다.

1. 사용하는 터널 도구에서 `http://127.0.0.1:8788`로 연결되는 HTTPS 주소를 만듭니다.
2. `.onputer/config.json`의 `allowedHosts`에 공개 주소의 **호스트명만** 추가합니다. 예: `onputer.example.com`.
3. onputer를 다시 시작합니다.
4. 웹 서비스의 원격 MCP 연결에 `https://onputer.example.com/mcp`와 `Authorization: Bearer <토큰>`을 설정합니다.
5. 인증 헤더 입력을 지원하지 않는 클라이언트에서는 **`https://onputer.example.com/mcp/<토큰>`**을 사용할 수 있습니다.

토큰 URL 자체가 컴퓨터 접근 권한입니다. 채팅 본문, 스크린샷, 공개 로그에 올리지 마세요.
헤더 방식을 우선 사용하고, URL 방식의 터널·프록시는 요청 경로를 로그에 저장하지 않도록 설정하세요.
OAuth 전용 클라이언트에는 인증을 처리하는 별도 게이트웨이가 필요합니다. 모든 웹 서비스와의 연결을 보장하지 않습니다.
브라우저가 직접 요청하는 경우에만 해당 Origin(예: `https://my-client.example`)을 `allowedOrigins`에 추가합니다.
서버에서 서버로 연결하는 일반 MCP 서비스에는 Origin 설정이 보통 필요하지 않습니다.

연결 후 다음과 같이 요청하세요.

> onputer의 open_workspace로 프로젝트를 열고, 지침과 관련 스킬을 읽어줘. 변경 전에 대상 경로의 지침도 확인하고, 작업 후 테스트 결과와 git_changes를 보여줘.

## 도구 25개

| 도구 | 역할 |
|---|---|
| `server_status` | OS·기본 셸·명령 실행 활성화 여부 확인 |
| `list_workspaces` | 설정에 등록한 작업공간 조회 |
| `open_workspace` | 작업공간의 루트 지침과 스킬 목록 읽기 |
| `read_instructions` | 대상 경로까지의 `AGENTS.md` 지침 읽기 |
| `list_files` | 파일·폴더 탐색, 깊이 제한과 페이지 이동 |
| `search_files` | 파일명 또는 본문의 문자열 검색 |
| `read_file` | 줄 번호를 포함한 UTF-8 파일 읽기, 수정용 해시 반환 |
| `inspect_project` | 언어·설정·진입점 후보·영역·심볼·import 관계 요약 |
| `search_code` | 심볼 정의와 식별자 참조 후보 검색 |
| `analyze_changes` | 변경 영향·관련 테스트·검증 명령 후보 분석 |
| `apply_patch` | 여러 파일의 생성·수정·삭제·이동을 unified diff로 적용 |
| `write_file` | 파일 생성·덮어쓰기, 기존 파일은 해시 필요 |
| `edit_file` | 정확히 한 곳의 문자열 교체, 해시로 충돌 감지 |
| `list_skills` | 스킬 이름·설명 검색 |
| `read_skill` | 스킬 본문 또는 스킬 폴더 안의 참고 파일 읽기 |
| `git_changes` | Git 상태와 staged 또는 unstaged diff 확인 |
| `run_command` | 명령 비동기 실행, process_id 반환 |
| `read_process` | 실행 상태·종료 코드·출력 조회 |
| `stop_process` | 중단 요청, stopping과 실제 종료 구분 |
| `start_task` | 여러 단계의 작업을 묶는 영속 작업 생성 |
| `finish_task` | 사용자·AI가 보고한 결론으로 작업 종료 |
| `list_tasks` | 재시작 후에도 남는 작업 목록 |
| `read_task` | 작업 요약·변경 기록·이벤트 조회 |
| `read_artifact` | 저장된 출력·diff·도구 입력과 결과 읽기 |
| `list_processes` | 현재 및 과거 프로세스 조회 |

Git 커밋·브랜치·fetch·push와 파일 이동·삭제는 `run_command`에서 실행합니다.
AI 모델 호출, 브라우저·마우스 조작, Codex 대화 기록, HTML 카드는 포함하지 않습니다.

## 작업 이력과 결과 자료

v0.3.0부터 작업 기록은 기본적으로 설정 파일 옆 `history/`에 남습니다. 기본 실행 파일을 쓰면 `.onputer/history/`입니다.
DSH의 이벤트 기록 원칙을 참고해 onputer에 별도로 구현했으며, DSH 설치나 모델 API 키는 필요 없습니다.

여러 단계를 묶으려면 다음 순서로 사용합니다.

1. `start_task`에 작업 제목을 전달하고 `task_id`를 받습니다.
2. 파일·코드·명령·지침 도구에 같은 `task_id`를 전달합니다.
3. `read_task`에서 도구 결과, 프로세스 결과, 변경 당시 diff와 결과 자료 ID를 확인합니다.
4. 실제 검증을 마친 뒤 `finish_task`에 결론을 기록합니다.

`task_id` 없이 파일 수정·패치·명령 실행을 호출하면 해당 호출의 자동 작업 기록을 만듭니다.
읽기 도구는 `task_id`를 명시한 경우에만 작업 이력에 연결합니다. 이력 조회와 프로세스 조회 자체는 반복 기록하지 않습니다.
같은 작업에서 지침·스킬의 같은 내용 버전은 별도 문맥 이벤트를 중복 생성하지 않지만, 명시적으로 읽기를 요청한 결과는 정상 반환합니다.
지침을 제공했다는 기록은 AI가 지침을 이해하거나 준수했다는 증거가 아닙니다.

### 기록과 성공의 의미

- `tool/completed`는 도구 호출이 끝났다는 뜻입니다. `run_command`가 반환됐다고 프로세스가 성공한 것은 아닙니다.
- 프로세스 성공은 `process/exited`의 종료 코드로 확인합니다. 중단 요청 중에는 `stopping`이며 실제 정리 후 `stopped` 또는 `timed_out`이 됩니다.
- `finish_task`는 호출자가 보고한 결론입니다. 이전 실패 수와 프로세스 결과를 함께 보존하며 품질 인증으로 취급하지 않습니다.
- 재시작 때 미완료 호출·프로세스는 `unknown`으로 바뀝니다. 과거 명령은 자동 재실행하지 않고, 저장된 PID로 과거 프로세스를 중단하지 않습니다.
- 완료된 결과와 출력은 재시작 후 `list_tasks`, `read_task`, `read_process`, `read_artifact`로 조회할 수 있습니다.

### 재시도 중복 방지

명시적인 `task_id`가 있을 때 `idempotency_key`를 함께 줄 수 있습니다. 같은 키와 동일한 입력을 다시 보내면 저장된 도구 결과를 반환하고 `replayed: true`로 표시합니다.
같은 키에 다른 입력을 보내면 거부합니다. 이전 도구 호출이 아직 진행 중이거나 결과가 불명확하면 재실행하지 않고 이력을 확인하도록 오류를 반환합니다.
프로세스 시작 응답을 재사용한 경우에는 원래 `process_id`를 조회해 현재 상태를 확인하세요.
이 기능은 모든 외부 효과의 정확히 한 번 실행을 보장하지 않습니다. 키를 바꾸거나 생략한 재요청은 별도 작업입니다.

### 결과 자료와 보존

출력·도구 입력·결과·변경 당시 diff는 작업별 `artifacts/`에 저장합니다. 파일 기록은 당시의 전후 해시와 diff이므로 이후 파일이 바뀌어도 당시 변경을 검토할 수 있습니다.
이 diff는 검토용이며, 전체 파일 복원·Git worktree 격리 기능을 제공하는 것은 아닙니다.
`read_artifact`와 `read_process`의 `offset`/`next_offset`은 **UTF-8 바이트 위치**입니다. 다음 조회에는 반환된 `next_offset`을 사용하세요.

출력은 기본적으로 자료 하나당 16 MiB까지 보관합니다. 상한을 넘으면 앞부분만 유지하고 완료 메타데이터에 `truncated`를 표시합니다.
진행 중인 자료의 `truncated: null`은 아직 최종 보존량이 확정되지 않았다는 뜻입니다. `read_process.output_lost`는 현재 실행 중인 출력 상한 도달 여부를 알려줍니다.
서버 토큰, 흔한 인증 필드와 일부 비밀 값 표현을 저장 전에 마스킹합니다. 모든 민감정보를 찾아내는 보장은 없으며 작업 기록을 공개 저장소에 올리지 마세요.

설정 옵션은 다음과 같습니다.

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `historyDir` | 설정 파일 옆 `history/` | 이력 저장 위치 |
| `historyArtifactMaxBytes` | `16777216` | 자료당 보관 상한, 1–256 MiB |
| `historyRetentionDays` | `30` | 서버 시작 시 오래된 completed/failed 작업 정리; `0`은 자동 정리 안 함 |

unknown 상태의 자동 작업과 미종료 작업은 자동 정리하지 않습니다. 같은 인증을 쓰는 클라이언트는 한 명의 로컬 소유자로 취급되며, 작업공간 필터가 다중 사용자 인증을 대신하지 않습니다.
작업공간의 실제 경로로 이력을 구분하므로 roots 순서를 바꿔도 해당 작업공간의 기록을 찾습니다.

### 저장과 복구

이벤트는 순번·형식 버전·앞 이벤트 해시를 가진 JSONL로 추가하고 파일을 동기화합니다. 단일 작성자 잠금으로 같은 저장소의 동시 서버 사용을 막습니다.
강제 종료 뒤 잠금이 남으면 만료 확인에 약 15초가 걸릴 수 있습니다. 현재 서버가 살아 있는 동안 잠금 파일을 임의로 삭제하지 마세요.
불완전한 마지막 줄은 복구 시 제거하고 복구 사실을 기록합니다. 이미 완료된 줄의 형식·순서·해시가 잘못되면 시작을 거부하며 조용히 덮어쓰지 않습니다.
완료·복구 기록을 위한 별도 용량을 남기며, 작업이 약 3 MiB 또는 8,000개 이벤트에 도달하면 새 호출을 받지 않습니다. 이때 작업을 종료하고 새 작업을 시작하세요.
전체 저장소는 최대 5,000개 작업을 다룹니다. 기록을 별도 보관할 때는 서버를 중지한 후 작업 폴더를 통째로 옮기세요.

## 코드 구조와 변경 영향 분석

`inspect_project`는 파일을 실행하지 않고 언어·설정 파일·영역·관례적인 파일명에 따른 진입점 후보를 보여줍니다.
전체 파일 목록은 `offset`/`limit`으로 이동합니다. 심볼·import는 요약만 반환하므로 특정 코드는 `search_code`로 찾으세요.

```json
{"query": "calculate", "kind": "definitions"}
```

같은 이름이 사용된 위치를 보려면 `kind: "references"`를 지정합니다.
`exact: false`는 이름 일부로 검색합니다. 결과의 `path`, `line`, `column`을 `read_file`과 함께 사용하세요.

- **JS/TS:** TypeScript 구문 트리로 함수·클래스·타입·메서드·변수와 import를 추출합니다. 로컬 상대 import, 문자열 require/dynamic import, re-export, 루트 tsconfig의 `baseUrl`/`paths`를 해석합니다. `rootDir`/`outDir`가 명시되면 빌드 출력 파일을 가져오는 테스트와 원본 소스의 관계도 추정합니다.
- **Python:** 간이 문법 분석으로 함수·클래스와 로컬 import를 추정합니다.
- **Go·Rust·C#·Java·C/C++·Swift:** 일부 선언과 식별자를 간이 분석합니다. 언어 서버 수준의 분석이나 이 언어들의 import 그래프는 제공하지 않습니다.

참조는 **같은 식별자가 나타난 후보 위치**입니다. 변수 가림이나 동일 이름의 다른 함수까지 의미적으로 구분하지 않습니다.
`node_modules`·외부 패키지·tsconfig 확장/프로젝트 참조·실행 시 결정되는 경로는 추적하지 않습니다.
미해결 import 수와 분석 한계는 `coverage`에 표시합니다. 결과에 없다고 영향이 없다는 의미는 아닙니다.

`analyze_changes`는 현재 unstaged 변경과 untracked 파일을 대상으로 import를 역으로 따라 최대 8단계 영향과 관련 테스트를 찾습니다.
`staged: true`는 인덱스의 변경 경로를 사용하지만 분석하는 소스 내용은 현재 작업 트리입니다.
변경 전에도 다음처럼 직접 대상 경로를 지정할 수 있습니다. 이 방식은 Git 저장소가 아니어도 됩니다.

```json
{"paths": ["src/math.ts"]}
```

직접 해석한 import 관계와 추정 관계를 구분하고, 간접 영향에도 추정 여부를 전달합니다.
관련 테스트는 import 관계 또는 파일명 유사성으로 찾으며, 실제 테스트 통과나 전체 커버리지를 보장하지 않습니다.
관련 영역의 `package.json`에 선언된 test/typecheck/lint 명령은 후보로만 반환하고 실행하지 않습니다.

분석은 매 호출 현재 파일을 읽으므로 별도 인덱싱·캐시 갱신 작업이 필요 없습니다.
최대 5,000개 항목·20단계 폴더를 조사하고, 1,000개 파일·16 MiB·20,000개 심볼·50,000개 참조·300,000개 AST 노드·10,000개 import까지만 분석합니다.
큰 저장소나 한도를 넘은 결과는 `coverage.truncated`와 경고를 확인하고 파일 검색을 병행하세요.

## 여러 파일을 패치로 수정

`apply_patch`는 표준 **unified diff**를 받습니다. `*** Begin Patch` 형식은 받지 않습니다.
기존 파일은 먼저 `read_file`로 읽고 반환된 SHA-256을 `expected_hashes`에 넣습니다. 새 파일은 해시가 필요 없습니다.

```json
{
  "patch": "--- a/src/math.ts\n+++ b/src/math.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
  "expected_hashes": {"src/math.ts": "여기에 read_file이 반환한 64자리 sha256"},
  "dry_run": true
}
```

`dry_run: true`는 변경 목록과 적용 가능 여부만 확인합니다. 같은 패치와 해시에 `dry_run: false`를 주면 적용합니다.
기존 파일이 그 사이 바뀌면 다시 읽도록 오류를 반환합니다. 생성은 이전 경로를 `/dev/null`, 삭제는 새 경로를 `/dev/null`로 씁니다.
서로 다른 이전·새 경로 또는 Git rename 헤더로 파일을 이동할 수 있습니다. 이동 대상이 이미 있으면 거부합니다.

UTF-8 한글 파일·공백 경로·CRLF·마지막 줄바꿈 유무를 처리하며 Git 설치가 필요 없습니다.
패치당 최대 50개 파일·1 MiB 패치 텍스트, 파일당 1 MiB, 변경 전후 내용을 합쳐 8 MiB까지 허용합니다.
전체 패치의 경로·해시·문맥을 확인한 후 적용하며, 중간 I/O 오류는 이미 바꾼 파일의 복원을 시도합니다.
프로세스 강제 종료·전원 중단까지 원자적으로 복구하는 트랜잭션은 아닙니다. 복원에 실패하면 검토할 경로를 오류로 알립니다.
바이너리·링크·Git copy 헤더·한 배치의 중복 경로는 지원하지 않습니다. 대소문자만 바꾸는 이동은 임시 이름을 거쳐 나눠 실행하세요.

## Windows 동작

- 기본 셸은 Windows 기본 **PowerShell (`powershell.exe`)**입니다. 프로필과 대화형 입력을 사용하지 않습니다.
- 명령을 UTF-16으로 인코딩해 전달하고 PowerShell 출력을 UTF-8로 설정합니다. 파일 도구도 UTF-8을 사용합니다.
- `shell: "cmd"`를 지정하면 명령 프롬프트 구문을 사용할 수 있습니다. 이 경우 출력 문자 인코딩은 실행 프로그램·코드 페이지에 따라 다릅니다.
- 경로는 JSON에서 `C:\\Users\\me\\project`처럼 백슬래시를 이스케이프하거나 `C:/Users/me/project`로 씁니다.
- 파일 도구는 Node API를 사용하므로 Bash·ripgrep 설치가 필요 없습니다.
- PowerShell에서 `npm.ps1` 실행 정책 오류가 나면 명령에 `npm.cmd`를 사용하세요. 실행 파일의 설치 단계는 cmd를 사용합니다.
- 비대화형 실행이므로 로그인·암호 입력·대화형 설치는 로컬 터미널에서 먼저 완료하세요.

macOS의 기본 셸은 `/bin/zsh`, Linux는 `/bin/sh`입니다. 명령 내용은 OS에 맞게 작성해야 합니다.
외부 프로그램이 UTF-8 이외의 인코딩을 출력하면 문자가 깨질 수 있습니다.

## 지침과 스킬

작업공간의 `AGENTS.md`와 대상 경로의 하위 `AGENTS.md`를 순서대로 제공합니다.
작업공간 바깥 상위 폴더의 지침은 자동으로 읽지 않습니다. 하위 경로 작업 전 `read_instructions`를 호출해야 합니다.
지침 준수는 연결된 AI의 행동입니다. 서버는 지침 내용을 실행 정책으로 해석하지 않습니다.

스킬은 각 작업공간의 `.agents/skills`, `.codex/skills`, `skills`에서 찾습니다.
다른 설치 위치는 `skillRoots`에 명시적으로 추가합니다. 사용자 홈 전체를 자동 검색하지 않습니다.
`SKILL.md`의 한 줄 `name:`·`description:`을 목록에 사용하며 복잡한 YAML은 해석하지 않습니다.
`read_skill`은 `references/guide.md` 같은 스킬 내부 참고 파일도 읽습니다.
실행이 필요한 스킬은 AI가 본문을 읽고 `run_command`로 별도 수행합니다.

## 설정

`.onputer/config.json`을 편집하세요. 아래는 **설명용 예시**이며 실제 토큰은 실행 파일이 생성합니다.

```json
{
  "roots": ["C:/work/project"],
  "skillRoots": ["C:/Users/me/.agents/skills"],
  "host": "127.0.0.1",
  "port": 8788,
  "token": "REPLACE_WITH_YOUR_GENERATED_TOKEN_AT_LEAST_32_CHARS",
  "allowedHosts": ["localhost", "127.0.0.1", "[::1]", "onputer.example.com"],
  "allowedOrigins": [],
  "allowCommands": true
}
```

`roots` 순서가 workspace id(0, 1, …)가 됩니다. 여러 채팅이 다른 프로젝트를 다룰 때 매번 id를 전달하세요.
선택한 프로젝트를 서버 전체에 저장하지 않아 다른 채팅이 작업 위치를 바꾸지 않습니다.
`ONPUTER_CONFIG` 환경변수로 다른 설정 파일 경로를 지정할 수 있습니다.
`allowCommands: false`는 명령 실행·출력·중단 도구를 숨깁니다. **파일 쓰기는 계속 가능합니다.**

## 실행 범위와 제한

이 서버는 **한 명의 소유자가 신뢰하는 클라이언트에 연결하는 도구**입니다. 같은 토큰을 쓰는 채팅은 작업공간과 프로세스를 공유합니다.
파일 도구는 작업공간 외부 경로, 심볼릭 링크·junction, `.git`, `.env*`, `.onputer` 등의 경로를 거부합니다.
동시에 다른 로컬 프로세스가 파일을 바꾸는 모든 경쟁 조건을 방어하는 보안 샌드박스는 아닙니다.

**명령은 서버를 실행한 OS 사용자 권한으로 동작하며 작업공간에 격리되지 않습니다.**
파일 도구의 경로 제한은 셸 명령에 적용되지 않습니다. 필요하면 별도 OS 계정이나 VM에서 실행하세요.
AI 도구 설명의 확인 지침은 사용자 승인 UI를 대체하지 않습니다.

텍스트 파일은 1 MiB까지 처리하며 검색은 최대 5,000개 항목·16 MiB 본문을 스캔합니다.
큰 Git diff는 일부만 반환하고 `truncated`로 알립니다. `path`로 범위를 좁혀 다시 확인하세요.
동시 명령은 실행·중단 중을 합쳐 8개입니다. 메모리에는 최근 프로세스 일부만 유지하고 이전 기록은 저장소에서 읽습니다.
`read_process`는 한 번에 최대 16,000바이트, `read_artifact`는 최대 32,000바이트를 반환합니다.
기본 명령 시간 제한은 10분, 최대 24시간입니다. 이력은 남지만 실제 프로세스의 재시작·부활을 보장하지 않습니다.

## 개발과 검증

```sh
npm ci --ignore-scripts
npm test
npm run test:acceptance
```

공식 MCP SDK 클라이언트로 HTTP 초기화·도구 호출, 파일 충돌, 경로 차단, 지침·스킬, Git과 프로세스 수명주기를 검증합니다.
추가 인수 검사는 실제 실행 파일로 서버를 시작해 임시 저장소의 Git 커밋·푸시, 출력 페이지 이동, 자식 프로세스 중단·시간 초과를 확인합니다. 작업 이력·중복 방지·지침 버전·당시 diff도 실제 MCP 호출로 확인합니다. macOS·Linux에서는 Ctrl+C 종료와 강제 종료 뒤 복구·자동 재실행 방지도 검사합니다.
GitHub Actions는 Windows·macOS·Linux에서 Node 22/24 조합과 실행 파일을 검사합니다.

전송은 [Streamable HTTP 명세](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)에 따른 stateless JSON 응답 방식입니다.
구현은 [공식 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)를 사용합니다.

## 라이선스

MIT. CodexPro의 작업 흐름에서 아이디어를 얻었으며 별도 코드베이스로 작성했습니다.
