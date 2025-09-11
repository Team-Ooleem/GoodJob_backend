// 사용자 프로필 관련 쿼리문들을 별도로 관리
export const UserProfileQueries = {
    // 사용자 기본 정보 조회
    getUserBasicInfo: `
        SELECT u.name, u.bio, u.profile_img, u.phone, u.email
        FROM users u
        WHERE u.idx = ?
    `,

    // 팔로워/팔로잉 수 조회
    getFollowCounts: `
        SELECT 
            (SELECT COUNT(*) FROM follow WHERE following_idx = ?) as follower_count,
            (SELECT COUNT(*) FROM follow WHERE follower_idx = ?) as following_count
    `,
} as const;
