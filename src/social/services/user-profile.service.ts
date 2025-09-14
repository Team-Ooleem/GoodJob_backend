import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UserProfileQueries } from '../queries/user-profile.queries';
import { FollowService } from './follow.service';
import { uploadFileToS3, validateImageFile, generateS3Key } from '../../lib/s3';
import { AppConfigService } from '../../config/config.service';

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

// 다른 사용자 프로필 조회용 (팔로우 상태 포함)
export interface UserProfileInfo {
    userIdx: number;
    name: string;
    profileImage?: string;
    bio?: string;
    followerCount: number;
    followingCount: number;
    totalPosts: number;
    totalLikes: number;
    joinDate: string;
    isMentor: boolean;
    isFollowing: boolean; // 현재 사용자가 이 사용자를 팔로우하고 있는지
    mentorProfile?: {
        businessName: string;
        preferredField: string;
        isApproved: boolean;
        totalMentoringSessions: number;
        totalMentoringReviews: number;
        avgMentoringRating: number;
        totalMentoringApplications: number;
        introduction: string; // 멘토 소개글
        portfolioLink?: string;
    };
}

@Injectable()
export class UserProfileService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly followService: FollowService,
        private readonly configService: AppConfigService,
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
     * 다른 사용자 프로필 조회 (팔로우 상태 포함)
     * @param currentUserId 현재 로그인한 사용자 ID
     * @param targetUserId 조회할 대상 사용자 ID
     * @returns 사용자 프로필 정보
     */
    async getUserProfileInfo(
        currentUserId: number,
        targetUserId: number,
    ): Promise<UserProfileInfo> {
        try {
            // 사용자 기본 정보 조회 (팔로우 상태 포함)
            const userResult = await this.databaseService.query(
                UserProfileQueries.getUserProfileDetail,
                [currentUserId, targetUserId],
            );

            if (!userResult || userResult.length === 0) {
                throw new Error('사용자를 찾을 수 없습니다.');
            }

            const user = userResult[0] as {
                user_idx: number;
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
                introduction: string;
                portfolio_link: string;
                preferred_field_name: string;
                is_approved: boolean;
                total_mentoring_sessions: number;
                total_mentoring_reviews: number;
                avg_mentoring_rating: number;
                total_mentoring_applications: number;
            };

            const isMentor = !!user.is_mentor;
            const mentorProfile = isMentor
                ? {
                      businessName: user.business_name,
                      preferredField: user.preferred_field_name,
                      isApproved: user.is_approved,
                      totalMentoringSessions: user.total_mentoring_sessions,
                      totalMentoringReviews: user.total_mentoring_reviews,
                      avgMentoringRating: user.avg_mentoring_rating,
                      totalMentoringApplications: user.total_mentoring_applications,
                      introduction: user.introduction || '', // 멘토 소개글
                      portfolioLink: user.portfolio_link || undefined, // 포트폴리오 링크
                  }
                : undefined;

            const result: UserProfileInfo = {
                userIdx: user.user_idx,
                name: user.name,
                profileImage: user.profile_img,
                bio: user.bio,
                followerCount: user.follower_count,
                followingCount: user.following_count,
                totalPosts: user.total_posts,
                totalLikes: user.total_likes,
                joinDate: user.created_at,
                isMentor,
                isFollowing: user.is_following,
                mentorProfile,
            };

            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 사용자 프로필 조회 실패:`, error);
            throw new Error(`사용자 프로필 조회 실패: ${errorMessage}`);
        }
    }

    /**
     * 프로필 이미지 업로드 및 업데이트
     * @param userId 사용자 ID
     * @param file 업로드된 파일
     * @returns 업로드 결과
     */
    async uploadProfileImage(userId: number, file: Express.Multer.File) {
        try {
            // 사용자 존재 여부 확인
            const userCheck = await this.databaseService.query(
                'SELECT idx FROM users WHERE idx = ?',
                [userId],
            );

            if (!userCheck || userCheck.length === 0) {
                throw new Error('사용자를 찾을 수 없습니다.');
            }

            // 이미지 파일 유효성 검증
            const validation = validateImageFile(file);
            if (!validation.isValid) {
                throw new Error(validation.error);
            }

            // S3 키 생성
            const s3Key = generateS3Key(file.originalname || 'profile-image', 'profile-images');

            // S3에 이미지 업로드
            const uploadResult = await uploadFileToS3(
                file.buffer,
                s3Key,
                file.mimetype,
                this.configService.aws,
            );

            if (!uploadResult.success) {
                throw new Error(`이미지 업로드 실패: ${uploadResult.error}`);
            }

            // 데이터베이스에 프로필 이미지 URL 업데이트
            await this.databaseService.query(
                'UPDATE users SET profile_img = ?, updated_at = NOW() WHERE idx = ?',
                [uploadResult.url, userId],
            );

            return {
                success: true,
                message: '프로필 이미지가 성공적으로 업로드되었습니다.',
                profileImageUrl: uploadResult.url,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 프로필 이미지 업로드 실패:`, error);
            throw new Error(`프로필 이미지 업로드 실패: ${errorMessage}`);
        }
    }
}
