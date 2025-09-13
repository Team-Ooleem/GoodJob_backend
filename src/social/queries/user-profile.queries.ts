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

    // 다른 사용자 정보 조회용 (멘토 통계 포함)
    getAnotherUserProfileInfo: `
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
            EXISTS(SELECT 1 FROM follow WHERE follower_idx = ? AND following_idx = u.idx) as is_following,
            EXISTS(SELECT 1 FROM mentor_profiles WHERE user_idx = u.idx) as is_mentor,
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
} as const;
