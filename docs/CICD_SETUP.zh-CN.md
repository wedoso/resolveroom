# ResolveRoom GitHub → Cloudflare CI/CD 配置

仓库已经包含两条 GitHub Actions：

- **CI**：在 Pull Request、推送到 main、手动运行时执行格式、lint、类型检查、单元/集成测试、生产构建、Chromium/WebKit 浏览器 E2E、无障碍检查和依赖审计。
- **Deploy production**：在推送到 main 或手动点击 **Run workflow** 时，校验生产配置、重跑 release gates、检查 Worker bundle、执行 D1 与 Durable Object 迁移、同步 Worker secrets、部署并检查健康端点、OpenAPI 和首页。

部署 Job 使用 GitHub 的 `production` Environment。建议设置 required reviewer；这样自动推送到 main 后仍需要批准，手动触发也会留下 deployment history。

## 一、注册和准备账号

1. 注册 [Cloudflare](https://dash.cloudflare.com/sign-up)，验证邮箱并开启两步验证。
2. 确认 GitHub 仓库默认分支是 `main`，并启用 GitHub Actions。
3. 在 Cloudflare Workers & Pages 中启用 `workers.dev` 子域。应用名称固定为 `resolveroom`，初始地址通常是：

   ```text
   https://resolveroom.<你的-workers.dev-子域>.workers.dev
   ```

   也可以使用自己的 HTTPS 域名；最终只能选择一个准确 origin 作为 `PUBLIC_APP_URL`。

## 二、创建 Cloudflare D1

在本地完成一次交互式登录和建库：

```bash
npx wrangler login
npx wrangler d1 create resolveroom
```

保存命令返回的完整 `database_id`（Cloudflare 当前可能返回带连字符的 UUID）。不要修改并提交 `wrangler.toml` 里的占位符；CI 会用 GitHub Environment Variable 生成临时 `wrangler.deploy.toml`，该文件已被 git 忽略。

同时在 Cloudflare Dashboard 复制 32 位 **Account ID**。

## 三、创建最小权限 Cloudflare API Token

Cloudflare Dashboard → **Manage Account → API Tokens → Create Token**：

1. 以官方 **Edit Cloudflare Workers** 模板开始。
2. 确保目标 Account 有 **Workers Scripts: Edit** 和 **D1: Edit**。
3. Resource 只选择部署 ResolveRoom 的 Cloudflare Account。
4. 当前流水线不需要 DNS 编辑权限；以后让 Wrangler 管理自定义域名/路由时再按需增加 Zone 权限。
5. 创建后立即保存 token；Cloudflare 只显示一次。

## 四、至少配置一个生产 OAuth

生产环境禁用开发登录，所以必须配置 Google 或 GitHub 至少一个。最省事的是 GitHub OAuth App：

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**。
2. Homepage URL 填 `PUBLIC_APP_URL`。
3. Authorization callback URL 精确填写：

   ```text
   https://你的域名/api/v1/auth/oauth/github/callback
   ```

4. 保存 Client ID，并生成 Client Secret。

Google OAuth 的回调地址是：

```text
https://你的域名/api/v1/auth/oauth/google/callback
```

OAuth 域名必须和 `PUBLIC_APP_URL` 完全一致；切换自定义域名后要同时更新两处。

## 五、配置 GitHub production Environment

GitHub 仓库 → **Settings → Environments → New environment**，名称必须是 `production`。建议启用 required reviewers，并只允许 main 分支部署。

在该 Environment 的 **Variables** 添加：

| Variable | 值 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 32 位 Account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | Cloudflare 返回的完整 resolveroom D1 database ID |
| `PUBLIC_APP_URL` | 最终 HTTPS origin，不带尾部斜杠 |
| `JUDGE_PROVIDER` | `disabled`；使用 Cloudflare 每日免费额度填 `workers_ai`；自备外部 Responses API 填 `llm` |
| `EMAIL_PROVIDER` | 初次部署填 `console` |

在 **Environment secrets** 添加：

| Secret | 必需性 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 必需 |
| `RESOLVEROOM_GITHUB_CLIENT_ID` + `RESOLVEROOM_GITHUB_CLIENT_SECRET` | 使用 GitHub 登录时成对必需 |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | 使用 Google 登录时成对必需 |
| `JUDGE_API_URL` + `JUDGE_API_KEY` + `JUDGE_MODEL` | 仅 Judge 设为 `llm` 时必需 |
| `EMAIL_API_URL` + `EMAIL_API_KEY` + `EMAIL_FROM` | 仅 Email 设为 `http` 时必需 |

GitHub OAuth 的 secret 名故意带 `RESOLVEROOM_` 前缀，避免和 Actions 自带的 `GITHUB_TOKEN` 混淆；部署时会映射回 Worker 所需名称。

使用 `workers_ai` 时无需新增 Judge secrets。CI 自动添加 `AI` binding，模型固定为 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`。额度和开启步骤见 [AI Judge 配置](JUDGE_SETUP.zh-CN.md)。房间仍需明确选择 AI Judge 模式；已有记录不会自动外发。

流水线把这张表视为受管 Secret 清单：有值的会通过 stdin 更新，没有值的会从 Worker 删除，避免关闭 provider 后遗留旧凭证。Secret 值不会写入文件或命令参数。

## 六、触发首次部署

1. 把仓库推送到 GitHub。
2. 打开 **Actions → Deploy production → Run workflow → Run workflow**。
3. 如果设置了 Environment reviewer，在等待阶段点击批准。
4. Job 会自动执行 D1 migration、secret 同步、Worker 部署和线上 smoke test。

本次 Runner 架构新增的 `AGENT_RUNNERS` Durable Object 及其 SQLite class migration 已写入 `wrangler.toml`，会随同一部署自动创建；不需要新增 GitHub Variable 或 Secret。部署完成后，旧版已经配对的用户需要在网页中执行一次 **Reconnect Runner**，以安装常驻服务并建立新的实时连接。

推送到 main 也会触发同一流水线。生产部署串行执行，不会让两个 migration/deploy 同时运行。

## 七、请带回给 Codex 的信息

不要把 secret/token 的值直接发在聊天里。完成后只需要告诉我：

- GitHub 仓库地址；
- 已创建 `production` Environment；
- 已设置的 Variable/Secret **名称清单**，不要给值；
- 选用的 `PUBLIC_APP_URL`；
- 选用 GitHub OAuth、Google OAuth，还是两者；
- 首次 Actions run 链接，或失败步骤的日志（确认日志里没有密钥）。

流水线会在修改远程数据库前检查缺失/错误配置。D1 migration 由 Wrangler 在 CI 中自动备份并以事务方式应用；失败的 migration 会回滚。
