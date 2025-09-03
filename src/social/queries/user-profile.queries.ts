// 사용자 프로필 관련 쿼리문들을 별도로 관리
export const UserProfileQueries = {
    // 사용자 기본 정보 조회
    getUserBasicInfo: `
        SELECT u.name, u.short_bio, u.bio, u.profile_img
        FROM users u
        WHERE u.idx = ?
    `,

    // 개인 프로필 정보 조회
    getIndividualProfile: `
        SELECT ip.desired_job, ip.desired_sido, ip.desired_gu
        FROM individual_profile ip
        WHERE ip.user_idx = ?
    `,

    // 직종 정보 조회
    getJobRole: `
        SELECT jr.name
        FROM job_role jr
        WHERE jr.id = ?
    `,

    // 거주지 정보 조회
    getLocation: `
        SELECT CONCAT(s.sido_name, ' ', g.gu_name) as full_location
        FROM sido s
        JOIN gu g ON s.sido_code = g.sido_code
        WHERE s.sido_code = ? AND g.gu_code = ?
    `,

    // 모든 정보를 한 번에 조회하는 복합 쿼리 (선택사항)
    getUserProfileAll: `
        SELECT 
            u.name,
            u.profile_img,
            u.short_bio,
            u.bio,
            COALESCE(jr.name, '직종 미설정') as job_title,
            COALESCE(CONCAT(s.sido_name, ' ', g.gu_name), '거주지 미설정') as residence,
            COUNT(f.id) as follower_count
        FROM users u
        LEFT JOIN individual_profile ip ON u.idx = ip.user_idx
        LEFT JOIN job_role jr ON ip.desired_job = jr.id
        LEFT JOIN sido s ON ip.desired_sido = s.sido_code
        LEFT JOIN gu g ON ip.desired_gu = g.gu_code AND s.sido_code = g.sido_code
        LEFT JOIN follow f ON u.idx = f.following_idx
        WHERE u.idx = ?
        GROUP BY u.idx
    `,
} as const;
