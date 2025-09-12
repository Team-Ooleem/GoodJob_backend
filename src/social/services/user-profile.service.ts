import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UserProfileQueries } from '../queries/user-profile.queries';
import { FollowService } from './follow.service';
import { PostService, Post } from './post.service';

export interface UserProfileInfo {
    name: string;
    profileImage?: string;
    bio?: string;
    phone?: string;
    email?: string;
    followerCount: number;
    followingCount: number;
    isFollowing?: boolean; // 현재 사용자가 이 사용자를 팔로우하고 있는지 여부
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
                bio: string;
                profile_img: string;
                phone: string;
                email: string;
            };

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

            const result: UserProfileInfo = {
                name: user.name,
                profileImage: user.profile_img,
                bio: user.bio,
                phone: user.phone,
                email: user.email,
                followerCount,
                followingCount,
                isFollowing,
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
