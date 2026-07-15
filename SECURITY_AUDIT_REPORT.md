# Sakura Cactus 安全审计报告

审计日期：2026-07-15
审计范围：Astro/React/TypeScript 应用、Cloudflare Workers 入口、D1、私有 R2、认证会话、管理端 API、Markdown 渲染、外部 URL 抓取、缓存、定时任务、依赖与部署配置。

## 结论

审计前整体风险评为**高**：友链健康检查存在可由已存储 URL 触发的 SSRF 边界缺失，登录/上传/公开写接口缺少跨实例限流，依赖审计包含 6 项高危、6 项中危和 4 项低危问题。

本次审计问题清单共 12 项：**1 项 P0、6 项 P1、5 项 P2**。已在不改变界面视觉和主要业务行为的前提下修复全部 P0/P1，以及 P2 的代码侧问题；需要控制台或后续结构重构处理的内容列入“未完成项与建议”。没有发现无需管理员会话即可直接调用的管理 API，也没有发现已提交的真实生产密钥。修复后本地类型检查、Astro 检查、构建、安全回归测试、D1 全量迁移和运行时冒烟测试均通过；生产依赖审计仅剩 1 项低危 Babel 开发构建链告警。

当前残余风险评为**低到中**，主要来自需要生产控制台确认的 Cloudflare 配置、尚未完成完整 nonce/hash CSP 的内联脚本、标准 Workers `fetch` 无法进行 DNS 解析结果绑定，以及等待上游发布的 Babel 7 修复版本。

## 系统与信任边界

- 浏览器请求首先经过 `src/middleware.ts`，在此执行公开缓存判定、跨站写请求拒绝、请求长度预检、D1 schema 检查、管理页面/API 鉴权和响应安全头处理。
- 管理员凭据只从 Workers 环境读取；浏览器只获得随机会话 token，D1 只保存带服务端秘密绑定的 token 哈希。
- D1 repository 负责准备语句和数据映射，service 负责验证、业务规则和 D1/R2 协调。
- R2 bucket 必须保持私有，公开图片只能通过 `/i/:token` 的 D1 可见性判断后读取。
- Markdown 是不可信输入，唯一可信 HTML 出口是当前 `post.renderer.ts` 的转义与 `rehype-sanitize` 流程。
- 友链 URL 是不可信的服务端出站目标；每次请求及每次跳转都必须重新通过公共 HTTP(S) 地址校验。
- Cache API 只允许显式列出的公开 GET 页面；管理端、认证接口、写作/设置页面和携带管理 cookie 的请求不得进入公共缓存。

更完整的代码归属和扩展边界见 `ARCHITECTURE.md`。

## 威胁模型

- 外部未登录攻击者可以访问所有公开页面/API，提交友链申请、触发浏览计数、构造异常 URL/JSON/Markdown 相关输入，并尝试暴力登录或缓存投毒。
- 恶意站点可以诱导已登录管理员浏览器发起跨站请求，但不能读取 `HttpOnly` cookie；浏览器、反向代理和 Cloudflare 缓存配置均视为需要纵深防御的边界。
- 低权限或已被接管的管理员会话可以使用管理功能，因此上传内容、友链出站目标和 Markdown 即使来自后台也不被视为天然可信。
- 外部友链站点、重定向响应、Waline CDN/服务和网络错误均不可信；不得获得 Cloudflare env、cookie、D1/R2 binding 或内部错误细节。
- D1、R2 和 Worker 运行时本身视为受信平台，但跨资源操作不是原子事务，冷启动、并发、网络超时和单项 cron 失败属于必须处理的可靠性威胁。
- 生产 Cloudflare 账号/控制台被完全攻陷、管理员终端被完全控制以及上游平台本身失陷不在应用代码可独立解决的范围内；通过 Secret、最小权限、备份和供应链固定降低其影响。

## 发现与处置

### SEC-001：友链健康检查可访问内网或元数据目标

- 严重级别：**P0 / 严重**
- 受影响文件：`src/features/friends/friend.service.ts`、`src/lib/security/external-url.ts`。
- 证据：原健康检查仅验证 `http:`/`https:`，使用 `redirect: 'follow'`，未拒绝 loopback、私网、link-local、保留地址和内部主机名，也未逐跳验证跳转目标。
- 触发条件：攻击者提交并获批恶意友链，或管理员保存指向恶意重定向服务的 URL；定时任务或手动健康检查随后发起请求。
- 影响：Worker 可能被利用探测平台可达的内部/元数据服务，或对非预期目标发出请求。
- 修复：新增公共 URL 验证器；拒绝凭据、单标签/内部域名、非公开 IPv4/IPv6 和 URL 规范化后的整数/十六进制 IPv4；改为手动跳转、最多三次、逐跳复验、八秒总超时、HEAD 后一字节 Range GET 回退，并取消响应体。健康检查使用四路有界并发，单条网络/URL 失败不会终止整批任务；D1 写入失败会冒泡到调用方。
- 验证：安全测试覆盖 `127.0.0.1`、私网、link-local、metadata、IPv6、整数和十六进制地址；类型检查和构建通过。
- 残余：标准 Workers `fetch` 不提供可用于“校验后绑定同一 DNS 结果”的接口，DNS rebinding 风险无法在应用层完全消除，见“未完成项”。

### SEC-002：登录缺少跨实例暴力破解限制并存在用户名短路

- 严重级别：**P1 / 高**
- 受影响文件：`src/features/auth/auth.service.ts`、`src/pages/api/auth/login.ts`、`src/features/rate-limit/rate-limit.service.ts`、`migrations/0008_security_hardening.sql`。
- 证据：原登录路径没有共享限流；账号不匹配时可提前结束，不执行同等密码验证路径。
- 触发条件：攻击者持续提交登录请求或进行账号枚举/计时观察。
- 影响：提高凭据猜测和账号侧信道风险，并可消耗 PBKDF2/Worker 资源。
- 修复：新增 D1 固定窗口限流表，对客户端 IP 和 IP+账号分别限制；仅使用 Cloudflare `CF-Connecting-IP` 或 `unknown` 作为客户端维度，键值经规范化后以服务端秘密绑定哈希保存；取消用户名短路并统一凭据失败响应；限制账号/密码最大长度；429 返回合法秒数 `Retry-After`；成功登录后尽力清理对应失败窗口。D1 限流不可用时调用方失败关闭，不静默放行。
- 验证：安全测试覆盖窗口边界、并发消费不超过限额、分批清理过期记录和成功清理；本地运行时同源无效登录返回 401，跨源登录返回 403；D1 0008 迁移成功。

### SEC-003：Cookie 写请求缺少显式同源校验

- 严重级别：**P1 / 高**
- 受影响文件：`src/middleware.ts`、`src/lib/security/request.ts`。
- 证据：原实现主要依赖 `SameSite=Lax` cookie，管理、认证、友链申请、浏览计数等写接口未统一检查 `Origin`/Fetch Metadata。
- 触发条件：受害者浏览器携带可用管理 cookie 访问攻击者页面，或浏览器/代理行为削弱 SameSite 保护。
- 影响：可能产生跨站状态修改；公开写接口也可能被第三方站点滥用。
- 修复：middleware 对相关 POST/PUT/PATCH/DELETE 请求拒绝不匹配 `Origin` 和 `Sec-Fetch-Site: cross-site`；SameSite cookie 继续作为第二层保护。GET/HEAD 不承担管理写操作。
- 验证：运行时跨源登录 POST 返回 403；纯测试覆盖同源、跨源和 Fetch Metadata。

### SEC-004：图片上传只信任声明类型，缺少频率限制和失败回滚

- 严重级别：**P1 / 高**
- 受影响文件：`src/features/assets/asset.security.ts`、`src/features/assets/asset.service.ts`、`src/pages/api/admin/assets/upload.ts`、`src/pages/i/[token].ts`。
- 证据：原上传依赖 MIME/扩展名，未核对文件签名；R2 put 成功但 D1 insert 失败时可能留下孤儿；上传无共享频率限制。
- 触发条件：管理员账号被滥用、上传伪装文件，或 D1 在 R2 写入后失败。
- 影响：内容嗅探/异常文件风险、存储资源滥用和孤儿对象累积。
- 修复：只允许单个、最大 5 MiB 的 JPEG/PNG/GIF/WebP，并核对 MIME、可用扩展名和 magic bytes；拒绝 SVG/HTML；清理文件名控制符/路径字符；R2 对象 key 与公开 token 均由服务端随机生成；D1 失败后 best-effort 删除新对象，且 R2 回滚删除失败会记录安全日志但不掩盖主要 D1 错误；增加 D1 上传限流；超限返回 413。
- 验证：安全测试覆盖大小写扩展名、双扩展名、空/截断文件、MIME/签名错配、GIF/WebP 签名、SVG/HTML 拒绝和文件名控制字符清理；类型检查和构建通过。

### SEC-005：Astro Host Header SSRF 与多项传递依赖公告

- 严重级别：**P1 / 高**
- 受影响文件：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`。
- 证据：初始 `pnpm audit --prod` 报告 16 项漏洞，其中包括 Astro Host Header SSRF，以及 Vite、Undici、WS、esbuild、js-yaml 等公告。
- 触发条件：依公告而异，包括恶意 Host/网络输入或开发构建输入。
- 影响：可能造成 SSRF、拒绝服务或开发服务器/构建链攻击面。
- 修复：将 Astro 升级到同一主版本的 6.4.8；所有直接依赖改为确切版本；以同主版本 override 固定 Vite 7.3.5、Undici 7.28.0、WS 8.21.0 和 esbuild 0.28.1；锁文件重新生成。
- 验证：冻结离线安装、Astro check、TypeScript、生产构建均通过；最终生产依赖审计只剩 1 项低危 Babel 告警。

### SEC-006：旧 `content_html` 可能绕过当前 Markdown 策略

- 严重级别：**P1 / 高**
- 受影响文件：`src/features/posts/post.renderer.ts`、`src/features/posts/post.types.ts`、文章详情/预览消费路径。
- 证据：数据库保存渲染后的 HTML，历史数据可能由旧规则生成；直接信任该列会让后续 sanitizer 加固无法覆盖旧文章。
- 触发条件：存在由较宽松旧版本生成的恶意或不安全 HTML。
- 影响：发布页或管理预览可能暴露存储型 XSS。
- 修复：公开与管理文章详情从 `content_markdown` 使用当前 renderer 重新渲染；后台单篇文章 API 返回前也用当前 renderer 重算 `content_html`，不再把旧 `content_html` 当作信任边界；renderer 继续转义 raw HTML、约束 URL protocol 并执行 `rehype-sanitize`。
- 验证：恶意 Markdown 回归用例确认 script、事件属性、JavaScript/data URL、iframe/object/embed、style 注入、SVG、MathML、结束 script 标签和 Unicode 行分隔符不会形成可执行输出。

### SEC-007：私有错误/重定向响应存在缓存策略遗漏

- 严重级别：**P1 / 高**
- 受影响文件：`src/middleware.ts`、`src/lib/cache.ts`（策略复核，无需改变 allowlist）。
- 证据：首次运行时冒烟测试发现未认证管理 API 的早期 401 没有统一 `Cache-Control: no-store`。
- 触发条件：响应经过共享代理或错误的 Cloudflare Cache Rule。
- 影响：私有错误状态或重定向可能被不当复用，造成身份/路由信息泄漏或错误缓存。
- 修复：所有私有分支都通过同一 finalize 路径强制 `no-store`，包括管理 401、跨站 403、请求过大 413、登录页和保护页面重定向；公开 Cache API 仍使用严格 allowlist。
- 验证：代码路径复核、类型检查、构建；最终冒烟测试复核见验证记录。

### SEC-008：公开写接口容易被资源滥用

- 严重级别：**P2 / 中**
- 受影响文件：`src/pages/api/friends/apply.ts`、`src/pages/api/views/[postId].ts`、`src/features/rate-limit/rate-limit.service.ts`。
- 证据：友链申请和浏览计数没有跨 isolate 限额，重复浏览请求可无限增加计数。
- 触发条件：自动化脚本或恶意页面重复调用接口。
- 影响：D1 写入放大、垃圾申请和统计污染。
- 修复：友链申请限制为每 IP 每小时 5 次；浏览计数限制为每 IP 12 小时 200 次、同一 IP/文章 12 小时 1 次；所有键均哈希后存储。

### SEC-009：自动 schema bootstrap 每个冷实例重复执行 DDL

- 严重级别：**P2 / 中**
- 受影响文件：`src/lib/schema.ts`、`migrations/0008_security_hardening.sql`。
- 证据：原 bootstrap 在每个 isolate 首次请求执行整组 `CREATE`/列检查。
- 触发条件：频繁冷启动或流量突增。
- 影响：增加 D1 元数据操作和首请求延迟，放大异常时的资源消耗。
- 修复：增加 `sakura_schema_state` 版本标记；版本 8 完成后常规路径只读取版本，缺失/旧版本仍保留向后兼容 bootstrap。
- 验证：全新本地 D1 依次成功应用 0001–0008；构建运行时成功访问健康接口。

### SEC-010：部分多语句更新可能留下半完成关联状态

- 严重级别：**P2 / 中**
- 受影响文件：`src/features/posts/post.repo.ts`、`src/features/tags/tag.repo.ts`、`src/features/settings/settings.repo.ts`、`src/features/assets/asset.service.ts`。
- 证据：文章资产、标签和设置替换曾逐语句执行，后续语句失败时前序更改已生效。
- 触发条件：D1 在替换流程中发生约束/服务错误。
- 影响：文章关联或设置出现部分更新。
- 修复：文章资产、标签关联和多设置更新改用 D1 batch；R2/D1 无法形成跨资源事务的路径增加显式补偿。

### SEC-011：内容边界、发布校验与定时任务隔离不足

- 严重级别：**P2 / 中**
- 受影响文件：`src/features/posts/post.schema.ts`、`src/features/posts/post.service.ts`、`src/features/friends/friend.service.ts`、`src/worker.ts`。
- 证据：过长内容可被静默截断，空内容可发布；多个 cron 工作串联，一个失败可阻止后续任务；友链批处理单条异常可能中断。
- 触发条件：超长/空内容、D1/R2/外部网络瞬时失败。
- 影响：内容意外丢失、空文章上线、维护任务漏跑。
- 修复：超长输入明确拒绝、空内容禁止发布；三个 scheduled 工作各自 try/catch；友链检查按批并隔离单条网络/URL 失败，但不吞掉 D1 写入失败。

### SEC-012：日志和响应安全头缺少统一边界

- 严重级别：**P2 / 中**
- 受影响文件：`src/lib/logging.ts`、`src/lib/security/request.ts`、`src/middleware.ts`、各管理 API 错误边界、`src/worker.ts`。
- 证据：多个服务端路径直接输出原始异常；缺少统一 frame、MIME、referrer、permissions 等响应策略。
- 触发条件：异常对象携带 URL/底层细节，或页面被嵌入/浏览器进行内容嗅探。
- 影响：日志可能保存敏感上下文，浏览器防御层不足。
- 修复：服务端错误日志仅记录固定 scope、异常名和清理后的短 code；D1 中友链错误改为通用描述；上传回滚的 R2 删除失败也记录固定 scope；middleware 添加 `nosniff`、DENY frame、严格 referrer、Permissions Policy、CSP 的 `base-uri`/`object-src`/`frame-ancestors`，HTTPS 增加 HSTS。
- 验证：运行时响应头冒烟测试通过。

## 未完成项与建议

1. **完整 CSP（中）**：当前 CSP 已封锁对象、frame ancestor 和恶意 base，但尚未限制全部 script/style source。原因是多个历史 Astro 内联脚本及 Waline 动态客户端仍需要迁移。建议先将四个页面内联脚本提取为类型化客户端模块，再为必要脚本引入 nonce/hash，最后收紧 `script-src`/`style-src`/`connect-src`。
2. **Waline 供应链（中）**：页面使用可变的 unpkg `@waline/client@v3` 地址。建议在兼容性测试后锁定确切版本并优先随应用自托管；同步收紧 CSP 的脚本、样式和连接目标。
3. **DNS rebinding（中/低）**：应用已阻止字面内部地址并逐跳复验，但标准 Workers API 不能把 DNS 校验结果固定给随后同一 fetch。继续使用 Cloudflare 平台出站防护；若未来提供受支持的 resolver/pinning 能力，应在出站边界接入。
4. **Babel 审计告警（低）**：最终 audit 的唯一残留为 `@babel/core <=7.29.0` source-map 任意文件读取公告，来自 `@astrojs/react -> @vitejs/plugin-react`。公告标注修复版本 `>=7.29.1`，但该 Babel 7 版本当前尚未发布。不要伪造 override；待上游发布后更新，或单独规划 Babel 8/相关插件主版本迁移。
5. **无 Content-Length 的大请求（低）**：middleware 可在解析前拒绝已声明的超大请求；chunked/无长度请求仍需依赖 Cloudflare 平台请求体上限和各 handler 的解析后校验。可在有稳定流式方案时增加统一 body reader。
6. **生产配置确认（运维）**：必须在 Cloudflare 控制台确认 R2 私有、无公开开发 URL/自定义域，管理凭据为 Secret，D1/R2 的 preview/production 隔离，缓存规则不覆盖私有路径，以及备份/日志访问策略。
7. **结构债务（维护性）**：`PostEditor.tsx`、renderer、post repo、若干 Astro 页面和全局样式体积较大。四个遗留内联 DOM 脚本暂以 `@ts-nocheck` 标注并记录，避免在安全修复中引入 UI 回归；应作为独立前端重构提取并补浏览器测试。
8. **D1/R2 跨资源一致性（低）**：两者没有共同事务。上传路径已补偿删除；删除/清理仍应通过幂等操作、重试和观测处理极少数部分失败。
9. **旧本地管理员脚本（低）**：`scripts/create-admin.ts` 仍兼容 `--password` 参数和普通 readline 输入，前者可能出现在本机进程列表，后者不是隐藏输入。当前运行时管理员已由 Cloudflare 环境变量控制，该脚本不参与网页登录；如仍需使用，应优先通过临时 `SAKURA_ADMIN_PASSWORD` 环境变量并避免 shell 历史，后续可在独立清理中删除明文参数或实现真正的 masked prompt。不要对生产使用其 `--remote` 选项，除非经过单独审批和备份。

## 结构与复杂度审计

扫描了 `src/` 下 104 个 TypeScript、TSX、Astro 和 CSS 文件；10 个文件超过 400 行。最大项为 `global.css`（3343 行）、`PostEditor.tsx`（1199 行）、`post.renderer.ts`（747 行）、`SiteHeader.astro`（556 行）、`post.repo.ts`（554 行）、`prose.css`（531 行）、文章详情页（530 行）、友链页（510 行）、首页（488 行）和 `admin.css`（455 行）。

人工复核了安全关键长函数与高分支区域：Markdown AST 转换、文章编辑器状态机、友链健康检查、schema bootstrap、上传协调和 middleware。此次只抽取了具有明确复用和安全边界价值的 `src/lib/security/`、`src/lib/logging.ts` 与 `src/features/rate-limit/`；没有为降低行数机械拆分 CSS/展示组件，也没有引入无真实第二实现的插件 registry。未来扩展边界和新代码归属已写入 `ARCHITECTURE.md`，扩展不得接触 raw env、Secret、cookie、session token 或 D1/R2 binding。

## 验证记录

- `pnpm.cmd install --frozen-lockfile --offline`：通过，锁文件可复现。
- `pnpm.cmd db:migration:apply:local`：通过，0001–0008 均成功应用到全新本地 D1。
- `pnpm.cmd exec tsc --noEmit --pretty false`：通过。
- `pnpm.cmd check`：通过，0 errors、0 warnings；保留 4 条 API 弃用提示，不影响构建。
- `pnpm.cmd test:security`：通过，覆盖 redirect、same-origin、SSRF 地址、上传签名和 Markdown XSS。
- `pnpm.cmd build`：通过；本地 Miniflare 无法提供真实 `Request.cf` 时 Astro 使用预期 fallback，不影响产物。
- 运行时冒烟：公开健康接口 200；未认证管理健康接口 401；未认证 `/write` 302 到安全的 login `next`；跨源登录 403；同源无效登录 401；恶意外部 `next` 未进入页面目标；安全响应头存在。
- `pnpm.cmd audit --prod --registry=https://registry.npmjs.org/`：1 low（Babel），0 moderate/high/critical；初始值为 4 low、6 moderate、6 high。
- `git diff --check`：通过。

## 部署前必做

- 审核 `migrations/0008_security_hardening.sql`，先核对生产 D1 的 migrations 历史和自动 bootstrap 状态，再决定是否手动 remote apply；不要盲目重复执行生产迁移命令。
- 在 preview 环境完成登录、登出、上传/读取图片、文章发布、友链申请/健康检查、浏览计数和 cron 验证。
- 按 `SECURITY_CHECKLIST.md` 完成所有 `[CONSOLE]` 项；保留部署前 D1 备份/恢复点。
- 发布后检查 `/admin/*`、`/api/admin/*`、`/api/auth/*`、`/write*`、`/settings*` 的 `Cache-Control: no-store`，并确认 Cloudflare Cache Rules 没有覆盖它。
- 不提交 `.dev.vars`、真实管理凭据、D1/R2 标识符或审计运行日志。本次工作区未写入真实秘密，也未执行 push、deploy 或生产迁移。
