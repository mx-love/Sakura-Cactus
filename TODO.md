# TODO

## 当前稳定功能

- [x] Astro + React + TypeScript on Cloudflare Workers SSR.
- [x] Cloudflare D1 stores posts, tags, sessions, settings, friend links, view counts, and rate limits.
- [x] Private Cloudflare R2 stores uploaded media behind Sakura Cactus `/i/:token` access checks.
- [x] Admin login uses environment credentials, D1-backed sessions, HttpOnly Secure SameSite cookies, and D1-backed login rate limits.
- [x] Writing flow supports new posts, editing, local autosave/recovery, drafts, publishing, unpublishing, pinning, and soft deletion.
- [x] The editor handles image upload, paste/drop upload, first mixed paste preservation, and private asset reference cleanup.
- [x] Public pages include home, articles, post detail, tags, timeline, search, friends, about, RSS, sitemap, and robots.
- [x] Friend links support public applications, admin review/edit/hide/delete, manual health checks, and scheduled health checks.
- [x] Site settings cover friend applications, friend health checks, comments toggle, view counts, favicon URL, and maintenance cleanup.
- [x] Markdown rendering escapes raw HTML, sanitizes output, constrains links/images, rewrites private asset tokens, and re-renders legacy content from Markdown.
- [x] Security hardening includes CSRF-style same-origin checks, SSRF guards, response security headers, private `no-store`, request size limits, and security regression tests.
- [x] Direct package dependencies are exact versions and match `pnpm-lock.yaml`.

## 高优先级

- [ ] 博客数据导出：导出文章、标签、设置、友链和媒体引用清单。
- [ ] 博客数据导入：从受信备份恢复博客数据，不实现任意第三方运行时代码。
- [ ] 备份格式版本管理：为导出文件加入 schema/version、生成时间、校验摘要和兼容性说明。
- [ ] 导入前 dry-run / 预检查：验证文件格式、版本、引用完整性、容量限制和 D1/R2 可用性。
- [ ] 导入冲突策略：定义 slug、标签、友链、设置、媒体 hash/token 冲突时的跳过、覆盖、重命名或合并规则。
- [ ] D1/R2 一致性和失败回滚：为导入、恢复、媒体复制和清理设计幂等重试与补偿删除。
- [ ] 数据备份恢复文档：记录导出、导入、预检查、回滚和生产恢复演练步骤。

## 中优先级

- [ ] 离开页面前未保存内容提醒：当前已有本地自动暂存和恢复提示，但没有浏览器级离开确认。
- [ ] 后台运行状态页：展示 D1/R2 绑定、最近维护任务、友链健康检查和安全配置提示。
- [ ] 浏览器上传前图片压缩：在不改变 5 MiB 服务端限制的前提下降低常见图片体积。
- [ ] 草稿临时预览链接：为未发布文章提供受控的短期预览入口。
- [ ] 更完整的可观测性：补充关键失败计数、维护任务结果和导入导出事件记录。
- [ ] 独立标签管理页：当前标签随文章编辑自动维护，后续可增加合并、重命名和清理界面。
- [ ] 全文 RSS：在完成安全的绝对 URL 重写后，再考虑输出安全的全文内容。
- [ ] 可选构建时扩展接口：只有出现两个以上真实同类实现后，再抽象轻量静态注册接口。

## 低优先级

- [ ] 更丰富的编辑器辅助能力，例如快捷插入、草稿模板和更细的 Markdown 工具。
- [ ] 低风险的动效和阅读体验优化。
- [ ] 更多可配置的站点展示文案和导航项。

## 已完成

- [x] Stage 2: D1 schema and migrations.
- [x] Stage 3: admin authentication and D1 sessions.
- [x] Stage 3.5: initial setup flow; later retired in favor of environment-managed admin credentials.
- [x] Stage 4: post management APIs and UI.
- [x] Stage 5: private R2 media library and token proxy.
- [x] Stage 6: Sakura Cactus theme, public navigation, discovery pages, and base component styles.
- [x] Stage 7: security hardening and deployment/security handoff documents.
- [x] Login/session hardening, CSRF-style same-origin checks, D1 rate limits, and migration 0008.
- [x] SSRF protection for friend URLs and favicon URL settings.
- [x] R2 upload validation, magic-byte checks, 5 MiB upload cap, and D1-insert rollback cleanup.
- [x] Markdown safe rendering and legacy `content_html` re-rendering.
- [x] RSS, sitemap, robots, canonical URLs, Open Graph, and JSON-LD.
- [x] Waline comment slot integration, gated by settings and `PUBLIC_COMMENTS_SERVER_URL`.
- [x] Security regression test script.
- [x] Writer local autosave, temporary-paper recovery, existing-post local revision recovery, and first paste content preservation.

## 已知限制

- 本站域名作为友链目标时，可能因 Cloudflare Worker 自请求或平台限制而在健康检查中显示不可达；这不是安全漏洞。
- 单张图片最大 5 MiB，当前作为明确产品限制保留。
- 当前 CSP 是基础策略：`base-uri 'self'`、`frame-ancestors 'none'`、`object-src 'none'`。除非未来合法功能出现明确阻断，暂不计划继续收紧到完整 nonce/hash 策略。
- 完整博客导出、导入、恢复和备份格式版本管理尚未实现。
- D1 与 R2 没有共同事务；现有上传路径已做补偿删除，未来导入/恢复仍需要专门的一致性设计。
- 生产安全仍依赖 Cloudflare 控制台确认：R2 私有、无公开开发 URL、Secret 配置、D1/R2 环境隔离、Cache Rules 和备份策略。
- Waline 评论数据存储在外部 Waline 服务中；本站只提供前端挂载入口。

## 暂不计划

- 动态第三方插件市场。
- 在生产环境上传和执行任意第三方插件代码。
- 多租户。
- 复杂多用户权限系统。
- 大型主题市场。
- 为了形式而构建通用框架或空插件 registry。
