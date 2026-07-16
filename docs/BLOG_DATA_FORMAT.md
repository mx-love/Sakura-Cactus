# Sakura Cactus 博客数据文件

Sakura Cactus 的博客数据功能使用同一种数据模型。JSON 和 ZIP 只是容器不同：不包含图片二进制时导出 JSON，包含文章图片时导出 ZIP。

## 范围

可选择导出：

- 已发表文章与标签：包含 published/public/current 普通文章、about 单实例、实际使用的标签和关系。
- 文章图片：只包含导出文章 Markdown 中通过 `post_assets` 绑定的站内图片，以及 `cover_asset_id` 封面。
- 友链：只包含 approved 友链，可独立导出。

不导出：

- localStorage、临时纸页、未提交修改。
- draft、archived、deleted 或历史清理候选。
- 数据库内部主键、`content_html`、浏览量、session、cookie、CSRF、管理员账号、密码、Secret、环境变量、D1/R2/Worker ID、绑定、日志、缓存和站点设置。

## 顶层格式

```json
{
  "format": "sakura-cactus-data",
  "version": 1,
  "createdAt": "2026-07-16T00:00:00.000Z",
  "source": {
    "generator": "Sakura Cactus",
    "origin": "https://blog.example.com"
  },
  "selectedSections": {
    "articles": true,
    "media": false,
    "friends": false
  },
  "manifest": {
    "counts": {
      "articles": 1,
      "tags": 1,
      "articleTagRelations": 1,
      "media": 1,
      "friends": 0
    }
  },
  "articles": [],
  "aboutPage": null,
  "tags": [],
  "articleTagRelations": [],
  "mediaManifest": [],
  "checksums": {
    "contentSha256": "..."
  }
}
```

文章状态可以省略；如果出现，只允许 `published`。导入时会使用当前 Markdown 渲染器重新生成 HTML，不信任文件中的 HTML。

## ZIP 结构

```text
manifest.json
data.json
media/
  <安全文件名>
```

ZIP manifest 记录文件路径、大小、checksum、所选 section、counts 和媒体总大小。导入会拒绝绝对路径、`../`、重复文件、额外文件、checksum 不匹配、异常压缩比例和超限媒体。

## 导入语义

选择文件后自动 inspect。inspect 只读，不写 D1/R2，并返回短期、会话绑定、文件 hash 绑定的内部计划 token。导入时服务端重新验证文件、token、section、冲突策略和媒体限制。

冲突策略：

- 文章：跳过同 Slug、覆盖同 Slug、另存为副本。
- about：保持单实例；目标存在时覆盖或跳过，不创建副本。
- 友链：跳过已有 URL 或更新已有 URL。

D1 和 R2 不存在分布式事务。导入先校验和上传本次新增媒体，再用 D1 batch 写入文章、标签、关系和友链。D1 写入失败时会尽力删除本次新上传的 R2 对象；不会删除导入前已存在或被共享的媒体。
