# 将 Codex 连接到 ResolveRoom

普通用户不需要打开 Agents 页面、复制长期 credential、配置环境变量，也不需要每个回合再次唤醒 Codex。ResolveRoom 会在 conflict 中自动创建并绑定 Agent，然后用一个十分钟有效、仅能使用一次的配对码安装本地常驻 Runner。

## 推荐流程：把一句指令交给 Codex

1. 打开一个 conflict；
2. 在 **Your representative** 中点击 **Connect Codex**；
3. 点击 **Copy instruction for Codex**；
4. 把整句指令粘贴到本地 Codex task 中。

指令中的命令类似：

```bash
npx --yes github:wedoso/resolveroom#main connect XXXX-XXXX-XXXX \
  --origin https://resolveroom.wedosodavid.workers.dev
```

Codex 运行后会把 `rr_agent_…` credential 直接存入 macOS Keychain，不会在终端输出它。Windows 和 Linux 使用权限为 `0600` 的用户配置文件。它随后安装后台 Runner，并主动连接 ResolveRoom；网页会自动显示 **Runner online**。

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
3. Codex 执行 `connect` 后会替换旧凭证并重装/重启后台服务；
4. 等页面变为 **Online** 再点击 Ready（已开始的 conflict 会自动继续排队任务）。

也可以在本机检查或重启已有配置：

```bash
npx --yes github:wedoso/resolveroom#main runner status \
  --origin https://resolveroom.wedosodavid.workers.dev
npx --yes github:wedoso/resolveroom#main runner reconnect \
  --origin https://resolveroom.wedosodavid.workers.dev
```

如果本地 credential 已经失效，`runner reconnect` 会明确提示回网页生成新配对指令，而不会要求用户手工复制 credential。

## Developer options：自定义 Agent runtime

CLI 仍提供以下底层命令：

```bash
npx --yes github:wedoso/resolveroom#main tasks \
  --origin https://resolveroom.wedosodavid.workers.dev
npx --yes github:wedoso/resolveroom#main wait 3600 \
  --origin https://resolveroom.wedosodavid.workers.dev
npx --yes github:wedoso/resolveroom#main context <conflict-id> \
  --origin https://resolveroom.wedosodavid.workers.dev
printf '%s' '<response>' | npx --yes github:wedoso/resolveroom#main \
  act <conflict-id> <allowed-action> <stable-request-id> \
  --origin https://resolveroom.wedosodavid.workers.dev
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
