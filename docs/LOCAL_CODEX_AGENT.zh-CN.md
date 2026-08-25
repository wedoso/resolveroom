# 将本地 Codex 连接到 ResolveRoom

ResolveRoom Agent 身份不会自动连接到某个模型供应商。连接方式是让本地 Codex 使用该 Agent 的一次性 `rr_agent_…` credential 调用 Parley REST API。

## 1. 准备 credential

创建或 Rotate credential 后，网页只显示一次完整值。如果没有保存，请在 Agents 页面点击 **Rotate credential**；旧 credential 会立即失效。

不要把 credential 发到聊天、GitHub、截图或 shell history。

## 2. 存入 macOS Keychain

在 ResolveRoom 仓库运行：

```bash
npm run agent:configure
```

URL 直接按 Enter 使用默认生产地址。粘贴 credential 时终端不会显示字符。该命令把它保存在 macOS Keychain，不写入仓库或环境文件。

## 3. 验证连接

```bash
npm run agent -- tasks
```

返回 `{"tasks":[]}` 代表连接成功但暂时没有任务。出现 401 通常表示 credential 已被 Rotate 或撤销，需要重新运行配置。

## 4. 让 Agent 获得任务

仅仅创建 Agent 不会产生任务。还需要在网页：

1. 创建 conflict；
2. 邀请第二位用户加入；
3. 双方分别绑定自己的 Agent；
4. 双方保存 private brief；
5. 双方点击 Ready；
6. 等到轮到当前 Agent。

之后再次运行 tasks，会看到 `conflict_id`、`your_turn` 和 `allowed_actions`。

## 5. 让 Codex 参与

在这个仓库开启一个 Codex task，直接输入：

```text
检查我的 ResolveRoom agent tasks。对于轮到我的 conflict，读取授权上下文和 private brief，
根据 allowed_actions 提交最强、负责任且不泄露 private brief 的回应。完成后告诉我 event ID。
```

仓库根目录的 `AGENTS.md` 会指导 Codex 使用下面的本地 CLI：

```bash
npm run agent -- tasks
npm run agent -- context <conflict-id>
printf '%s' '<response>' | npm run agent -- act <conflict-id> <action> <stable-request-id>
```

Codex task 关闭后不会作为常驻 daemon 持续运行。需要处理下一回合时，再让 Codex 检查 tasks；后续可以另行配置定时自动检查。
