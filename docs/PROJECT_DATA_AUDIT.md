# Sakura Cactus 项目数据审查

审查时间：2026-07-16
分支：`codex/project-audit-data-portability`
基线：`main` 已包含文章硬删除、`migrations/0009_hard_delete_posts.sql`、历史媒体候选表和补偿清理脚本。

本轮只执行阶段 A：代码审查、本地迁移验证和项目现有检查。没有执行 push、deploy、远程 D1 migration、远程 R2 操作或 secret/config 修改。

## 阶段结论

未发现 P0 数据一致性、安全或内容生命周期问题。

存在一个影响导入导出的未解决 P1 产品决策点：`archived` 是当前真实产品状态，不是历史残留。后台“取消发布”会写入 `archived`，数据库 schema、类型、service 和 UI 都保留该状态。任务要求如果阶段 A 证明 `archived` 是真实产品功能，必须说明是否属于可导出内容并等待明确产品决定。因此本轮停止在阶段 A，不进入阶段 B。

建议的阶段 B 前置决定：确认 `archived` 是否完全不进入“博客数据文件”，或是否需要作为独立可选范围/显式状态导入导出。不得把 `archived` 或 `draft` 静默转成 `published`。

## 1. 当前真实文章状态模型

`posts.status` 当前合法值为：

- `draft`
- `published`
- `archived`

依据：

- `src/lib/database.types.ts` 的 `PostStatus`
- `src/features/posts/post.schema.ts` 的 `POST_STATUSES`
- `src/lib/schema.ts` 的新建 schema
- `migrations/0009_hard_delete_posts.sql` 的重建表约束

`posts.visibility` 当前合法值为：

- `public`
- `private`

公开文章查询的真实条件是 `status = 'published'`、`visibility = 'public'`、`published_at IS NOT NULL` 且 `published_at <= now`。后台列表可以按 status/visibility 过滤，但不再有 `includeDeleted`。

重要字段语义：

- `slug`：文章公开路径标识，表级唯一约束；`about` 是关于页保留 slug。
- `title`：必填，最多 200 字符。
- `excerpt`：摘要，可空，最多 500 字符。
- `content_markdown`：正式保存的 Markdown 原文，最多 200,000 字符。
- `content_html`：由服务端 Markdown 渲染器生成，可重建，不应作为导出权威数据。
- `cover_asset_id`：可空封面资源外键，删除 asset 时 `ON DELETE SET NULL`。
- `published_at`：公开查询必须存在且不晚于当前时间；首次发布时可自动写入。
- `pinned_at`：置顶排序字段。
- `seo_title`、`seo_description`：由当前保存逻辑从 title/excerpt 派生。
- `reading_time_minutes`、`word_count`：由 Markdown 内容计算，可重建。

## 2. draft、archived、deleted 的实际情况

`draft` 仍由当前产品实际使用：

- 新建文章默认保存为 draft。
- 关于页编辑器首次打开时会创建 draft about 占位。
- 公开查询不会返回 draft。

`archived` 仍由当前产品实际使用：

- `unpublishAdminPost()` 将文章状态设置为 `archived`。
- 后台取消发布 API 使用该 service。
- about 页面会识别 archived 并向管理员显示状态提示。
- schema、migration、TypeScript 类型均保留该状态。

`deleted` 已从运行时文章模型和新 schema 中移除：

- 新 `posts` 约束不允许 `deleted`。
- `PostStatus` 不包含 `deleted`。
- 文章 repository/service/API 不存在 `includeDeleted`、restore 或 soft-delete 分支。
- `deleted_at/status = 'deleted'` 只存在于历史 migration、0009 升级清理、测试和资产模型中。

注意：`assets` 仍有独立的软删除模型，这是媒体管理现有设计，不等同于文章软删除。

## 3. 临时纸页与 D1 内容边界

新文章未正式保存前只存在当前浏览器 localStorage：

- key：`sakura-cactus:temporary-paper`
- `postId` 为 `null`
- 有 24 小时过期时间
- 不进入 D1，因此导出无法访问

已保存文章的本地未提交修改也只存在当前浏览器 localStorage：

- key 前缀：`sakura-cactus:writer:post:`
- 具体 key：`sakura-cactus:writer:post:<postId>`
- 不进入 D1，不能导出

正式进入 D1 的路径：

- `POST /api/admin/posts` 创建文章记录。
- `PUT /api/admin/posts/:id` 更新现有文章。
- `collectPost()` 成功保存后会清除对应 localStorage autosave。
- 删除文章成功后会清除对应 autosave 并离开编辑页。

## 4. 关于页模型

关于页是 `posts.slug = 'about'` 的特殊文章。

读取行为：

- 公开 about：`getPublicAboutPost()`，只返回 published/public/current 的 about。
- 管理员 about：`getAdminAboutPost()`，可读取任意状态的 about 供管理员查看。
- 普通 `/about` 页面不会主动创建 about；管理员已登录时会读取后台 about 作为兜底显示。

写入行为：

- `/write?type=about` 调用 `ensureAdminAboutPost()`。
- 如果不存在 about 记录，会创建一个标题为“关于我”、内容为空、状态为 `draft`、visibility 为 `public` 的 D1 占位记录。
- 发布 about 使用普通文章保存/发布路径。
- 删除 about 使用普通文章永久删除路径，前端成功后跳转 `/about?fresh=1`。

风险：打开 about 编辑器会创建空 draft 占位。这是当前真实行为，不影响阶段 A 对硬删除的判断；阶段 B 导出必须只包含已发布且有真实内容的 about。

## 5. 文章永久删除调用链

完整调用链：

`DELETE /api/admin/posts/:id`
-> `deleteAdminPost(id)`
-> `listAssetsForPost(db, id)`
-> `deletePostPermanently(db, id)`
-> `refreshAssetUsageCounts(db, assetIds)`
-> `cleanupUnreferencedPostAssets(db, post.id, assets)`

关键语义：

- 删除前先读取文章快照和候选资产。
- D1 删除使用 batch，顺序删除 `post_tags`、`post_assets`、`post_view_counts`、`posts`。
- 主记录删除是 `DELETE FROM posts WHERE id = ?`。
- 检查 `posts` 删除影响行数：0 行表示不存在，1 行表示成功，其他情况抛错。
- 删除后再次读取确认文章行已不存在。
- 删除不存在文章返回 `null`，API 返回 404。

## 6. D1 关联清理

文章相关关系：

- `post_tags.post_id -> posts.id ON DELETE CASCADE`
- `post_assets.post_id -> posts.id ON DELETE CASCADE`
- `post_view_counts.post_id -> posts.id ON DELETE CASCADE`
- `posts.cover_asset_id -> assets.id ON DELETE SET NULL`

运行时删除同时显式删除：

- `post_tags`
- `post_assets`
- `post_view_counts`
- `posts`

不会删除可复用主体：

- `tags` 不随文章删除。
- 被其他文章引用的 `assets` 不删除。
- 作为其他文章封面的 `assets` 不删除。

0009 migration 会永久删除历史软删文章，并在删除关系前把历史候选资产保存到 `historical_post_asset_cleanup_candidates`。

## 7. R2 生命周期

现有媒体系统能力：

- 私有 R2 bucket。
- `/i/<token>` 代理读取。
- 安全随机 `token` 和 `r2_key`。
- `assets` 元数据。
- `post_assets` 正文引用关系。
- `cover_asset_id` 封面引用。
- SHA-256 去重。
- 正文图片提取。
- `usage_count` 统计正文和封面引用。
- 未保存上传清理、过期 draft asset 清理、历史候选补偿清理。

生命周期：

1. 管理员上传图片，校验 MIME、扩展名和文件头。
2. 计算 SHA-256，复用相同图片；否则写 R2 后创建 `assets` 记录。
3. 编辑器插入 `asset:<token>` Markdown。
4. 保存文章时提取 `asset:` 或 `/i/` token，刷新 `post_assets`。
5. published/public 文章使用的图片会被标记 public。
6. 读取图片时 `/i/[token]` 根据 asset 可见性和是否被公开文章使用决定是否允许匿名访问。
7. 更新文章会替换正文引用并清理不再引用的旧 draft asset。
8. 永久删除文章后重新检查正文和封面引用。
9. 无任何文章引用时，删除 R2 对象并物理删除 `assets` 记录。
10. R2 删除失败时记录错误，保留 `assets` 记录，不改变文章删除 API 成功语义。

共享保护：

- `isAssetReferencedByAnyPost()` 同时检查 `post_assets` 和 `posts.cover_asset_id`。
- 共享正文图片不会被删除。
- 共享封面不会被删除。
- 没有 `post_assets` 关系、仅作为封面的独占资源也会被纳入删除候选。

历史补偿：

- `historical_post_asset_cleanup_candidates` 只保存 `asset_id` 和 `created_at`，不保存正文、标题、slug 或恢复数据。
- 补偿脚本只处理候选表，不扫描普通临时上传。
- 处理前重新检查 `post_assets` 和 `posts.cover_asset_id`。
- 仍被引用则删除候选任务并保留资源。
- 无引用且 R2 删除成功后，物理删除 `assets` 和候选任务。
- R2 删除失败时保留 `assets` 和候选任务，便于重试。
- 脚本模块不会自动连接远程 D1/R2。

## 8. 当前可安全导出的内容

在阶段 B 产品决定明确后，可作为安全导出基础的数据：

- 当前真实存在、`published/public`、`published_at <= now` 的文章。
- 已正式发布且有真实内容的 about 页。
- 这些文章实际使用的标签和文章-标签关系。
- 这些文章 Markdown 中实际引用的站内 R2 图片。
- 这些文章的 `cover_asset_id` 封面资源。
- 同一媒体按 asset/token/SHA-256 去重。
- 已公开展示的友链可作为默认安全范围。

导出时应以 Markdown 为内容权威，导入时用当前服务端渲染器重新生成 `content_html`。

## 9. 当前不得导出的内容

不得导出：

- localStorage 临时纸页。
- 已发布文章的本地未提交 autosave。
- draft 文章。
- archived 文章，除非产品明确决定纳入并定义语义。
- 已永久删除文章。
- 历史 `deleted` 状态。
- 内部数据库主键。
- `content_html`。
- `post_view_counts`。
- session、cookie、CSRF token。
- 管理员账号、密码哈希、secret、环境变量。
- Cloudflare account/binding/id、R2 key、D1/R2 配置。
- rate limits、audit logs、cache、日志。
- `historical_post_asset_cleanup_candidates`。
- site settings。
- 普通临时上传、孤立媒体、已删除媒体、系统默认资源。

## 10. 数据导入导出的阻塞点

P1 阻塞：`archived` 导出语义未确认。

原因：

- `archived` 是当前真实产品功能。
- 任务明确要求确认其是否属于可导出内容并等待产品决定。
- 如果直接忽略 archived，可能不符合“数据可迁移/恢复”的用户预期。
- 如果静默导出或导入为 published，会改变可见性和内容生命周期。

进入阶段 B 前需要明确：

- `archived` 是否完全排除在博客数据文件外。
- 如果纳入，UI 是否需要单独选项。
- 导入时是否保留 `archived` 状态，以及目标实例后台是否可见。

## 11. 测试缺口

已有覆盖：

- 文章硬删除 service。
- 删除 API 在 R2 清理失败时仍成功。
- R2 失败日志包含 postId/assetId/r2Key。
- 独占正文图片和独占封面清理。
- 共享正文图片和共享封面保护。
- 删除不存在文章返回不存在。
- 更新文章仍更新原记录。
- draft/published 查询不受影响。
- 0009 migration 列、约束、索引、外键、候选表。
- 历史候选补偿幂等性。
- 前端删除成功路径的 autosave 清理静态检查。
- 安全基础检查：URL、限流、重定向、上传校验、Markdown HTML 清理。

本轮补充的本地审计：

- 空数据库顺序执行 `0001` 到 `0009` 成功。
- 带历史软删数据的 `0008 -> 0009` 升级成功。
- `PRAGMA foreign_key_check` 通过。
- `PRAGMA integrity_check` 通过。
- 历史软删文章的 `post_assets` 和 `cover_asset_id` 在删除前进入候选表。
- 普通临时无引用 asset 不进入历史候选表。

缺口：

- 尚无真实浏览器 E2E 覆盖 localStorage 与删除跳转，仅有静态断言。
- 尚无导入导出功能测试，因为阶段 B 未开始。
- 尚无 R2 对象存在性全量审计；D1 无法证明所有 `assets.r2_key` 在 R2 中真实存在。
- 尚无 R2 中无 D1 记录对象的反向审计；需要 R2 listing 才能确认。
- 0009 migration 是一次性 D1 migration，不设计为手工重复执行；重复运行历史 migration 文件可能失败，生产迁移系统应只执行一次。

## 12. 风险分级

P0：无。

P1：

- `archived` 是真实产品状态，但导出/导入语义未由产品确认。阶段 B 暂停。

P2：

- about 编辑器首次打开会创建空 draft D1 占位。导出必须过滤掉未发布或无真实内容的 about。
- 缺少浏览器级 localStorage/autosave E2E。阶段 B UI 实现时应补充。
- D1 只能保存 R2 元数据，不能证明 R2 对象一定存在；导出媒体时必须逐个读取 R2 并在缺失时给出明确错误。

P3：

- `TODO.md` 仍有关于旧 soft deletion 写作流程的过时描述，应后续清理。
- `pnpm.cmd check` 有既有 deprecation hints：`React.FormEvent` 和 `document.execCommand`。

## 验证结果

已执行：

- `git status --short`：开始时工作区干净。
- `git branch --show-current`：开始于 `main`。
- `git log -12 --oneline --decorate`：`main` 包含文章永久删除提交。
- `git remote -v`：origin 指向 `https://github.com/mx-love/Sakura-Cactus.git`。
- `git pull --ff-only`：Already up to date。
- `git switch -c codex/project-audit-data-portability`：已创建并切换。
- 本地 migration 审计：通过。
- `pnpm.cmd exec tsc --noEmit --pretty false`：通过。
- `pnpm.cmd check`：通过，只有既有 deprecation hints；沙箱内因 Wrangler 写用户目录失败，已按权限规则非沙箱重跑。
- `pnpm.cmd test:posts`：通过。
- `pnpm.cmd test:security`：通过。
- `pnpm.cmd build`：通过。
- `git diff --check`：通过。
- 新增审查文档 no-index whitespace 检查：通过。
