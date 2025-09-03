import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UserProfileQueries } from '../queries/user-profile.queries';
import { FollowService } from './follow.service';

export interface UserProfileInfo {
    name: string;
    profileImage?: string;
    shortBio?: string;
    bio?: string;
    jobTitle: string;
    residence: string;
    followerCount: number;
}

@Injectable()
export class UserProfileService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly followService: FollowService,
    ) {}

    /**
     * 사용자 프로필 정보 조회
     * @param userId 사용자 ID
     * @returns 사용자 프로필 정보
     */
    async getUserProfileInfo(userId: number): Promise<UserProfileInfo> {
        try {
            console.log(`🔍 사용자 프로필 정보 조회 시작 - userId: ${userId}`);

            // 사용자 기본 정보 조회
            console.log(`📝 사용자 쿼리 실행: ${UserProfileQueries.getUserBasicInfo}`);
            const userResult = await this.databaseService.query(
                UserProfileQueries.getUserBasicInfo,
                [userId],
            );
            console.log(`👤 사용자 조회 결과:`, userResult);

            if (!userResult || userResult.length === 0) {
                console.log(`❌ 사용자를 찾을 수 없음 - userId: ${userId}`);
                throw new Error('사용자를 찾을 수 없습니다.');
            }

            const user = userResult[0] as {
                name: string;
                short_bio: string;
                bio: string;
                profile_img: string;
            };
            console.log(`✅ 사용자 정보 파싱 완료:`, user);

            // 개인 프로필 정보 조회 (희망 직종, 거주지, 희망 연봉)
            console.log(`📝 프로필 쿼리 실행: ${UserProfileQueries.getIndividualProfile}`);
            const profileResult = await this.databaseService.query(
                UserProfileQueries.getIndividualProfile,
                [userId],
            );
            console.log(`👤 프로필 조회 결과:`, profileResult);

            // 직종 정보 조회
            let jobTitle = '직종 미설정';
            if (profileResult && profileResult.length > 0) {
                const profile = profileResult[0] as {
                    desired_job: number;
                    desired_sido: string;
                    desired_gu: string;
                };
                console.log(`📋 프로필 정보 파싱:`, profile);
                if (profile.desired_job) {
                    console.log(
                        `💼 직종 쿼리 실행: ${UserProfileQueries.getJobRole} - jobId: ${profile.desired_job}`,
                    );
                    const jobResult = await this.databaseService.query(
                        UserProfileQueries.getJobRole,
                        [profile.desired_job],
                    );
                    console.log(`💼 직종 조회 결과:`, jobResult);
                    if (jobResult && jobResult.length > 0) {
                        jobTitle = (jobResult[0] as { name: string }).name;
                        console.log(`✅ 직종 설정 완료: ${jobTitle}`);
                    }
                }
            }

            // 거주지 정보 조회
            let residence = '거주지 미설정';
            if (profileResult && profileResult.length > 0) {
                const profile = profileResult[0] as {
                    desired_job: number;
                    desired_sido: string;
                    desired_gu: string;
                };
                if (profile.desired_sido && profile.desired_gu) {
                    console.log(
                        `📍 위치 쿼리 실행: ${UserProfileQueries.getLocation} - sido: ${profile.desired_sido}, gu: ${profile.desired_gu}`,
                    );
                    const locationResult = await this.databaseService.query(
                        UserProfileQueries.getLocation,
                        [profile.desired_sido, profile.desired_gu],
                    );
                    console.log(`📍 위치 조회 결과:`, locationResult);
                    if (locationResult && locationResult.length > 0) {
                        residence = (locationResult[0] as { full_location: string }).full_location;
                        console.log(`✅ 거주지 설정 완료: ${residence}`);
                    }
                }
            }

            // 팔로워 수 조회
            console.log(`👥 팔로워 수 조회 시작`);
            const followerCount = await this.followService.getFollowerCount(userId);
            console.log(`👥 팔로워 수 조회 완료: ${followerCount}`);

            const result = {
                name: user.name,
                profileImage: user.profile_img,
                shortBio: user.short_bio,
                bio: user.bio,
                jobTitle,
                residence,
                followerCount,
            };

            console.log(`🎉 최종 결과:`, result);
            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 에러 발생:`, error);
            console.error(`❌ 에러 스택:`, error instanceof Error ? error.stack : 'No stack trace');
            throw new Error(`사용자 프로필 정보 조회 실패: ${errorMessage}`);
        }
    }
}
