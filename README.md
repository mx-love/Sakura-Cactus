# Sakura Cactus

Sakura Cactus 是一个基于 Astro + Cloudflare Workers 的个人博客系统，包含公开博客、Markdown 写作后台、图片上传、友人帐和站点设置。

## 项目目的

Sakura Cactus 不是传统静态博客，也不是大型 CMS。

它的目标是做一个轻量、安静、适合个人长期写作的博客：

- 文章写作和发布在自己的后台完成
- Markdown 为核心
- 图片存到 Cloudflare R2
- 数据存到 Cloudflare D1
- 部署在 Cloudflare Workers
- 尽量少依赖外部服务
- 适合个人博客、笔记、随笔和长期归档

## 技术栈

| 类型 | 技术 |
| --- | --- |
| 前端框架 | Astro |
| UI 交互 | React / TypeScript |
| 部署运行 | Cloudflare Workers |
| 数据库 | Cloudflare D1 |
| 图片存储 | Cloudflare R2 |
| Markdown | unified / remark / rehype sanitize |
| 样式 | 原生 CSS |
| 包管理 | pnpm |
| 版本管理 | GitHub |

Sakura Cactus 不是 Cloudflare Pages 静态站，而是 Cloudflare Workers SSR 应用。

## 已实现功能

公开博客：

- 首页
- 文章列表
- 时间轴
- 标签
- 文章详情
- 文章目录 TOC
- RSS
- sitemap
- robots
- 搜索
- 关于页
- 友人帐

写作后台：

- 管理员登录
- Markdown 编辑
- 实时预览 / 分屏
- 保存草稿
- 发布 / 更新
- 私密文章
- 定时发布
- 置顶
- 删除
- 图片上传 / 粘贴 / 拖拽
- R2 图片生命周期管理

站点功能：

- 友链管理
- 友链申请开关
- 友链健康监测
- 评论开关占位
- 访问量开关
- favicon 外链设置
- 站点维护清理

部署体验：

- Cloudflare Dashboard 可视化部署
- D1 schema 自动初始化
- 不需要手动执行 migrations 才能首次使用
- RSS / sitemap / robots 自动使用当前访问域名
- 不需要 `SITE_URL`

## Cloudflare 快速部署

1. Fork 或上传项目到 GitHub。
2. 在 Cloudflare Workers 中连接 GitHub 仓库。
3. 创建 D1 数据库。
4. 创建 R2 Bucket。
5. 在 Worker 里绑定：
   - D1：`DB`
   - R2：`MEDIA_BUCKET`
6. 添加 Secrets：
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
7. 可选添加 Variables：
   - `SITE_NAME`
   - `SITE_TAGLINE`
   - `SITE_DESCRIPTION`
   - `SITE_AVATAR_URL`
8. 部署 Worker。
9. 绑定自定义域名。
10. 打开 `/admin/login` 登录后台。

Cloudflare 构建命令：

```bash
pnpm install --frozen-lockfile && pnpm build
```

如果 Cloudflare 界面要求填写 Deploy command，可以使用项目脚本：

```bash
pnpm deploy
```

部署注意：

- R2 Bucket 保持私有。
- 图片通过 `/i/:token` 由 Worker 代理访问。
- 不需要 R2 自定义域名。
- 不需要 `SITE_URL`。
- D1 首次访问会自动建表。

## 环境变量

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ADMIN_USERNAME` | Secret | 是 | 后台用户名 |
| `ADMIN_PASSWORD` | Secret | 是 | 后台密码 |
| `SITE_NAME` | Variable | 否 | 站点名称，默认 Sakura Cactus |
| `SITE_TAGLINE` | Variable | 否 | 首页标语 |
| `SITE_DESCRIPTION` | Variable | 否 | 首页描述 / RSS 描述 |
| `SITE_AVATAR_URL` | Variable | 否 | Header 头像 URL |

高级说明：`ADMIN_PASSWORD_HASH` 仍可作为高级方式替代 `ADMIN_PASSWORD`。如果同时配置 `ADMIN_PASSWORD_HASH` 和 `ADMIN_PASSWORD`，系统会优先使用 `ADMIN_PASSWORD_HASH`。

不要把这些值提交到 GitHub。`.dev.vars`、真实密码、Cloudflare Token、R2 密钥都应该只保存在本地或 Cloudflare Secrets 中。

## Worker Bindings

| Binding | 类型 | 说明 |
| --- | --- | --- |
| `DB` | D1 Database | 存储文章、标签、设置、友链等数据 |
| `MEDIA_BUCKET` | R2 Bucket | 存储文章图片 |
| `ASSETS` | Assets | Cloudflare 构建产物绑定，保留默认即可 |

Binding 名称不要改。项目代码默认读取 `DB` 和 `MEDIA_BUCKET`。

## 本地开发

```bash
pnpm install
pnpm dev
```

Windows PowerShell 如果拦截 `pnpm`，使用：

```powershell
pnpm.cmd dev
```

本地开发可以创建 `.dev.vars`：

```txt
ADMIN_USERNAME=sakura
ADMIN_PASSWORD=change-me
```

可选站点文案：

```txt
SITE_NAME=Sakura Cactus
SITE_TAGLINE=温柔地写，安静地发布。
SITE_DESCRIPTION=一些文章、笔记，以及慢慢整理的想法。
SITE_AVATAR_URL=https://example.com/avatar.png
```

构建检查：

```bash
pnpm build
```

Windows：

```powershell
pnpm.cmd build
```

## 数据库说明

Sakura Cactus 会在首次运行时自动初始化 D1 schema。

`migrations/*.sql` 仍然保留，方便开发者本地开发或手动维护数据库。

开发者本地迁移命令：

```powershell
pnpm.cmd db:migration:apply:local
```

## 登录后台

部署完成后访问：

```txt
/admin/login
```

登录后可以进入：

- `/write` 写文章
- `/settings` 设置
- `/friends` 管理友人帐

## 安全提示

- 不要提交 `.dev.vars`
- 不要提交 `.env`
- 不要提交真实密码
- 不要提交 Cloudflare API Token
- 不要公开 R2 Bucket
- 生产环境中 D1 和 R2 必须通过 Worker bindings 绑定

图片访问由 Sakura Cactus 的 `/i/:token` 代理完成，不需要公开 R2。
