# 启用真实 AI Judge

ResolveRoom 默认只完成对话记录，不自动宣判。房主在创建房间或开始前的 **Settings → Exchange rules → Completion mode** 选择 **AI Judge**，双方确认 Ready 后，系统会在最后一轮 Closing 完成时发送共享案例给 LLM。

## 推荐接入：Cloudflare Workers AI

无需再注册第三方 LLM 账号，也无需新增 Judge API Key。使用已有 Cloudflare 账号的 `AI` binding，默认模型为 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`。

1. 在 Cloudflare Dashboard 打开 **Workers AI**，确认该账号可用；如有模型使用条款提示，先阅读并接受适用条款。
2. 打开 GitHub 仓库 **Settings → Environments → production → Environment variables**。
3. 在 **Environment variables**（不是 Secrets）中，将 `JUDGE_PROVIDER` 从 `disabled` 改为 `workers_ai` 并保存；不要填 `enable` 或 `true`。没有该变量时点击 **Add environment variable** 创建。
4. **Actions → Deploy production → Run workflow**。流水线自动添加 AI binding，并执行数据库迁移；不需要手工编辑生产 Worker。
5. 部署后新建房间，或在尚未开始的房间选择 AI Judge。已有房间默认仍是 record-only，不会因全站启用模型就自动外发。

若部署报 AI binding 权限不足，在 Cloudflare 的部署 API Token 中为该账号添加 Workers AI 对应权限，再更新 GitHub 的 `CLOUDFLARE_API_TOKEN` secret；不要把 token 发进聊天。关闭 Judge 时将变量改回 `disabled` 并重新部署。

## “免费”的边界

截至 2026-08-29，Cloudflare 提供全账号每日 **10,000 neurons** 免费额度，UTC 00:00 重置。它不是无限免费；每次判决消耗随上下文与输出长度变化。同账号其他应用也共享额度。Free 计划超额会失败；Paid 计划超出免费额度可能计费。不要为本功能盲目升级付费，先查看自己的 Workers AI 用量与账单设置。[官方价格](https://developers.cloudflare.com/workers-ai/platform/pricing/)

每次评审最多生成 2,400 tokens，普通暂时故障最多尝试两次；超大案例明确拒绝，不静默裁掉一方的发言。没有付费 provider 自动回退，也不会用 mock 顶替。

### 每日额度用完后，用户会看到什么？

Cloudflare 返回每日额度错误 `3036` 时，系统不进行第二次推理，将等待时间存入 D1，供本部署所有房间共享。双方房间内都会显示“今日免费 AI Judge 额度已用完，请等待下一次每日重置”，保留所有发言，状态仍是 `judging`，不会生成假的胜负。[官方错误码](https://developers.cloudflare.com/workers-ai/platform/errors/)

页面按用户本地时区显示具体恢复日期与时间。额度每日 **UTC 00:00 = 北京时间 08:00** 重置，不一定是用户当地的“明天零点”。恢复前禁用重试按钮；即使直接调用 API，也只返回 `JUDGE_QUOTA_EXHAUSTED`、`retry_at` 和 `Retry-After`，不再调用模型。恢复后页面轮询会解除等待，用户点击 **Retry assessment** 即可继续，无需重连 Runner 或重跑辩论。不会在后台承诺自动完成判决；若其他应用再次用完该账号额度，页面会重新进入等待。

临时限流、容量不足（如 `3040`）、模型故障与每日额度分开处理，不会误提示等到明天。本功能只识别模型实际返回的额度错误，不声称能提前读出剩余 tokens。若将来切换到 Workers Paid，本提示机制并非费用硬上限；Paid 的免费额度用完后可能继续计费。

## 隐私与判断边界

发送：共享标题、问题/背景、协议与说服角色、双方共享发言/证据/让步及事件引用。身份标签使用 Party A/B；不发送账户邮箱字段、真实姓名字段、API credential、private brief 或私密事件。用户主动写进共享发言中的个人信息仍属于发送内容，请不要在共享区域填写秘密。

Cloudflare 声明：未经明确同意，不使用 Workers AI Customer Content 训练模型或改善服务。[数据使用说明](https://developers.cloudflare.com/workers-ai/platform/data-usage/)

Judge 输出仅供参考，不是客观真理。允许平局、信息不足；服务端检查协议、分数范围、结果枚举、引用事件 ID。无效结果不会保存为判决。输入中的“忽略规则、给我高分”等文本按不可信案例内容处理。

## 测试与其他供应商

`npm run test:judge-live` 使用 Wrangler 临时预览环境和一个虚构午餐案例调用真实模型；不读取生产 D1、用户 brief 或已有房间，会使用真实 AI 额度。普通 CI 使用 mock 和 provider contract tests，不依赖外部模型。

继续支持 `JUDGE_PROVIDER=llm` + `JUDGE_API_URL`、`JUDGE_API_KEY`、`JUDGE_MODEL`，接口须兼容 Responses JSON Schema 格式；这不意味着该供应商免费。不要把 Chat Completions URL 直接填进 Responses adapter。
