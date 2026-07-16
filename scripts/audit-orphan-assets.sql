-- Non-destructive audit query for post/image cleanup compensation.
-- Run after migration 0009 if you need to identify assets that are no longer
-- referenced by any post relation or cover image. Review rows manually before
-- deleting R2 objects because this can include legitimate draft uploads.

SELECT
  assets.id,
  assets.token,
  assets.r2_key,
  assets.original_filename,
  assets.mime_type,
  assets.visibility,
  assets.usage_count,
  assets.created_at,
  assets.updated_at,
  assets.deleted_at
FROM assets
WHERE assets.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM post_assets
    WHERE post_assets.asset_id = assets.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM posts
    WHERE posts.cover_asset_id = assets.id
  )
ORDER BY assets.updated_at ASC, assets.created_at ASC;
