import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UserProfileQueries } from '../queries/user-profile.queries';
import { FollowService } from './follow.service';
import { PostService, Post } from './post.service';

export interface UserProfileInfo {
    name: string;
    profileImage?: string;
    shortBio?: string;
    bio?: string;
    phone?: string;
    email?: string;
    desiredJobTitle?: string;
    desiredLocation?: string;
    desiredSalary?: string;
    followerCount: number;
    followingCount: number;
    isFollowing?: boolean; // 현재 사용자가 이 사용자를 팔로우하고 있는지 여부
    currentCareer?: {
        companyName: string;
        position: string;
        department?: string;
        jobTitle?: string;
        startDate: string;
        endDate?: string;
        isCurrent: boolean;
        description?: string;
        companyType?: string;
    };
    careers?: {
        companyName: string;
        position: string;
        department?: string;
        jobTitle?: string;
        startDate: string;
        endDate?: string;
        isCurrent: boolean;
        description?: string;
        companyType?: string;
    }[];
    education?: {
        schoolName: string;
        major: string;
        degreeName: string;
        startDate: string;
        endDate?: string;
        isCurrent: boolean;
    }[];
    skills?: string[];
}

export interface UserProfileDetailResponse {
    userInfo: UserProfileInfo;
    posts: Post[];
    hasMore: boolean;
    nextCursor?: number;
}

@Injectable()
export class UserProfileService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly followService: FollowService,
        private readonly postService: PostService,
    ) {}

    /**
     * 사용자 프로필 정보 조회
     * @param userId 사용자 ID
     * @param currentUserId 현재 사용자 ID (팔로우 상태 확인용, 선택사항)
     * @returns 사용자 프로필 정보
     */
    async getUserProfileInfo(userId: number, currentUserId?: number): Promise<UserProfileInfo> {
        try {
            // 사용자 기본 정보 조회
            const userResult = await this.databaseService.query(
                UserProfileQueries.getUserBasicInfo,
                [userId],
            );

            if (!userResult || userResult.length === 0) {
                throw new Error('사용자를 찾을 수 없습니다.');
            }

            const user = userResult[0] as {
                name: string;
                short_bio: string;
                bio: string;
                profile_img: string;
                phone: string;
                email: string;
            };

            // 개인 프로필 정보 조회 (희망 직종, 거주지, 희망 연봉)
            const profileResult = await this.databaseService.query(
                UserProfileQueries.getIndividualProfile,
                [userId],
            );

            // 직종 정보 조회
            let desiredJobTitle = '직종 미설정';
            let desiredLocation = '거주지 미설정';
            let desiredSalary: string | undefined;

            if (profileResult && profileResult.length > 0) {
                const profile = profileResult[0] as {
                    desired_job: number;
                    desired_sido: string;
                    desired_gu: string;
                    desired_salary: number;
                };

                if (profile.desired_job) {
                    const jobResult = await this.databaseService.query(
                        UserProfileQueries.getJobRole,
                        [profile.desired_job],
                    );

                    if (jobResult && jobResult.length > 0) {
                        desiredJobTitle = (jobResult[0] as { name: string }).name;
                    }
                }

                if (profile.desired_sido && profile.desired_gu) {
                    const locationResult = await this.databaseService.query(
                        UserProfileQueries.getLocation,
                        [profile.desired_sido, profile.desired_gu],
                    );
                    if (locationResult && locationResult.length > 0) {
                        desiredLocation = (locationResult[0] as { full_location: string })
                            .full_location;
                    }
                }

                // 희망 연봉 정보 조회 (salary_range 테이블과 JOIN)
                if (profile.desired_salary) {
                    const salaryResult = await this.databaseService.query(
                        UserProfileQueries.getSalaryRange,
                        [profile.desired_salary],
                    );
                    if (salaryResult && salaryResult.length > 0) {
                        desiredSalary = (salaryResult[0] as { display_text: string }).display_text;
                    }
                }
            }

            // 팔로워/팔로잉 수 조회
            const followCountsResult = await this.databaseService.query(
                UserProfileQueries.getFollowCounts,
                [userId, userId],
            );
            const followCounts = followCountsResult[0] as
                | { follower_count: number; following_count: number }
                | undefined;
            const followerCount = followCounts?.follower_count || 0;
            const followingCount = followCounts?.following_count || 0;

            // 팔로우 상태 확인 (다른 사용자의 프로필일 때만)
            let isFollowing: boolean | undefined;
            if (currentUserId && currentUserId !== userId) {
                isFollowing = await this.followService.checkFollowStatus(currentUserId, userId);
            }

            // 현재 경력 정보 조회
            const currentCareerResult = await this.databaseService.query(
                UserProfileQueries.getCurrentCareer,
                [userId],
            );
            let currentCareer: UserProfileInfo['currentCareer'] | undefined;
            if (currentCareerResult && currentCareerResult.length > 0) {
                const career = currentCareerResult[0] as {
                    company_name: string;
                    position: string;
                    department: string;
                    job_title: string;
                    start_date: string;
                    end_date: string;
                    is_current: boolean;
                    description: string;
                    company_type_name: string;
                };
                currentCareer = {
                    companyName: career.company_name,
                    position: career.position,
                    department: career.department,
                    jobTitle: career.job_title,
                    startDate: career.start_date,
                    endDate: career.end_date,
                    isCurrent: Boolean(career.is_current),
                    description: career.description,
                    companyType: career.company_type_name,
                };
            }

            // 모든 경력 정보 조회
            const allCareersResult = await this.databaseService.query(
                UserProfileQueries.getAllCareers,
                [userId],
            );
            const careers = allCareersResult.map(
                (career: {
                    company_name: string;
                    position: string;
                    department: string;
                    job_title: string;
                    start_date: string;
                    end_date: string;
                    is_current: boolean;
                    description: string;
                    company_type_name: string;
                }) => ({
                    companyName: career.company_name,
                    position: career.position,
                    department: career.department,
                    jobTitle: career.job_title,
                    startDate: career.start_date,
                    endDate: career.end_date,
                    isCurrent: Boolean(career.is_current),
                    description: career.description,
                    companyType: career.company_type_name,
                }),
            );

            // 학력 정보 조회
            const educationResult = await this.databaseService.query(
                UserProfileQueries.getEducation,
                [userId],
            );
            const education = educationResult.map(
                (edu: {
                    school_name: string;
                    major: string;
                    degree_name: string;
                    start_date: string;
                    end_date: string;
                    is_current: boolean;
                }) => ({
                    schoolName: edu.school_name,
                    major: edu.major,
                    degreeName: edu.degree_name,
                    startDate: edu.start_date,
                    endDate: edu.end_date,
                    isCurrent: Boolean(edu.is_current),
                }),
            );

            // 보유 기술 조회
            const skillsResult = await this.databaseService.query(UserProfileQueries.getSkills, [
                userId,
            ]);
            const skills = skillsResult.map((skill: { skill_name: string }) => skill.skill_name);

            const result: UserProfileInfo = {
                name: user.name,
                profileImage: user.profile_img,
                shortBio: user.short_bio,
                bio: user.bio,
                phone: user.phone,
                email: user.email,
                desiredJobTitle,
                desiredLocation,
                desiredSalary,
                followerCount,
                followingCount,
                isFollowing,
                currentCareer,
                careers: careers.length > 0 ? careers : undefined,
                education: education.length > 0 ? education : undefined,
                skills: skills.length > 0 ? skills : undefined,
            };

            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 에러 발생:`, error);
            console.error(`❌ 에러 스택:`, error instanceof Error ? error.stack : 'No stack trace');
            throw new Error(`사용자 프로필 정보 조회 실패: ${errorMessage}`);
        }
    }

    /**
     * 사용자 프로필 상세 정보 조회 (프로필 정보 + 포스트 목록)
     * @param targetUserId 조회할 사용자 ID
     * @param currentUserId 현재 사용자 ID (좋아요, 팔로우 상태 확인용)
     * @param postsLimit 포스트 조회 수 (기본값: 10)
     * @param postsCursor 포스트 커서 (기본값: undefined)
     * @returns 사용자 프로필 상세 정보
     */
    async getUserProfileDetail(
        targetUserId: number,
        currentUserId: number,
        postsLimit: number = 10,
        postsCursor?: number,
    ): Promise<UserProfileDetailResponse> {
        try {
            // 1. 사용자 프로필 정보 조회
            const userInfo = await this.getUserProfileInfo(targetUserId, currentUserId);

            // 2. 해당 사용자의 포스트 목록 조회
            const postsResponse = await this.postService.getUserPosts(
                targetUserId,
                currentUserId,
                postsLimit,
                postsCursor,
            );

            const result: UserProfileDetailResponse = {
                userInfo,
                posts: postsResponse.posts,
                hasMore: postsResponse.hasMore,
                nextCursor: postsResponse.nextCursor,
            };

            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 사용자 프로필 상세 정보 조회 실패:`, error);
            throw new Error(`사용자 프로필 상세 정보 조회 실패: ${errorMessage}`);
        }
    }
}
