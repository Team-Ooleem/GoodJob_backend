import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    ParseIntPipe,
    Query,
    Body,
    UploadedFile,
    UseInterceptors,
    HttpException,
    HttpStatus,
    Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

interface AuthenticatedRequest extends Request {
    user_idx: number;
}
import {
    PostService,
    PostsResponse,
    CreatePostRequest,
    CreatePostResponse,
    PostLikeRequest,
    PostLikeResponse,
    DeletePostRequest,
    DeletePostResponse,
} from '../services/post.service';

@Controller('social/posts')
export class PostController {
    constructor(private readonly postService: PostService) {}

    /**
     * 포스트 목록 조회 (cursor 기반 페이지네이션)
     * GET /social/posts?limit=5&cursor=20
     */
    @Get()
    async getPosts(
        @Req() req: AuthenticatedRequest,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ): Promise<PostsResponse> {
        try {
            const currentUserIdNum = req.user_idx;
            const limitNum = limit ? parseInt(limit, 10) : 5;
            const cursorNum = cursor ? parseInt(cursor, 10) : undefined;

            const posts = await this.postService.getPosts(currentUserIdNum, limitNum, cursorNum);
            return posts;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

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
     * 포스트 생성 (텍스트 + 이미지)
     * POST /social/posts
     * Content-Type: multipart/form-data
     * Body: { content: string, image?: File }
     */
    @Post()
    @UseInterceptors(FileInterceptor('image'))
    async createPost(
        @Body() body: { content: string },
        @Req() req: AuthenticatedRequest,
        @UploadedFile() imageFile?: any,
    ): Promise<CreatePostResponse> {
        try {
            const userId = req.user_idx;
            const { content } = body;

            const request: CreatePostRequest = {
                userId,
                content,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                imageFile,
            };

            const result = await this.postService.createPost(request);
            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

            // 클라이언트 오류 (400 Bad Request)
            if (
                errorMessage.includes('500자를 초과할 수 없습니다') ||
                errorMessage.includes('포스트 내용을 입력해주세요') ||
                errorMessage.includes('유효한 사용자 ID')
            ) {
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

    /**
     * 포스트 좋아요 토글 (추천 기능)
     * POST /social/posts/:postId/like
     */
    @Post(':postId/like')
    async togglePostLike(
        @Param('postId', ParseIntPipe) postId: number,
        @Req() req: AuthenticatedRequest,
    ): Promise<PostLikeResponse> {
        try {
            const userId = req.user_idx;
            const request: PostLikeRequest = {
                postId,
                userId,
            };

            const result = await this.postService.togglePostLike(request);
            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

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

    /**
     * 특정 사용자의 포스트 조회 (cursor 기반 페이지네이션)
     * GET /social/posts/user/:userId?limit=10&cursor=20
     */
    @Get('user/:userId')
    async getUserPosts(
        @Param('userId', ParseIntPipe) userId: number,
        @Req() req: AuthenticatedRequest,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ): Promise<PostsResponse> {
        try {
            const currentUserIdNum = req.user_idx;
            const limitNum = limit ? parseInt(limit, 10) : 10;
            const cursorNum = cursor ? parseInt(cursor, 10) : undefined;

            const posts = await this.postService.getUserPosts(
                userId,
                currentUserIdNum,
                limitNum,
                cursorNum,
            );
            return posts;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

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
     * 포스트 삭제
     * DELETE /social/posts/:postId
     */
    @Delete(':postId')
    async deletePost(
        @Param('postId', ParseIntPipe) postId: number,
        @Req() req: AuthenticatedRequest,
    ): Promise<DeletePostResponse> {
        try {
            const userId = req.user_idx;
            const request: DeletePostRequest = {
                postId,
                userId,
            };

            const result = await this.postService.deletePost(request);
            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

            // 클라이언트 오류 (400 Bad Request)
            if (
                errorMessage.includes('포스트를 찾을 수 없습니다') ||
                errorMessage.includes('본인의 포스트만 삭제할 수 있습니다')
            ) {
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
