import { Controller, Post, Body, HttpException, HttpStatus, Req } from '@nestjs/common';
import type { Request } from 'express';
import { FollowService, FollowRequest, FollowResponse } from '../services/follow.service';

interface AuthenticatedRequest extends Request {
    user_idx: number;
}

@Controller('social')
export class FollowController {
    constructor(private readonly followService: FollowService) {}

    /**
     * 팔로우 토글 (팔로우/언팔로우)
     * POST /social/follow
     * Body: { followingId: number }
     */
    @Post('follow')
    async toggleFollow(
        @Body() body: { followingId: number },
        @Req() req: AuthenticatedRequest,
    ): Promise<FollowResponse> {
        try {
            const followerId = req.user_idx;
            const request: FollowRequest = {
                followerId,
                followingId: body.followingId,
            };

            const result = await this.followService.toggleFollow(request);
            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

            // 클라이언트 오류 (400 Bad Request)
            if (errorMessage.includes('자기 자신을 팔로우할 수 없습니다')) {
                throw new HttpException(
                    {
                        status: HttpStatus.BAD_REQUEST,
                        error: errorMessage,
                    },
                    HttpStatus.BAD_REQUEST,
                );
            }

            // 서버 오류 (500 Internal Server Error)
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
