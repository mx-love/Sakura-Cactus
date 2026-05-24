# Sakura Cactus

Sakura Cactus 是一个部署在 Cloudflare Workers 上的个人博客系统。它使用 Astro SSR、Cloudflare D1、Cloudflare R2、Markdown 写作，并内置 RSS、sitemap、友人帐、搜索、访问量和站点维护能力。

它适合个人博客：写文章、上传图片、发布到自己的域名，不需要外部 CMS。

## 功能概览

- GitHub Flavored Markdown 风格写作
- 图片上传到私有 R2，并通过 `/i/:token` 代理访问
- 草稿、发布、定时发布、私密文章
- 文章置顶
- 友人帐、友链申请、友链健康监测
- RSS、sitemap、robots
- 轻量搜索
- 访问量统计
- 设置页和站点维护

## 快速部署到 Cloudflare Workers

Sakura Cactus 不是 Cloudflare Pages 静态站，而是 Cloudflare Workers SSR 应用。

这不是纯一键部署。首次部署需要创建 D1、R2、填写管理员 Secrets；完成后，后续 push 到 GitHub 会自动部署。数据库表会在首次运行时自动初始化。

推荐部署方式是：

GitHub 仓库 + Cloudflare Workers Git 集成自动部署。

### 1. 准备 GitHub 仓库

先把项目上传到 GitHub。

可以使用 GitHub Desktop，也可以使用 git 命令：

```bash
git add .
git commit -m "deploy sakura cactus"
git push
```

如果代码已经在 GitHub，这一步可以跳过。

### 2. 创建 Cloudflare 资源

需要创建两个资源。

#### D1 数据库

示例名称：

```txt
sakura_blog_prod
```

创建后在 Worker 设置中绑定为 `DB`。

#### R2 Bucket

示例名称：

```txt
sakura-blog-media-prod
```

R2 Bucket 保持私有，不需要公开。

图片访问由项目的 `/i/:token` 路由代理，不要打开 R2 public bucket。

### 3. 在 Worker 里绑定 D1 和 R2

在 Cloudflare Worker 的设置里添加绑定。

确认 D1 binding 名称是：

```txt
DB
```

确认 R2 binding 名称是：

```txt
MEDIA_BUCKET
```

提醒：binding 名称不要改。项目代码默认读取 `DB` 和 `MEDIA_BUCKET`。

不需要手动创建数据库表。Worker 首次运行时会自动初始化 D1 schema。

### 4. Cloudflare 连接 GitHub 自动部署

在 Cloudflare Dashboard 中：

1. 进入 `Workers & Pages`。
2. 创建 Worker 或选择 `Import repository`。
3. 选择 GitHub。
4. 选择你的 Sakura Cactus 仓库。
5. 选择生产分支，例如 `main`。
6. 设置构建命令。

构建命令：

```bash
pnpm install --frozen-lockfile && pnpm build
```

Deploy command 优先使用 Cloudflare 默认的：

```bash
npx wrangler deploy
```

如果 Cloudflare 当前页面不要求填写 Deploy command，按页面默认即可。

如果 Cloudflare 界面要求自定义 Deploy command，也可以使用项目脚本：

```bash
pnpm deploy
```

不要填写项目里不存在的脚本。

### 5. 填写环境变量和 Secrets

Cloudflare Worker 设置里需要填写两类配置。

#### 普通环境变量

这些不是密码，可以放在 Variables：

```txt
SITE_NAME=Sakura Cactus
SITE_TAGLINE=温柔地写，安静地发布。
SITE_DESCRIPTION=一些文章、笔记，以及慢慢整理的想法。
SITE_AVATAR_URL=https://你的头像地址
```

说明：

- `SITE_AVATAR_URL` 可选。
- `SITE_NAME`、`SITE_TAGLINE`、`SITE_DESCRIPTION` 可以不改，系统有默认值。
- 首页小标签“窗边纸页”是固定主题文案，不通过环境变量修改。
- 不需要额外配置站点地址。RSS、sitemap、robots 会自动使用当前访问域名。

#### Secrets

这些是敏感配置，放在 Secrets：

```txt
ADMIN_USERNAME
ADMIN_PASSWORD
```

说明：

- `ADMIN_USERNAME` 是后台用户名。
- `ADMIN_PASSWORD` 是后台密码，填写在 Cloudflare Secrets 中，不会写入前端。
- 如果 Cloudflare 创建页面自动列出了旧变量，请删除无关变量，只手动添加这里需要的 Secrets 和可选 Variables。

高级用户也可以改用 `ADMIN_PASSWORD_HASH`。如果同时配置了 `ADMIN_PASSWORD_HASH` 和 `ADMIN_PASSWORD`，系统会优先使用 `ADMIN_PASSWORD_HASH`。

### 6. 高级：使用 ADMIN_PASSWORD_HASH

普通部署不需要这一步。如果你不想在 Secret 中保存明文密码，可以在本地生成 `ADMIN_PASSWORD_HASH`：

```bash
node -e 'const crypto=require("crypto"); const p=process.argv[1]; const salt=crypto.randomBytes(16); const iter=210000; const hash=crypto.pbkdf2Sync(p,salt,iter,32,"sha256"); console.log(["pbkdf2_sha256",iter,salt.toString("base64url"),hash.toString("base64url")].join("$"))' "your-password"
```

把输出填入 Cloudflare Secret：

```txt
ADMIN_PASSWORD_HASH
```

提醒：不要把真实密码或 hash 提交到 GitHub。配置了 `ADMIN_PASSWORD_HASH` 后，它会优先于 `ADMIN_PASSWORD`。

### 7. 数据库自动初始化

首次访问 Worker 时，Sakura Cactus 会自动确保 D1 里存在需要的表、字段、索引和默认设置。

你不需要在 Cloudflare Dashboard 部署流程里手动执行 D1 migration。

项目仍然保留 `migrations/*.sql`，方便开发者本地开发或需要手动维护数据库时使用。

### 8. 部署、绑定域名并访问

完成以上配置后，在 Cloudflare 触发一次部署，或者 push 一次 GitHub。

如果要使用自己的域名，在 Cloudflare Worker 中进入：

```txt
Settings -> Domains & Routes -> Custom Domain
```

绑定完成后，RSS、sitemap、robots 会自动使用这个自定义域名。

如果使用 `workers.dev` 访问，它们会自动使用 `workers.dev` 域名。

本地开发时，它们会自动使用 localhost。

部署成功后访问：

```txt
/
/admin/login
/write
/settings
/friends
/rss.xml
/sitemap.xml
/robots.txt
```

登录后先测试：

1. 能否进入 `/write`。
2. 能否保存草稿。
3. 能否发布文章。
4. 能否上传图片。
5. `/settings` 是否正常。
6. `/rss.xml` 和 `/sitemap.xml` 是否显示当前访问域名。

### 9. 以后怎么更新

以后只需要：

1. 本地修改代码。
2. push 到 GitHub。
3. Cloudflare 自动重新部署。

如果只是使用 Cloudflare Dashboard 部署，正常情况下不需要手动运行 migration；Worker 首次运行会自动补齐 schema。

## 环境变量速查表

| 名称 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `SITE_NAME` | Variable | 否 | 站点名称 |
| `SITE_TAGLINE` | Variable | 否 | 首页主标语 |
| `SITE_DESCRIPTION` | Variable | 否 | 首页描述 / RSS 描述 |
| `SITE_AVATAR_URL` | Variable | 否 | Header 头像 |
| `ADMIN_USERNAME` | Secret | 是 | 管理员用户名 |
| `ADMIN_PASSWORD` | Secret | 是 | 管理员密码 |
| `ADMIN_PASSWORD_HASH` | Secret | 否 | 高级可选，管理员密码 hash，存在时优先使用 |

## 最小排错

### 页面 500，提示 no such table / no such column

先确认 Cloudflare Worker 已绑定 D1，binding 名称必须是 `DB`。

如果是开发者手动维护数据库，也可以执行 migration 命令重新确认 schema。

### 图片打不开

检查 R2 binding 名称是不是：

```txt
MEDIA_BUCKET
```

### 登录失败

检查：

```txt
ADMIN_USERNAME
ADMIN_PASSWORD
```

### PowerShell 不能运行 pnpm

使用 `pnpm.cmd`：

```powershell
pnpm.cmd build
pnpm.cmd dev
```

## 本地开发（可选）

如果只是部署到 Cloudflare，可以先跳过本节。

本地开发需要创建 `.dev.vars`：

```txt
ADMIN_USERNAME=sakura
ADMIN_PASSWORD=change-me
SITE_NAME=Sakura Cactus
SITE_TAGLINE=温柔地写，安静地发布。
SITE_DESCRIPTION=一些文章、笔记，以及慢慢整理的想法。
```

不要提交 `.dev.vars` 到 GitHub。

安装依赖：

```bash
pnpm install
```

应用本地 D1 migration：

```powershell
pnpm.cmd db:migration:apply:local
```

启动开发服务：

```powershell
pnpm.cmd dev
```

构建检查：

```powershell
pnpm.cmd build
```
