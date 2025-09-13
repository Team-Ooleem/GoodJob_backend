// 사용자 프로필 관련 쿼리문들을 별도로 관리
export const UserProfileQueries = {
    // 내 정보 조회용 (멘토 통계 포함)
    getMyProfileInfo: `
        SELECT 
            u.name, 
            u.bio, 
            u.profile_img, 
            u.created_at,
            (SELECT COUNT(*) FROM follow WHERE following_idx = u.idx) as follower_count,
            (SELECT COUNT(*) FROM follow WHERE follower_idx = u.idx) as following_count,
            (SELECT COUNT(*) FROM posts WHERE user_id = u.idx) as total_posts,
            (SELECT COALESCE(SUM(like_count), 0) FROM (
                SELECT COUNT(*) as like_count 
                FROM post_likes pl 
                JOIN posts p ON pl.post_idx = p.post_idx 
                WHERE p.user_id = u.idx
            ) as likes) as total_likes,
            -- 멘토 통계 (멘토인 경우에만)
            mp.business_name,
            jc.name as preferred_field_name,
            mp.is_approved,
            (SELECT COUNT(*) FROM mentoring_applications ma 
             JOIN mentoring_products mp2 ON ma.product_idx = mp2.product_idx 
             WHERE mp2.mentor_idx = mp.mentor_idx 
             AND ma.application_status = 'completed') as total_mentoring_sessions,
            (SELECT COUNT(*) FROM mentoring_reviews mr 
             JOIN mentoring_applications ma ON mr.application_id = ma.application_id
             JOIN mentoring_products mp2 ON ma.product_idx = mp2.product_idx 
             WHERE mp2.mentor_idx = mp.mentor_idx) as total_mentoring_reviews,
            (SELECT AVG(mr.rating) FROM mentoring_reviews mr 
             JOIN mentoring_applications ma ON mr.application_id = ma.application_id
             JOIN mentoring_products mp2 ON ma.product_idx = mp2.product_idx 
             WHERE mp2.mentor_idx = mp.mentor_idx) as avg_mentoring_rating,
            (SELECT COUNT(*) FROM mentoring_applications ma 
             JOIN mentoring_products mp2 ON ma.product_idx = mp2.product_idx 
             WHERE mp2.mentor_idx = mp.mentor_idx) as total_mentoring_applications
        FROM users u
        LEFT JOIN mentor_profiles mp ON u.idx = mp.user_idx
        LEFT JOIN job_category jc ON mp.preferred_field_id = jc.id
        WHERE u.idx = ?
    `,

    // 유저 프로필 상세 정보 조회용 (유저 정보 + 멘토링 상품 + 포스트 통합)
    getUserProfileDetail: `
        -- 1. 유저 기본 정보 + 멘토 통계
        SELECT 
            u.idx as user_idx,
            u.name, 
            u.bio, 
            u.profile_img, 
            u.created_at,
            (SELECT COUNT(*) FROM follow WHERE following_idx = u.idx) as follower_count,
            (SELECT COUNT(*) FROM follow WHERE follower_idx = u.idx) as following_count,
            (SELECT COUNT(*) FROM posts WHERE user_id = u.idx) as total_posts,
            (SELECT COALESCE(SUM(like_count), 0) FROM (
                SELECT COUNT(*) as like_count 
                FROM post_likes pl 
                JOIN posts p ON pl.post_idx = p.post_idx 
                WHERE p.user_id = u.idx
            ) as likes) as total_likes,
            EXISTS(SELECT 1 FROM follow WHERE follower_idx = ? AND following_idx = u.idx) as is_following,
            EXISTS(SELECT 1 FROM mentor_profiles WHERE user_idx = u.idx) as is_mentor,
            -- 멘토 통계 (멘토인 경우에만)
            mp.business_name,
            mp.introduction,
            mp.portfolio_link,
            jc.name as preferred_field_name,
            mp.is_approved,
            (SELECT COUNT(*) FROM mentoring_applications ma 
             JOIN mentoring_products mp2 ON ma.product_idx = mp2.product_idx 
             WHERE mp2.mentor_idx = mp.mentor_idx 
             AND ma.application_status = 'completed') as total_mentoring_sessions,
            (SELECT COUNT(*) FROM mentoring_reviews mr 
             JOIN mentoring_applications ma ON mr.application_id = ma.application_id
             JOIN mentoring_products mp2 ON ma.product_idx = mp2.product_idx 
             WHERE mp2.mentor_idx = mp.mentor_idx) as total_mentoring_reviews,
            (SELECT AVG(mr.rating) FROM mentoring_reviews mr 
             JOIN mentoring_applications ma ON mr.application_id = ma.application_id
             JOIN mentoring_products mp2 ON ma.product_idx = mp2.product_idx 
             WHERE mp2.mentor_idx = mp.mentor_idx) as avg_mentoring_rating,
            (SELECT COUNT(*) FROM mentoring_applications ma 
             JOIN mentoring_products mp2 ON ma.product_idx = mp2.product_idx 
             WHERE mp2.mentor_idx = mp.mentor_idx) as total_mentoring_applications
        FROM users u
        LEFT JOIN mentor_profiles mp ON u.idx = mp.user_idx
        LEFT JOIN job_category jc ON mp.preferred_field_id = jc.id
        WHERE u.idx = ?
    `,

    // 특정 멘토의 멘토링 상품 목록 조회
    getMentorProducts: `
        SELECT 
            p.product_idx,
            p.title,
            p.description,
            p.price,
            p.is_active,
            p.created_at,
            jc.name as job_category,
            -- 멘티 수 (완료된 신청만)
            (SELECT COUNT(DISTINCT ma.mentee_idx) 
             FROM mentoring_applications ma 
             WHERE ma.product_idx = p.product_idx 
             AND ma.application_status = 'completed') as mentee_count,
            -- 리뷰 개수 & 평균 평점
            (SELECT COUNT(*) FROM mentoring_reviews mr 
             WHERE mr.product_idx = p.product_idx) as review_count,
            (SELECT COALESCE(ROUND(AVG(mr.rating), 1), 0) FROM mentoring_reviews mr 
             WHERE mr.product_idx = p.product_idx) as average_rating
        FROM mentoring_products p
        JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
        JOIN job_category jc ON p.job_category_id = jc.id
        WHERE mp.user_idx = ? AND p.is_active = 1
        ORDER BY p.created_at DESC
        LIMIT ?
    `,

    // 특정 유저의 포스트 목록 조회 (요약 정보)
    getUserPostsSummary: `
        SELECT 
            p.post_idx,
            p.content,
            p.media_url,
            p.created_at,
            COALESCE(pl.like_count, 0) AS like_count,
            COALESCE(pc.comment_count, 0) AS comment_count,
            CASE WHEN user_like.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_liked_by_current_user
        FROM posts p
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
        WHERE p.user_id = ?
        ORDER BY p.post_idx DESC
        LIMIT ?
    `,
} as const;
