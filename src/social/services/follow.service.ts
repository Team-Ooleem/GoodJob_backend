import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { FollowQueries } from '../queries/follow.queries';

export interface FollowRequest {
    followerId: number; // 팔로우를 누르는 사용자 ID
    followingId: number; // 팔로우할 대상 사용자 ID
}

export interface FollowResponse {
    success: boolean;
    message: string;
    isFollowing: boolean;
}

@Injectable()
export class FollowService {
    constructor(private readonly databaseService: DatabaseService) {}

    /**
     * 팔로우 토글 (팔로우/언팔로우)
     * @param request 팔로우 요청 데이터
     * @returns 팔로우 결과
     */
    async toggleFollow(request: FollowRequest): Promise<FollowResponse> {
        try {
            const { followerId, followingId } = request;

            console.log(
                `👥 팔로우 토글 시작 - followerId: ${followerId}, followingId: ${followingId}`,
            );

            // 자기 자신을 팔로우하는 경우 방지
            if (followerId === followingId) {
                throw new Error('자기 자신을 팔로우할 수 없습니다.');
            }

            // 현재 팔로우 상태 확인
            const followStatusResult = await this.databaseService.query(
                FollowQueries.checkFollowStatus,
                [followerId, followingId],
            );

            const isCurrentlyFollowing =
                (followStatusResult[0] as { is_following: number })?.is_following > 0;
            console.log(`🔍 현재 팔로우 상태: ${isCurrentlyFollowing}`);

            let isFollowing: boolean;
            let message: string;

            if (isCurrentlyFollowing) {
                // 팔로우 취소
                await this.databaseService.query(FollowQueries.removeFollow, [
                    followerId,
                    followingId,
                ]);
                isFollowing = false;
                message = '팔로우를 취소했습니다.';
                console.log(`❌ 팔로우 취소 완료`);
            } else {
                // 팔로우 추가
                await this.databaseService.query(FollowQueries.addFollow, [
                    followerId,
                    followingId,
                ]);
                isFollowing = true;
                message = '팔로우했습니다.';
                console.log(`✅ 팔로우 추가 완료`);
            }

            const response: FollowResponse = {
                success: true,
                message,
                isFollowing,
            };

            console.log(`🎉 팔로우 토글 완료:`, response);
            return response;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 팔로우 토글 실패:`, error);
            throw new Error(`팔로우 토글 실패: ${errorMessage}`);
        }
    }

    /**
     * 팔로우 상태 확인
     * @param followerId 팔로우하는 사용자 ID
     * @param followingId 팔로우받는 사용자 ID
     * @returns 팔로우 상태
     */
    async checkFollowStatus(followerId: number, followingId: number): Promise<boolean> {
        try {
            const result = await this.databaseService.query(FollowQueries.checkFollowStatus, [
                followerId,
                followingId,
            ]);

            return (result[0] as { is_following: number })?.is_following > 0;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 팔로우 상태 확인 실패:`, error);
            throw new Error(`팔로우 상태 확인 실패: ${errorMessage}`);
        }
    }

    /**
     * 사용자의 팔로워 수 조회
     * @param userId 사용자 ID
     * @returns 팔로워 수
     */
    async getFollowerCount(userId: number): Promise<number> {
        try {
            const result = await this.databaseService.query(FollowQueries.getFollowerCount, [
                userId,
            ]);

            return (result[0] as { follower_count: number })?.follower_count || 0;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 팔로워 수 조회 실패:`, error);
            throw new Error(`팔로워 수 조회 실패: ${errorMessage}`);
        }
    }
}
