// 사용자 프로필 관련 쿼리문들을 별도로 관리
export const UserProfileQueries = {
    // 사용자 기본 정보 조회
    getUserBasicInfo: `
        SELECT u.name, u.short_bio, u.bio, u.profile_img, u.phone, u.email
        FROM users u
        WHERE u.idx = ?
    `,

    // 개인 프로필 정보 조회
    getIndividualProfile: `
        SELECT ip.desired_job, ip.desired_sido, ip.desired_gu, ip.desired_salary
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

    // 현재 경력 정보 조회 (현재 재직 중인 회사)
    getCurrentCareer: `
        SELECT 
            c.company_name,
            car.position,
            car.department,
            car.job_title,
            car.start_date,
            car.end_date,
            car.is_current,
            car.description,
            comp.company_size_code,
            ct.name as company_type_name
        FROM career car
        JOIN companies comp ON car.company_idx = comp.idx
        LEFT JOIN company_type ct ON comp.company_size_code = ct.id
        LEFT JOIN business_profile c ON comp.business_number = c.business_number
        WHERE car.user_idx = ? AND car.is_current = 1
        ORDER BY car.start_date DESC
        LIMIT 1
    `,

    // 모든 경력 정보 조회 (최신순)
    getAllCareers: `
        SELECT 
            c.company_name,
            car.position,
            car.department,
            car.job_title,
            car.start_date,
            car.end_date,
            car.is_current,
            car.description,
            comp.company_size_code,
            ct.name as company_type_name
        FROM career car
        JOIN companies comp ON car.company_idx = comp.idx
        LEFT JOIN company_type ct ON comp.company_size_code = ct.id
        LEFT JOIN business_profile c ON comp.business_number = c.business_number
        WHERE car.user_idx = ?
        ORDER BY car.start_date DESC
    `,

    // 학력 정보 조회
    getEducation: `
        SELECT 
            e.school_name,
            e.major,
            el.name as degree_name,
            e.start_date,
            e.end_date,
            e.is_current
        FROM educate e
        LEFT JOIN education_level el ON e.degree = el.idx
        WHERE e.user_idx = ?
        ORDER BY e.start_date DESC
    `,

    // 보유 기술 조회
    getSkills: `
        SELECT DISTINCT rs.skill_name
        FROM resume_skill rs
        JOIN resume r ON rs.resume_id = r.resume_id
        WHERE r.user_id = ?
        ORDER BY rs.skill_name
    `,

    // 팔로워/팔로잉 수 조회
    getFollowCounts: `
        SELECT 
            (SELECT COUNT(*) FROM follow WHERE following_idx = ?) as follower_count,
            (SELECT COUNT(*) FROM follow WHERE follower_idx = ?) as following_count
    `,

    // 모든 정보를 한 번에 조회하는 복합 쿼리
    getUserProfileAll: `
        SELECT 
            u.name,
            u.profile_img,
            u.short_bio,
            u.bio,
            u.phone,
            u.email,
            COALESCE(jr.name, '직종 미설정') as desired_job_title,
            COALESCE(CONCAT(s.sido_name, ' ', g.gu_name), '거주지 미설정') as desired_location,
            ip.desired_salary,
            (SELECT COUNT(*) FROM follow WHERE following_idx = u.idx) as follower_count,
            (SELECT COUNT(*) FROM follow WHERE follower_idx = u.idx) as following_count
        FROM users u
        LEFT JOIN individual_profile ip ON u.idx = ip.user_idx
        LEFT JOIN job_role jr ON ip.desired_job = jr.id
        LEFT JOIN sido s ON ip.desired_sido = s.sido_code
        LEFT JOIN gu g ON ip.desired_gu = g.gu_code AND s.sido_code = g.sido_code
        WHERE u.idx = ?
    `,
} as const;
