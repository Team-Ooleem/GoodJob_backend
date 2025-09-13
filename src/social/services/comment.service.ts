import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CommentQueries } from '../queries/comment.queries';

export interface Comment {
    commentId: number;
    postIdx: number;
    userId: number;
    userName: string;
    userProfileImage?: string;
    content: string;
    createdAt: string;
}

export interface AddCommentRequest {
    postId: number;
    userId: number;
    content: string;
}

export interface AddCommentResponse {
    success: boolean;
    message: string;
    commentId?: number;
}

export interface DeleteCommentRequest {
    commentId: number;
    userId: number;
}

export interface DeleteCommentResponse {
    success: boolean;
    message: string;
}

export interface GetCommentsResponse {
    success: boolean;
    comments: Comment[];
    totalCount: number;
}

@Injectable()
export class CommentService {
    constructor(private readonly databaseService: DatabaseService) {}

    /**
     * 댓글 추가
     * @param request 댓글 추가 요청 데이터
     * @returns 댓글 추가 결과
     */
    async addComment(request: AddCommentRequest): Promise<AddCommentResponse> {
        try {
            const { postId, userId, content } = request;

            console.log(`💬 댓글 추가 시작 - postId: ${postId}, userId: ${userId}`);

            // 댓글 내용 검증
            if (!content || content.trim().length === 0) {
                throw new Error('댓글 내용을 입력해주세요.');
            }

            if (content.length > 500) {
                throw new Error('댓글은 500자를 초과할 수 없습니다.');
            }

            // 포스트 존재 여부 확인
            const postResult = await this.databaseService.query(
                'SELECT user_id FROM posts WHERE post_idx = ?',
                [postId],
            );

            if (!postResult || postResult.length === 0) {
                throw new Error('포스트를 찾을 수 없습니다.');
            }

            // 댓글 추가
            await this.databaseService.query(CommentQueries.addPostComment, [
                postId,
                userId,
                content.trim(),
            ]);

            // 생성된 댓글 ID 가져오기
            const insertIdResult = await this.databaseService.query(
                'SELECT LAST_INSERT_ID() as commentId',
                [],
            );
            const commentId = (insertIdResult[0] as { commentId: number })?.commentId;

            console.log(`✅ 댓글 추가 완료 - commentId: ${commentId}`);

            return {
                success: true,
                message: '댓글이 성공적으로 추가되었습니다.',
                commentId,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 댓글 추가 실패:`, error);
            throw new Error(`댓글 추가 실패: ${errorMessage}`);
        }
    }

    /**
     * 댓글 삭제
     * @param request 댓글 삭제 요청 데이터
     * @returns 댓글 삭제 결과
     */
    async deleteComment(request: DeleteCommentRequest): Promise<DeleteCommentResponse> {
        try {
            const { commentId, userId } = request;

            // 댓글 삭제 (작성자만 삭제 가능)
            await this.databaseService.query(CommentQueries.deletePostComment, [commentId, userId]);

            return {
                success: true,
                message: '댓글이 성공적으로 삭제되었습니다.',
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 댓글 삭제 실패:`, error);
            throw new Error(`댓글 삭제 실패: ${errorMessage}`);
        }
    }

    /**
     * 포스트 댓글 조회 (전체)
     * @param postId 포스트 ID
     * @returns 댓글 목록
     */
    async getComments(postId: number): Promise<GetCommentsResponse> {
        try {
            console.log(`📝 댓글 조회 시작 - postId: ${postId}`);

            const result = await this.databaseService.query(CommentQueries.getPostComments, [
                postId,
            ]);

            const comments: Comment[] = result.map(
                (row: {
                    comment_id: number;
                    post_idx: number;
                    user_id: number;
                    user_name: string;
                    user_profile_image?: string;
                    content: string;
                    created_at: string;
                }) => ({
                    commentId: row.comment_id,
                    postIdx: row.post_idx,
                    userId: row.user_id,
                    userName: row.user_name,
                    userProfileImage: row.user_profile_image,
                    content: row.content,
                    createdAt: row.created_at,
                }),
            );

            console.log(`✅ 댓글 조회 완료 - 댓글 수: ${comments.length}`);

            return {
                success: true,
                comments,
                totalCount: comments.length,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 댓글 조회 실패:`, error);
            throw new Error(`댓글 조회 실패: ${errorMessage}`);
        }
    }
}
