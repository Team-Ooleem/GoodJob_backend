export const LikeQueries = {
    /**
     * 포스트 좋아요 추가
     *
     * 파라미터 순서:
     * 1. postId (number) - 좋아요 할 포스트 ID
     * 2. userId (number) - 좋아요 누를 사용자 ID
     */
    addPostLike: `
        INSERT INTO post_likes (post_idx, user_id, created_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE created_at = created_at
    `,

    /**
     * 포스트 좋아요 삭제
     *
     * 파라미터 순서:
     * 1. postId (number) - 좋아요 취소할 포스트 ID
     * 2. userId (number) - 좋아요 취소할 사용자 ID
     */
    removePostLike: `
        DELETE FROM post_likes 
        WHERE post_idx = ? AND user_id = ?
    `,

    /**
     * 포스트 좋아요 상태 확인
     *
     * 파라미터 순서:
     * 1. postId (number) - 포스트 ID
     * 2. userId (number) - 사용자 ID
     */
    checkPostLikeStatus: `
        SELECT COUNT(*) as is_liked
        FROM post_likes
        WHERE post_idx = ? AND user_id = ?
    `,

    /**
     * 포스트 좋아요 수 조회
     *
     * 파라미터 순서:
     * 1. postId (number) - 포스트 ID
     */
    getPostLikeCount: `
        SELECT COUNT(*) as like_count
        FROM post_likes
        WHERE post_idx = ?
    `,

    /**
     * 포스트 좋아요 토글 (추천 기능)
     * 좋아요가 있으면 취소, 없으면 추가
     *
     * 파라미터 순서:
     * 1. postId (number) - 포스트 ID
     * 2. userId (number) - 사용자 ID
     */
    togglePostLike: `
        INSERT INTO post_likes (post_idx, user_id, created_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE 
        created_at = CASE 
            WHEN created_at IS NULL THEN NOW()
            ELSE NULL
        END
    `,
} as const;
