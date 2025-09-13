import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UserProfileQueries } from '../queries/user-profile.queries';
import { FollowService } from './follow.service';

// 내 정보 조회용 (멘토 통계 포함)
export interface MyProfileInfo {
    name: string;
    profileImage?: string;
    bio?: string;
    followerCount: number;
    followingCount: number;
    totalPosts: number;
    totalLikes: number;
    joinDate: string;
    isMentor: boolean;
    mentorProfile?: {
        businessName: string;
        preferredField: string;
        isApproved: boolean;
        totalMentoringSessions: number;
        totalMentoringReviews: number;
        avgMentoringRating: number;
        totalMentoringApplications: number;
    };
}

// 다른 사용자 정보 조회용 (멘토 통계 포함)
export interface AnotherUserProfileInfo {
    name: string;
    profileImage?: string;
    bio?: string;
    followerCount: number;
    followingCount: number;
    totalPosts: number;
    totalLikes: number;
    joinDate: string;
    isFollowing?: boolean; // 현재 사용자가 이 사용자를 팔로우하고 있는지 여부
    isMentor: boolean;
    mentorProfile?: {
        businessName: string;
        preferredField: string;
        isApproved: boolean;
        totalMentoringSessions: number;
        totalMentoringReviews: number;
        avgMentoringRating: number;
        totalMentoringApplications: number;
    };
}

@Injectable()
export class UserProfileService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly followService: FollowService,
    ) {}

    /**
     * 내 정보 조회 (멘토 통계 포함)
     * @param userId 사용자 ID
     * @returns 내 프로필 정보
     */
    async getMyProfileInfo(userId: number): Promise<MyProfileInfo> {
        try {
            // 내 기본 정보 조회 (통합 쿼리)
            const userResult = await this.databaseService.query(
                UserProfileQueries.getMyProfileInfo,
                [userId],
            );

            if (!userResult || userResult.length === 0) {
                throw new Error('사용자를 찾을 수 없습니다.');
            }

            const user = userResult[0] as {
                name: string;
                bio: string;
                profile_img: string;
                created_at: string;
                follower_count: number;
                following_count: number;
                total_posts: number;
                total_likes: number;
                business_name: string;
                preferred_field_name: string;
                is_approved: boolean;
                total_mentoring_sessions: number;
                total_mentoring_reviews: number;
                avg_mentoring_rating: number;
                total_mentoring_applications: number;
            };

            const isMentor = !!user.business_name;
            const mentorProfile = isMentor
                ? {
                      businessName: user.business_name,
                      preferredField: user.preferred_field_name,
                      isApproved: user.is_approved,
                      totalMentoringSessions: user.total_mentoring_sessions,
                      totalMentoringReviews: user.total_mentoring_reviews,
                      avgMentoringRating: user.avg_mentoring_rating,
                      totalMentoringApplications: user.total_mentoring_applications,
                  }
                : undefined;

            const result: MyProfileInfo = {
                name: user.name,
                profileImage: user.profile_img,
                bio: user.bio,
                followerCount: user.follower_count,
                followingCount: user.following_count,
                totalPosts: user.total_posts,
                totalLikes: user.total_likes,
                joinDate: user.created_at,
                isMentor,
                mentorProfile,
            };

            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 내 정보 조회 실패:`, error);
            throw new Error(`내 정보 조회 실패: ${errorMessage}`);
        }
    }

    /**
     * 다른 사용자 정보 조회 (멘토 통계 포함)
     * @param userId 조회할 사용자 ID
     * @param currentUserId 현재 사용자 ID (팔로우 상태 확인용)
     * @returns 다른 사용자 프로필 정보
     */
    async getAnotherUserProfileInfo(
        userId: number,
        currentUserId: number,
    ): Promise<AnotherUserProfileInfo> {
        try {
            // 다른 사용자 기본 정보 조회 (통합 쿼리)
            const userResult = await this.databaseService.query(
                UserProfileQueries.getAnotherUserProfileInfo,
                [currentUserId, userId],
            );

            if (!userResult || userResult.length === 0) {
                throw new Error('사용자를 찾을 수 없습니다.');
            }

            const user = userResult[0] as {
                name: string;
                bio: string;
                profile_img: string;
                created_at: string;
                follower_count: number;
                following_count: number;
                total_posts: number;
                total_likes: number;
                is_following: boolean;
                is_mentor: boolean;
                business_name: string;
                preferred_field_name: string;
                is_approved: boolean;
                total_mentoring_sessions: number;
                total_mentoring_reviews: number;
                avg_mentoring_rating: number;
                total_mentoring_applications: number;
            };

            const mentorProfile = user.is_mentor
                ? {
                      businessName: user.business_name,
                      preferredField: user.preferred_field_name,
                      isApproved: user.is_approved,
                      totalMentoringSessions: user.total_mentoring_sessions,
                      totalMentoringReviews: user.total_mentoring_reviews,
                      avgMentoringRating: user.avg_mentoring_rating,
                      totalMentoringApplications: user.total_mentoring_applications,
                  }
                : undefined;

            const result: AnotherUserProfileInfo = {
                name: user.name,
                profileImage: user.profile_img,
                bio: user.bio,
                followerCount: user.follower_count,
                followingCount: user.following_count,
                totalPosts: user.total_posts,
                totalLikes: user.total_likes,
                joinDate: user.created_at,
                isFollowing: user.is_following,
                isMentor: user.is_mentor,
                mentorProfile,
            };

            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 다른 사용자 정보 조회 실패:`, error);
            throw new Error(`다른 사용자 정보 조회 실패: ${errorMessage}`);
        }
    }
}
