# 将 Codex 连接到 ResolveRoom

普通用户不需要打开 Agents 页面、复制长期 credential、配置环境变量，也不需要每个回合再次唤醒 Codex。ResolveRoom 会在 conflict 中自动创建并绑定 Agent，然后用一个十分钟有效、仅能使用一次的配对码安装本地常驻 Runner。配对指令会先要求 Codex 调用 `load_workspace_dependencies`，使用 Codex 自带的 runtime，不依赖系统 Node.js。

## 推荐流程：把一句指令交给 Codex

1. 打开一个 conflict；
2. 在 **Your representative** 中点击 **Connect Codex**；
3. 点击 **Copy instruction for Codex**；
4. 把整句指令粘贴到本地 Codex task 中。

指令会让 Codex 调用 `load_workspace_dependencies`，然后只使用它返回的 `node executable`。在真正运行前，Codex 必须用 `sandbox_permissions: "require_escalated"` 请求一次只访问 ResolveRoom origin 的网络权限；用户需要在 Codex 中批准该请求。这个步骤很重要：Codex 的受限命令沙箱可能返回 `ENOTFOUND`，即使同一个网页可以在浏览器正常打开。权限批准后，bundled Node 会从 ResolveRoom 自己的 HTTPS origin 下载 bootstrap 和自包含 Runner bundle，逐一校验 SHA-256，并从私有临时目录执行。整个流程不会访问 GitHub 或 npm registry，也不会调用 npm、npx、pnpm、curl 或系统 Node.js。如果 Codex 误在受限沙箱中运行，bootstrap 会返回 `network_access_required` 和 `pairing_consumed: false`；批准网络权限后可以安全地用完全相同的参数重试。网页提供的是可机器读取的 Node JSON 参数数组；安装器会在消费一次性配对码之前验证本机 ChatGPT/Codex executable 可以启动。

Codex 运行后会把 `rr_agent_…` credential 直接存入 macOS Keychain，不会在终端输出它。Windows 和 Linux 使用权限为 `0600` 的用户配置文件。安装器会把正在工作的 bundled Node runtime 复制进 ResolveRoom 的私有 Runner 目录，再安装后台服务并主动连接 ResolveRoom；之后即使系统 Node.js 损坏或升级，Runner 也不受影响。网页会自动显示 **Runner online**。

配对码不是长期 credential：它仅能使用一次、十分钟后过期，生成新码会立即撤销之前尚未使用的码。URL 末尾有没有 `/` 都可以，CLI 会自动规范化。

## 网页如何告诉你 Runner 是否可用

Agents 页面和 conflict 右侧状态卡会显示：

- **Online**：Runner 已连接，网页可以主动派发下一回合；
- **Working**：Runner 正在处理当前回合；
- **Reconnecting**：短暂掉线，后台服务正在自动重试；
- **Reconnect required**：超过健康窗口仍未恢复，需要重新连接。

状态卡同时显示设备名、provider 和最后在线时间。Runner 不在线时，Ready 按钮不会误导用户进入一个无法推进的回合；页面会直接提供 **Reconnect Runner** 指令。

## 连接以后怎样工作

双方保存 private brief 并各自点击 Ready 后，ResolveRoom 会把当前回合放入持久任务队列，通过 Runner 的出站 WebSocket 主动触发正确一方。Runner 读取授权上下文，只使用 `allowed_actions`，提交后等待服务器派发下一回合。浏览器可以关闭；只要本机后台 Runner 在线，对话就会继续。

不再需要用户手动运行 `tasks`、`context`、`act` 或 `wait`。这些命令只作为自定义 runtime 的开发/诊断接口保留。

## 断线与重连

短暂网络变化会指数退避自动重连，未完成回合保存在 Durable Object 中并用同一个 request ID 重试。若页面显示 **Reconnect required**：

1. 打开 conflict 或 Agents 页面，点击 **Reconnect Runner**；
2. 复制新的单次指令给 Codex；
3. Codex 执行 `connect` 后会替换旧凭证并重装/重启后台服务；CLI 会直接输出已脱敏的结构化结果，不需要再用 shell 包装、重定向或解析日志；
4. 等页面变为 **Online** 再点击 Ready（已开始的 conflict 会自动继续排队任务）。

如需检查或重启已有配置，请在 conflict 页面重新打开 **Reconnect Runner**，把当前 recovery instruction 交给同一台电脑上的 Codex。它会使用同源 bundle 和已经安全保存的 credential，不需要 package manager，也不需要新配对码。

如果本地 credential 已经失效，`runner reconnect` 会明确提示回网页生成新配对指令，而不会要求用户手工复制 credential。

## Developer options：自定义 Agent runtime

仓库开发者仍可通过源码 CLI 使用以下底层命令：

```bash
npm run agent -- tasks --origin https://resolveroom.wedosodavid.workers.dev
npm run agent -- wait 3600 --origin https://resolveroom.wedosodavid.workers.dev
npm run agent -- context <conflict-id> --origin https://resolveroom.wedosodavid.workers.dev
printf '%s' '<response>' | npm run agent -- act <conflict-id> <allowed-action> <stable-request-id> --origin https://resolveroom.wedosodavid.workers.dev
```

只有自行开发 Agent runtime 时才需要进入 `/agents` 手动创建身份和签发长期 API credential。仓库开发者也可以运行：

```bash
npm run agent:configure
npm run agent -- tasks
```

完整机器可读协议位于：

- `/.well-known/resolveroom-agent.json`：配对发现文档；
- `/openapi.json`：REST API contract。

不要把 `rr_agent_…` credential 放进聊天、截图、GitHub、日志或 shell history。Runner 必须先检查 `your_turn`，并且只能提交 `allowed_actions` 中的动作。重新配对会撤销旧凭证并断开旧 Runner，避免同一 Agent 留下多把长期有效密钥。
