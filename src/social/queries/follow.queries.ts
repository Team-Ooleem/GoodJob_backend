export const FollowQueries = {
    /**
     * 팔로우 상태 확인
     *
     * 파라미터 순서:
     * 1. followerId (number) - 팔로우하는 사용자 ID
     * 2. followingId (number) - 팔로우받는 사용자 ID
     */
    checkFollowStatus: `
        SELECT COUNT(*) as is_following
        FROM follow
        WHERE follower_idx = ? AND following_idx = ?
    `,

    /**
     * 팔로우 추가
     *
     * 파라미터 순서:
     * 1. followerId (number) - 팔로우하는 사용자 ID
     * 2. followingId (number) - 팔로우받는 사용자 ID
     */
    addFollow: `
        INSERT INTO follow (follower_idx, following_idx, created_at)
        VALUES (?, ?, NOW())
    `,

    /**
     * 팔로우 취소
     *
     * 파라미터 순서:
     * 1. followerId (number) - 팔로우하는 사용자 ID
     * 2. followingId (number) - 팔로우받는 사용자 ID
     */
    removeFollow: `
        DELETE FROM follow
        WHERE follower_idx = ? AND following_idx = ?
    `,

    /**
     * 사용자의 팔로워 수 조회
     *
     * 파라미터 순서:
     * 1. userId (number) - 사용자 ID
     */
    getFollowerCount: `
        SELECT COUNT(*) as follower_count
        FROM follow
        WHERE following_idx = ?
    `,
} as const;
