import {
    Controller,
    Get,
    Post,
    Param,
    ParseIntPipe,
    Body,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import {
    CommentService,
    AddCommentRequest,
    AddCommentResponse,
    DeleteCommentRequest,
    DeleteCommentResponse,
    GetCommentsResponse,
} from '../services/comment.service';

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
     * Body: { userId: number, content: string }
     */
    @Post('posts/:postId/comments')
    async addComment(
        @Param('postId', ParseIntPipe) postId: number,
        @Body() body: { userId: number; content: string },
    ): Promise<AddCommentResponse> {
        try {
            const request: AddCommentRequest = {
                postId,
                userId: body.userId,
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
     * Body: { userId: number }
     */
    @Post('comments/:commentId/delete')
    async deleteComment(
        @Param('commentId', ParseIntPipe) commentId: number,
        @Body() body: { userId: number },
    ): Promise<DeleteCommentResponse> {
        try {
            const request: DeleteCommentRequest = {
                commentId,
                userId: body.userId,
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
