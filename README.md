# onputer

웹 채팅에서 내 컴퓨터의 파일·터미널·Git을 다루는 작은 **Streamable HTTP MCP 서버**입니다.
Windows를 주 작업 환경으로 설계하고 macOS와 Linux도 지원합니다.
연결한 AI가 `AGENTS.md`와 스킬을 읽고 작업하도록 필요한 문맥을 제공합니다.

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

## 도구 15개

| 도구 | 역할 |
|---|---|
| `server_status` | OS·기본 셸·명령 실행 활성화 여부 확인 |
| `list_workspaces` | 설정에 등록한 작업공간 조회 |
| `open_workspace` | 작업공간의 루트 지침과 스킬 목록 읽기 |
| `read_instructions` | 대상 경로까지의 `AGENTS.md` 지침 읽기 |
| `list_files` | 파일·폴더 탐색, 깊이 제한과 페이지 이동 |
| `search_files` | 파일명 또는 본문의 문자열 검색 |
| `read_file` | 줄 번호를 포함한 UTF-8 파일 읽기, 수정용 해시 반환 |
| `write_file` | 파일 생성·덮어쓰기, 기존 파일은 해시 필요 |
| `edit_file` | 정확히 한 곳의 문자열 교체, 해시로 충돌 감지 |
| `list_skills` | 스킬 이름·설명 검색 |
| `read_skill` | 스킬 본문 또는 스킬 폴더 안의 참고 파일 읽기 |
| `git_changes` | Git 상태와 staged 또는 unstaged diff 확인 |
| `run_command` | 명령 비동기 실행, process_id 반환 |
| `read_process` | 실행 상태·종료 코드·출력 조회 |
| `stop_process` | 실행 중인 명령과 자식 프로세스 중단 |

Git 커밋·브랜치·fetch·push와 파일 이동·삭제는 `run_command`에서 실행합니다.
AI 모델 호출, 브라우저·마우스 조작, Codex 대화 기록, HTML 카드는 포함하지 않습니다.

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
동시 명령은 8개, 보관 작업은 64개입니다. 출력은 마지막 128,000자만 남기며 `output_lost`로 유실을 알립니다.
`read_process`의 `next_offset`을 다음 요청에 넘기세요. 한 번에 최대 16,000자를 반환합니다.
작업·출력 기록은 메모리에만 있고 서버 재시작 시 사라집니다. 기본 명령 시간 제한은 10분, 최대 24시간입니다.

## 개발과 검증

```sh
npm ci --ignore-scripts
npm test
```

공식 MCP SDK 클라이언트로 HTTP 초기화·도구 호출, 파일 충돌, 경로 차단, 지침·스킬, Git과 프로세스 수명주기를 검증합니다.
GitHub Actions는 Windows·macOS·Linux에서 Node 22/24 조합과 실행 파일을 검사합니다.

전송은 [Streamable HTTP 명세](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)에 따른 stateless JSON 응답 방식입니다.
구현은 [공식 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)를 사용합니다.

## 라이선스

MIT. CodexPro의 작업 흐름에서 아이디어를 얻었으며 별도 코드베이스로 작성했습니다.
