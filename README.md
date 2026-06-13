# Sakura Cactus

Sakura Cactus 是一个基于 Astro 和 Cloudflare Workers 的个人博客系统，适合用于文章、笔记、随笔和长期归档。项目使用 Cloudflare D1 保存内容与设置，使用 Cloudflare R2 保存图片和媒体文件。

## 核心功能

- Markdown 写作后台，支持编辑、预览、发布、修订、置顶和删除
- 公开博客页面，包含首页、文章列表、文章详情、标签、时间轴、搜索、关于页和友人帐
- Cloudflare D1 存储文章、标签、设置、友链和会话数据
- Cloudflare R2 管理图片和媒体文件，支持上传、粘贴、拖拽和复用
- 站点设置、友链申请、友链健康检查、访问量开关和 favicon 外链
- [Waline](https://waline.js.org/) 评论入口，评论数据由外部 Waline 服务保存
- 支持 RSS、sitemap、robots、canonical、Open Graph 和结构化数据。
- 适配 Cloudflare Workers SSR 部署

## 技术栈

| 类型 | 技术 |
| --- | --- |
| Web 框架 | Astro |
| 交互组件 | React |
| 语言 | TypeScript |
| 运行环境 | Cloudflare Workers |
| 数据库 | Cloudflare D1 |
| 媒体存储 | Cloudflare R2 |
| 静态资源 | Cloudflare Workers Assets |
| Markdown | unified / remark / rehype |
| 样式 | Tailwind CSS / CSS |
| 包管理 | pnpm |

## 快速部署

1. Fork 项目。
2. 创建 D1 数据库，名称固定为 `sakura_blog_prod`。
3. 创建 R2 Bucket，名称固定为 `sakura-blog-media-prod`。
4. 在 Cloudflare Workers 中连接 GitHub。
5. 填写构建命令、部署命令和 Build variables。
6. 首次部署后添加后台账号密码和站点变量。
7. 配置 `SITE_URL`，按需绑定自定义域名。
8. 重新部署并访问 `/admin/login`。

Build command：

```bash
pnpm install --frozen-lockfile && node scripts/prepare-cloudflare-config.mjs && pnpm build
```

Deploy command：

```bash
npx wrangler deploy
```

Build variables：

```env
SAKURA_D1_DATABASE_ID=你的 D1 Database ID
SAKURA_R2_BUCKET_NAME=sakura-blog-media-prod
```

两项都选择“文本”。

构建脚本会自动生成 D1 和 R2 bindings，不需要在运行时变量中手动添加 `DB` 或 `MEDIA_BUCKET`。D1 首次运行会自动初始化；R2 Bucket 应保持私有，图片通过 `/i/:token` 代理访问，不需要为 R2 配置公开自定义域名。

## 环境变量

Cloudflare 中的变量值都会以字符串形式提供给 Worker。普通配置选择“文本（Text）”，密码等敏感内容选择“密钥（Secret）”。

| 名称 | 填写位置 | 必填 | 保存方式 | 说明 |
| --- | --- | --- | --- | --- |
| `SAKURA_D1_DATABASE_ID` | Git 构建设置中的 Build variables | 是 | 文本（Text） | D1 Database ID，用于构建时生成绑定 |
| `SAKURA_R2_BUCKET_NAME` | Git 构建设置中的 Build variables | 是 | 文本（Text） | R2 Bucket 名称，固定填写 `sakura-blog-media-prod` |
| `ADMIN_USERNAME` | Worker → 设置 → 变量和密钥 | 是 | 文本（Text） | 后台登录用户名 |
| `ADMIN_PASSWORD` | Worker → 设置 → 变量和密钥 | 是 | 密钥（Secret） | 后台登录密码 |
| `SITE_URL` | Worker → 设置 → 变量和密钥 | 生产建议填写 | 文本（Text） | 站点地址，包含协议，例如 `https://blog.example.com`，末尾不加 `/`；使用自定义域名时填写自定义域名，只使用 `workers.dev` 时填写自己的 Worker 地址 |
| `SITE_NAME` | Worker → 设置 → 变量和密钥 | 否 | 文本（Text） | 站点名称 |
| `SITE_TAGLINE` | Worker → 设置 → 变量和密钥 | 否 | 文本（Text） | 首页标语 |
| `SITE_DESCRIPTION` | Worker → 设置 → 变量和密钥 | 否 | 文本（Text） | 站点描述 |
| `SITE_AVATAR_URL` | Worker → 设置 → 变量和密钥 | 否 | 文本（Text） | 登录后 Header 头像地址 |
| `PUBLIC_COMMENTS_SERVER_URL` | Worker → 设置 → 变量和密钥 | 否 | 文本（Text） | 自己部署的 Waline 服务端地址 |

## 本地开发

```bash
pnpm install
pnpm dev
pnpm build
```

Windows PowerShell：

```bash
pnpm.cmd dev
pnpm.cmd build
```

## 安全说明

- 不提交 `.env` 和 `.dev.vars`
- 不提交密码、Token 或密钥
- 后台密码使用 Cloudflare“密钥”
- R2 Bucket 保持私有

## 致谢

感谢 Astro、Cloudflare Workers、Cloudflare D1、Cloudflare R2、React、unified 生态和 Waline 等项目与平台。

Sakura Cactus 是独立开发的开源项目，与 Astro、Cloudflare 及上述项目不存在官方隶属、合作或背书关系。

## License

本项目基于 [MIT License](./LICENSE) 开源。
