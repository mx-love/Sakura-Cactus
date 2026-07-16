# Sakura Cactus 项目数据审查

审查时间：2026-07-16
分支：`codex/content-lifecycle-cleanup`
阶段：阶段 1 生命周期简化后的本地审查记录。

本文件记录当前代码的数据模型。未执行 push、deploy、远程 D1 migration、远程 R2 操作或生产数据清理。

## 阶段结论

文章内容生命周期已简化为三类：

- 临时纸页：只存在当前浏览器 localStorage，不写入 D1，不进入导出。
- 已发表文章：D1 中只保存 `published` / `public` 文章。
- 永久删除：物理删除 `posts` 行，并清理文章关系；无其他文章引用的媒体进入 R2/D1 清理流程。

`draft`、`archived`、`deleted` 不再是运行时文章状态。旧服务端草稿、撤回/归档和非公开文章由 `migrations/0010_simplify_post_status.sql` 在升级时永久清理。清理前只保存相关 `asset_id` 到 `historical_post_asset_cleanup_candidates`，不保存正文、标题、slug 或恢复数据。

当前未发现阶段 3 数据导入导出的 P0/P1 阻断点；阶段 2 仍需在阶段 1 提交后重新复核。

## 1. 当前真实文章状态模型

`posts.status` 只允许：

- `published`

`posts.visibility` 只允许：

- `public`

公开查询仍要求：

- `posts.status = 'published'`
- `posts.visibility = 'public'`
- `posts.published_at IS NOT NULL`
- `posts.published_at <= now`

保留字段语义：

- `slug`：公开路径标识，唯一；`about` 是关于页单实例 slug。
- `title`、`excerpt`、`content_markdown`：公开内容源数据。
- `content_html`：兼容存储字段，读取时由当前 Markdown 渲染器重建，不作为导出权威数据。
- `cover_asset_id`：封面资源外键，`ON DELETE SET NULL`。
- `published_at`：公开时间；新建时未传则使用当前时间。
- `pinned_at`：置顶排序字段。
- `seo_title`、`seo_description`：当前保存逻辑由 title/excerpt 派生。
- `reading_time_minutes`、`word_count`：由 Markdown 计算，可重建。

## 2. draft、archived、deleted 的实际情况

运行时文章代码不能再创建或更新为：

- `draft`
- `archived`
- `deleted`

已删除的旧入口：

- `POST /api/admin/posts/:id/publish`
- `POST /api/admin/posts/:id/unpublish`
- `publishAdminPost()`
- `unpublishAdminPost()`
- `setPostStatus()`
- about 编辑器的 `ensureAdminAboutPost()` 空占位创建路径

输入校验只接受 `published` 和 `public`。传入 `draft`、`archived`、`deleted` 或 `private` 会得到验证错误或数据库 CHECK 拒绝。

注意：`assets.visibility = 'draft'` 仍是媒体上传生命周期，不是文章状态。未绑定的临时上传仍通过现有过期清理和未保存清理处理。

## 3. 临时纸页与 D1 内容边界

普通新文章未正式发表前只存在 localStorage：

- key：`sakura-cactus:temporary-paper`
- 24 小时过期
- 不写 D1

已发表文章的未提交本地修改只存在 localStorage：

- key：`sakura-cactus:writer:post:<postId>`
- 不写 D1，直到用户保存修订

未发表 about 页只存在 localStorage：

- key：`sakura-cactus:writer:about`
- 不占用普通临时纸页 key
- 首次正式保存才创建 `slug = 'about'` 的 published D1 记录

删除文章成功后，前端会清理对应文章 autosave key 并离开编辑状态。

## 4. 关于页模型

about 页继续使用 `posts.slug = 'about'`，不建立第二套页面表。

当前行为：

- 打开 `/write?type=about` 只读取已有 about。
- 不存在 about 时向编辑器传入空状态，不插入 D1。
- 未保存内容写入 `sakura-cactus:writer:about`。
- 首次保存调用 about upsert 路径，创建一条 published about。
- 再次保存更新原 about，不创建第二条。
- 删除 about 继续走文章物理删除机制。
- about 独占图片按现有文章删除媒体规则清理；共享图片保留。

## 5. 文章永久删除调用链

调用链：

`DELETE /api/admin/posts/:id`
-> `deleteAdminPost(id)`
-> `listAssetsForPost(db, id)`
-> `deletePostPermanently(db, id)`
-> `refreshAssetUsageCounts(db, assetIds)`
-> `cleanupUnreferencedPostAssets(db, post.id, assets)`

`deletePostPermanently()` 使用 D1 batch 删除：

- `post_tags`
- `post_assets`
- `post_view_counts`
- `posts`

主记录删除是 `DELETE FROM posts WHERE id = ?`，并检查影响行数。0 行返回不存在，1 行成功，其他情况抛错。删除后再次查询确认文章行不存在。

## 6. D1 关联清理

外键关系：

- `post_tags.post_id -> posts.id ON DELETE CASCADE`
- `post_assets.post_id -> posts.id ON DELETE CASCADE`
- `post_view_counts.post_id -> posts.id ON DELETE CASCADE`
- `posts.cover_asset_id -> assets.id ON DELETE SET NULL`

运行时仍显式清理文章关系，避免依赖外键开关状态产生孤儿关系。标签主体不随文章删除。资产只在确认没有任何文章正文或封面引用后才删除。

## 7. R2 生命周期

媒体系统保持现有设计：

- 私有 R2 bucket。
- `/i/<token>` 代理读取。
- 安全随机 token 和 r2_key。
- `assets` 元数据。
- `post_assets` 正文引用关系。
- `cover_asset_id` 封面引用。
- SHA-256 去重。
- 正文图片提取。
- usage_count 统计正文和封面引用。
- 未保存上传清理、过期临时媒体清理、历史候选补偿清理。

文章删除后：

1. 删除前收集正文和封面资产。
2. D1 文章和关联删除成功后，文章删除视为成功。
3. 重新检查 `post_assets` 和 `posts.cover_asset_id`。
4. 仍被引用则保留。
5. 无引用则删除 R2 对象并物理删除 assets 记录。
6. R2 删除失败时记录 postId、assetId、r2Key 和错误，保留 assets 记录以便补偿。

历史候选补偿只处理 `historical_post_asset_cleanup_candidates`，不会扫描普通临时上传。

## 8. 0010 migration

新增 migration：`migrations/0010_simplify_post_status.sql`

升级流程：

1. `PRAGMA foreign_keys=off`
2. `BEGIN TRANSACTION`
3. 确保 `historical_post_asset_cleanup_candidates` 存在
4. 从旧 `draft`、`archived`、非 `public` 文章的 `post_assets` 保存候选 asset_id
5. 从旧 `draft`、`archived`、非 `public` 文章的 `cover_asset_id` 保存候选 asset_id
6. 删除旧文章的 `post_tags`、`post_assets`、`post_view_counts`
7. 物理删除旧文章
8. 重建 `posts`，status 只允许 `published`，visibility 只允许 `public`
9. 重建保留索引
10. 写入 schema version 10
11. `COMMIT`
12. `PRAGMA foreign_keys=on`

不会在 SQL migration 中删除 R2 对象。候选媒体继续由现有补偿脚本幂等处理。

## 9. 当前可安全导出的内容

阶段 3 可基于以下范围实现：

- 当前 D1 中存在的 published/public/current 普通文章。
- published/public/current about 单实例。
- 被导出文章实际使用的标签和文章-标签关系。
- 被导出文章 Markdown 引用的站内 R2 图片。
- 被导出文章 cover_asset_id 指向的封面图片。
- 用户选择导出的友链。

导出应以 Markdown 为内容权威，导入时重新生成 `content_html`。

## 10. 当前不得导出的内容

不得导出：

- localStorage。
- 临时纸页。
- 未提交本地修改。
- 历史 draft / archived / deleted 文章。
- 历史媒体候选。
- 数据库内部主键。
- `content_html`。
- 浏览量。
- session、cookie、CSRF token。
- 管理员账号、密码或密码哈希。
- secret、环境变量、Cloudflare D1/R2/Worker ID、绑定和域名配置。
- rate limits、audit logs、cache、日志。
- site settings。
- 未绑定临时上传、孤立媒体、已删除媒体、系统默认资源。

## 11. 测试覆盖

现有 `pnpm.cmd test:posts` 覆盖：

- 新 schema 下文章硬删除。
- D1 删除成功、R2 清理失败时 API 仍成功。
- R2 失败日志包含 postId/assetId/r2Key。
- 独占正文图片和独占封面清理。
- 共享正文图片和共享封面保护。
- 删除不存在文章返回不存在。
- 更新 published 文章仍更新原记录。
- 输入 draft / archived / private 被拒绝。
- about 首次保存创建 published。
- about 再次保存更新原记录。
- about 删除清理独占媒体。
- 0009 历史硬删除 migration。
- 0010 published-only migration。
- 历史候选补偿幂等。
- 前端删除成功路径清理 autosave。
- about 编辑器不再调用 ensure 占位创建。
- 旧 publish/unpublish route 文件不存在。

仍需阶段 2/3 补充：

- 浏览器级 localStorage 和 no-D1-write smoke。
- 数据导入导出 API/UI/fixture 测试。
- 媒体导出时逐个读取 R2 对象并处理缺失对象。

## 12. 风险分级

P0：无。

P1：阶段 1 本地代码未发现影响数据导入导出的核心生命周期阻断；阶段 2 需复核后确认。

P2：

- public query 仍依赖 `published_at <= now`，未来如果需要彻底移除定时公开语义，需要另行决定。
- 浏览器级 smoke 尚未完成。
- D1 只能证明 R2 元数据存在，不能证明 R2 对象实际存在；导出媒体时必须逐个读取 R2。

P3：

- 媒体内部仍使用 `draft` 作为上传可见性名称，当前属于资产生命周期，不影响文章状态。
