# onputer development

Use Node.js 22+ and TypeScript. Run `npm test` before committing.
Keep tool names generic and descriptions honest. Windows is a primary platform.
Use Node filesystem APIs, not Unix command dependencies. Windows commands use
PowerShell; macOS commands use /bin/zsh. Never interpolate paths into shell code.
Keep configuration and tokens in ignored `.onputer/`, never in tracked files.
Commands run as the server's OS user; filesystem guards are not an OS sandbox.
Do not copy implementation or private configuration from other repositories.
