import {
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Query,
    HttpException,
    HttpStatus,
    Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
    UserProfileService,
    UserProfileInfo,
    UserProfileDetailResponse,
} from '../services/user-profile.service';

interface AuthenticatedRequest extends Request {
    user_idx: number;
}

@Controller('social/profile')
export class UserProfileController {
    constructor(private readonly userProfileService: UserProfileService) {}

    /**
     * 사용자 프로필 정보 조회
     * GET /social/profile/:userId
     */
    @Get(':userId')
    async getUserProfile(
        @Param('userId', ParseIntPipe) userId: number,
        @Req() req: AuthenticatedRequest,
    ): Promise<UserProfileInfo> {
        const currentUserId = req.user_idx;
        try {
            const userProfile = await this.userProfileService.getUserProfileInfo(
                userId,
                currentUserId,
            );

            // 성공 응답 (200 OK)
            return userProfile;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

            // 사용자를 찾을 수 없는 경우 (404 Not Found)
            if (errorMessage.includes('사용자를 찾을 수 없습니다')) {
                throw new HttpException(
                    {
                        status: HttpStatus.NOT_FOUND,
                        error: errorMessage,
                    },
                    HttpStatus.NOT_FOUND,
                );
            }

            // 기타 서버 오류 (500 Internal Server Error)
            throw new HttpException(
                {
                    status: HttpStatus.INTERNAL_SERVER_ERROR,
                    error: errorMessage,
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    /**
     * 사용자 프로필 상세 정보 조회 (프로필 정보 + 포스트 목록)
     * GET /social/profile/:userId/detail
     */
    @Get(':userId/detail')
    async getUserProfileDetail(
        @Param('userId', ParseIntPipe) userId: number,
        @Req() req: AuthenticatedRequest,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ): Promise<UserProfileDetailResponse> {
        try {
            const currentUserId = req.user_idx;
            const postsLimit = limit ? parseInt(limit, 10) : 10;
            const postsCursor = cursor ? parseInt(cursor, 10) : undefined;

            const userProfileDetail = await this.userProfileService.getUserProfileDetail(
                userId,
                currentUserId,
                postsLimit,
                postsCursor,
            );

            // 성공 응답 (200 OK)
            return userProfileDetail;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

            // 사용자를 찾을 수 없는 경우 (404 Not Found)
            if (errorMessage.includes('사용자를 찾을 수 없습니다')) {
                throw new HttpException(
                    {
                        status: HttpStatus.NOT_FOUND,
                        error: errorMessage,
                    },
                    HttpStatus.NOT_FOUND,
                );
            }

            // 기타 서버 오류 (500 Internal Server Error)
            throw new HttpException(
                {
                    status: HttpStatus.INTERNAL_SERVER_ERROR,
                    error: errorMessage,
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
}
