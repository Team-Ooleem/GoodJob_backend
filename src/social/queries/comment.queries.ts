export const CommentQueries = {
    /**
     * 포스트 댓글 조회 (전체)
     *
     * 파라미터 순서:
     * 1. postId (number) - 댓글을 조회할 포스트 ID
     */
    getPostComments: `
        SELECT 
            pc.comment_id,
            pc.post_idx,
            pc.user_id,
            u.name AS user_name,
            u.profile_img AS user_profile_image,
            pc.content,
            pc.created_at
        FROM post_comments pc
        INNER JOIN users u ON pc.user_id = u.idx
        WHERE pc.post_idx = ?
        ORDER BY pc.created_at DESC
    `,

    /**
     * 포스트 댓글 추가
     *
     * 파라미터 순서:
     * 1. postId (number) - 댓글을 달 포스트 ID
     * 2. userId (number) - 댓글 작성자 ID
     * 3. content (string) - 댓글 내용
     */
    addPostComment: `
        INSERT INTO post_comments (post_idx, user_id, content, created_at)
        VALUES (?, ?, ?, NOW())
    `,

    /**
     * 포스트 댓글 삭제
     *
     * 파라미터 순서:
     * 1. commentId (number) - 삭제할 댓글 ID
     * 2. userId (number) - 댓글 작성자 ID (권한 확인용)
     */
    deletePostComment: `
        DELETE FROM post_comments 
        WHERE comment_id = ? AND user_id = ?
    `,
} as const;
