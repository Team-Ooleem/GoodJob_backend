export const PostQueries = {
    /**
     * 모든 포스트 조회 (cursor 기반 페이지네이션 + 추가 정보)
     * 모든 사용자의 포스트를 조회 (자신의 포스트 포함)
     *
     * 파라미터 순서:
     * 1. currentUserId (number) - 현재 사용자 ID (좋아요 확인용)
     * 2. currentUserId (number) - 현재 사용자 ID (팔로우 확인용)
     * 3. cursor (number | null) - 커서 (post_idx 기준, null이면 처음부터)
     * 4. cursor (number | null) - 커서 (post_idx 기준, null이면 처음부터)
     * 5. limit (number) - 가져올 포스트 수
     */
    getPosts: `
        SELECT 
            p.post_idx,
            p.user_id,
            p.content,
            p.media_url,
            p.created_at,
            p.updated_at,
            u.name AS author_name,
            u.profile_img AS author_profile_image,
            COALESCE(pl.like_count, 0) AS like_count,
            COALESCE(pc.comment_count, 0) AS comment_count,
            CASE WHEN user_like.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_liked_by_current_user,
            CASE WHEN follow.follower_idx IS NOT NULL THEN 1 ELSE 0 END AS is_following_author
        FROM posts p
        INNER JOIN users u ON p.user_id = u.idx
        LEFT JOIN (
            SELECT post_idx, COUNT(*) as like_count
            FROM post_likes
            GROUP BY post_idx
        ) pl ON p.post_idx = pl.post_idx
        LEFT JOIN (
            SELECT post_idx, COUNT(*) as comment_count
            FROM post_comments
            GROUP BY post_idx
        ) pc ON p.post_idx = pc.post_idx
        LEFT JOIN (
            SELECT post_idx, user_id
            FROM post_likes
            WHERE user_id = ?
        ) user_like ON p.post_idx = user_like.post_idx
        LEFT JOIN (
            SELECT follower_idx, following_idx
            FROM follow
            WHERE follower_idx = ?
        ) follow ON p.user_id = follow.following_idx
        WHERE (? IS NULL OR p.post_idx < ?)
        ORDER BY p.post_idx DESC
        LIMIT ?
    `,

    /**
     * 특정 사용자의 포스트 조회 (상세 버전 - 좋아요, 댓글 수, 팔로우 상태 포함)
     *
     * 파라미터 순서:
     * 1. targetUserId (number) - 조회할 사용자 ID
     * 2. currentUserId (number) - 현재 사용자 ID (좋아요 확인용)
     * 3. currentUserId (number) - 현재 사용자 ID (팔로우 확인용)
     * 4. cursor (number | null) - 커서 (post_idx 기준, null이면 처음부터)
     * 5. cursor (number | null) - 커서 (post_idx 기준, null이면 처음부터)
     * 6. limit (number) - 가져올 포스트 수
     */
    getUserPosts: `
        SELECT 
            p.post_idx,
            p.user_id,
            p.content,
            p.media_url,
            p.created_at,
            p.updated_at,
            u.name AS author_name,
            u.profile_img AS author_profile_image,
            COALESCE(pl.like_count, 0) AS like_count,
            COALESCE(pc.comment_count, 0) AS comment_count,
            CASE WHEN user_like.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_liked_by_current_user,
            CASE WHEN follow.follower_idx IS NOT NULL THEN 1 ELSE 0 END AS is_following_author
        FROM posts p
        INNER JOIN users u ON p.user_id = u.idx
        LEFT JOIN (
            SELECT post_idx, COUNT(*) as like_count
            FROM post_likes
            GROUP BY post_idx
        ) pl ON p.post_idx = pl.post_idx
        LEFT JOIN (
            SELECT post_idx, COUNT(*) as comment_count
            FROM post_comments
            GROUP BY post_idx
        ) pc ON p.post_idx = pc.post_idx
        LEFT JOIN (
            SELECT post_idx, user_id
            FROM post_likes
            WHERE user_id = ?
        ) user_like ON p.post_idx = user_like.post_idx
        LEFT JOIN (
            SELECT follower_idx, following_idx
            FROM follow
            WHERE follower_idx = ?
        ) follow ON p.user_id = follow.following_idx
        WHERE p.user_id = ? AND (? IS NULL OR p.post_idx < ?)
        ORDER BY p.post_idx DESC
        LIMIT ?
    `,

    /**
     * 단일 포스트 조회 (간단 버전)
     *
     * 파라미터 순서:
     * 1. postId (number) - 조회할 포스트 ID
     */
    getPostById: `
        SELECT 
            post_idx,
            user_id,
            content,
            media_url,
            created_at,
            updated_at
        FROM posts
        WHERE post_idx = ?
    `,

    /**
     * 포스트 생성
     *
     * 파라미터 순서:
     * 1. userId (number) - 작성자 ID
     * 2. content (string) - 포스트 내용
     * 3. mediaUrl (string | null) - 미디어 파일 URL
     */
    createPost: `
        INSERT INTO posts (user_id, content, media_url, created_at, updated_at)
        VALUES (?, ?, ?, NOW(), NOW())
    `,

    /**
     * 포스트 삭제
     *
     * 파라미터 순서:
     * 1. postId (number) - 삭제할 포스트 ID
     * 2. userId (number) - 작성자 ID (권한 확인용)
     */
    deletePost: `
        DELETE FROM posts 
        WHERE post_idx = ? AND user_id = ?
    `,
} as const;
