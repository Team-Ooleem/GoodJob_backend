import {
    Controller,
    Get,
    Post,
    Param,
    ParseIntPipe,
    Body,
    HttpException,
    HttpStatus,
    Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
    CommentService,
    AddCommentRequest,
    AddCommentResponse,
    DeleteCommentRequest,
    DeleteCommentResponse,
    GetCommentsResponse,
} from '../services/comment.service';

interface AuthenticatedRequest extends Request {
    user_idx: number;
}

@Controller('social')
export class CommentController {
    constructor(private readonly commentService: CommentService) {}

    /**
     * 댓글 조회 (전체)
     * GET /social/posts/:postId/comments
     */
    @Get('posts/:postId/comments')
    async getComments(@Param('postId', ParseIntPipe) postId: number): Promise<GetCommentsResponse> {
        try {
            const result = await this.commentService.getComments(postId);
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
     * 댓글 추가
     * POST /social/posts/:postId/comments
     * Body: { content: string }
     */
    @Post('posts/:postId/comments')
    async addComment(
        @Param('postId', ParseIntPipe) postId: number,
        @Body() body: { content: string },
        @Req() req: AuthenticatedRequest,
    ): Promise<AddCommentResponse> {
        try {
            const userId = req.user_idx;
            const request: AddCommentRequest = {
                postId,
                userId,
                content: body.content,
            };

            const result = await this.commentService.addComment(request);
            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

            // 클라이언트 오류 (400 Bad Request)
            if (
                errorMessage.includes('댓글 내용을 입력해주세요') ||
                errorMessage.includes('500자를 초과할 수 없습니다') ||
                errorMessage.includes('자신의 글에는 댓글을 달 수 없습니다') ||
                errorMessage.includes('포스트를 찾을 수 없습니다')
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
     * 댓글 삭제
     * POST /social/comments/:commentId/delete
     */
    @Post('comments/:commentId/delete')
    async deleteComment(
        @Param('commentId', ParseIntPipe) commentId: number,
        @Req() req: AuthenticatedRequest,
    ): Promise<DeleteCommentResponse> {
        try {
            const userId = req.user_idx;
            const request: DeleteCommentRequest = {
                commentId,
                userId,
            };

            const result = await this.commentService.deleteComment(request);
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
}
