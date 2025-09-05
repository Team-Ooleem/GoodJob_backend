import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { PostQueries } from '../queries/post.queries';
import { LikeQueries } from '../queries/like.queries';
import { uploadFileToS3, generateS3Key } from '../../lib/s3';

export interface Post {
    postIdx: number;
    userId: number;
    content: string;
    mediaUrl?: string;
    createdAt: string;
    updatedAt: string;
    authorName: string;
    authorProfileImage?: string;
    authorShortBio?: string;
    likeCount: number;
    commentCount: number;
    isLikedByCurrentUser: boolean;
    isFollowingAuthor: boolean;
}

export interface PostsResponse {
    posts: Post[];
    nextCursor?: number;
    hasMore: boolean;
}

export interface CreatePostRequest {
    userId: number;
    content: string;
    imageFile?: any; // Express.Multer.File
}

export interface CreatePostResponse {
    success: boolean;
    postId?: number;
    message: string;
    imageUrl?: string;
}

export interface PostLikeRequest {
    postId: number;
    userId: number;
}

export interface PostLikeResponse {
    success: boolean;
    message: string;
    isLiked: boolean;
    likeCount: number;
}

export interface DeletePostRequest {
    postId: number;
    userId: number;
}

export interface DeletePostResponse {
    success: boolean;
    message: string;
}

interface PostRow {
    post_idx: number;
    user_id: number;
    content: string;
    media_url?: string;
    created_at: string;
    updated_at: string;
    author_name: string;
    author_profile_image?: string;
    author_short_bio?: string;
    like_count: number;
    comment_count: number;
    is_liked_by_current_user: number;
    is_following_author: number;
}

@Injectable()
export class PostService {
    constructor(private readonly databaseService: DatabaseService) {}

    /**
     * 포스트 목록 조회 (cursor 기반 페이지네이션)
     * @param currentUserId - 현재 사용자 ID
     * @param limit - 조회할 포스트 수 (기본값: 5)
     * @param cursor - 커서 (post_idx 기준, null이면 처음부터)
     */
    async getPosts(
        currentUserId: number,
        limit: number = 5,
        cursor?: number,
    ): Promise<PostsResponse> {
        try {
            const queryParams = [
                Number(currentUserId), // 좋아요 확인용 (user_like)
                Number(currentUserId), // 팔로우 확인용 (follow)
                cursor ?? null, // WHERE 조건 첫 번째 cursor
                cursor ?? null, // WHERE 조건 두 번째 cursor
                Number(limit), // LIMIT
            ];

            const result = await this.databaseService.query(PostQueries.getPosts, queryParams);

            const posts: Post[] = result.map((row: PostRow) => ({
                postIdx: row.post_idx,
                userId: row.user_id,
                content: row.content,
                mediaUrl: row.media_url,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                authorName: row.author_name,
                authorProfileImage: row.author_profile_image,
                authorShortBio: row.author_short_bio,
                likeCount: row.like_count,
                commentCount: row.comment_count,
                isLikedByCurrentUser: row.is_liked_by_current_user === 1,
                isFollowingAuthor: row.is_following_author === 1,
            }));

            const nextCursor = posts.length > 0 ? posts[posts.length - 1].postIdx : undefined;
            const hasMore = posts.length === limit;

            const response: PostsResponse = {
                posts,
                nextCursor,
                hasMore,
            };

            return response;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 포스트 목록 조회 실패:`, error);
            throw new Error(`포스트 목록 조회 실패: ${errorMessage}`);
        }
    }

    /**
     * 포스트 생성 (텍스트 500자 제한, 단일 이미지)
     * @param request 포스트 생성 요청 데이터
     * @returns 포스트 생성 결과
     */
    async createPost(request: CreatePostRequest): Promise<CreatePostResponse> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const { userId, content, imageFile } = request;

            console.log(`📝 포스트 생성 시작 - userId: ${userId}, content 길이: ${content.length}`);

            // 텍스트 길이 검증 (500자 제한)
            if (content.length > 500) {
                throw new Error('포스트 내용은 500자를 초과할 수 없습니다.');
            }

            if (content.trim().length === 0) {
                throw new Error('포스트 내용을 입력해주세요.');
            }

            let imageUrl: string | undefined;

            // 이미지 파일이 있는 경우 처리
            if (imageFile) {
                // S3 키 생성
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
                const s3Key = generateS3Key(imageFile.originalname || 'image', 'posts');

                // S3에 이미지 업로드 (S3에서 validation 처리)
                const uploadResult = await uploadFileToS3(
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
                    imageFile.buffer || Buffer.alloc(0),
                    s3Key,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
                    imageFile.mimetype || 'image/jpeg',
                );

                if (!uploadResult.success) {
                    throw new Error(`이미지 업로드 실패: ${uploadResult.error}`);
                }

                imageUrl = uploadResult.url;
            }

            // 데이터베이스에 포스트 저장
            const result = await this.databaseService.query(PostQueries.createPost, [
                userId,
                content,
                imageUrl || null,
            ]);

            console.log(`💾 포스트 저장 결과:`, result);

            // 생성된 포스트 ID 가져오기 (MySQL의 LAST_INSERT_ID() 사용)
            const insertIdResult = await this.databaseService.query(
                'SELECT LAST_INSERT_ID() as postId',
                [],
            );
            const postId = (insertIdResult[0] as { postId: number })?.postId;

            return {
                success: true,
                postId,
                message: '포스트가 성공적으로 생성되었습니다.',
                imageUrl,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 포스트 생성 실패:`, error);
            throw new Error(`포스트 생성 실패: ${errorMessage}`);
        }
    }

    /**
     * 포스트 좋아요 토글 (추천 기능)
     * @param request 포스트 좋아요 요청 데이터
     * @returns 포스트 좋아요 결과
     */
    async togglePostLike(request: PostLikeRequest): Promise<PostLikeResponse> {
        try {
            const { postId, userId } = request;

            console.log(`👍 포스트 좋아요 토글 시작 - postId: ${postId}, userId: ${userId}`);

            // 현재 좋아요 상태 확인
            const likeStatusResult = await this.databaseService.query(
                LikeQueries.checkPostLikeStatus,
                [postId, userId],
            );

            const isCurrentlyLiked = (likeStatusResult[0] as { is_liked: number })?.is_liked > 0;
            console.log(`🔍 현재 좋아요 상태: ${isCurrentlyLiked}`);

            let isLiked: boolean;
            let message: string;

            if (isCurrentlyLiked) {
                // 좋아요 취소 (DELETE)
                await this.databaseService.query(LikeQueries.removePostLike, [postId, userId]);
                isLiked = false;
                message = '좋아요를 취소했습니다.';
            } else {
                // 좋아요 추가 (INSERT)
                await this.databaseService.query(LikeQueries.addPostLike, [postId, userId]);
                isLiked = true;
                message = '좋아요를 눌렀습니다.';
            }

            // 현재 좋아요 수 조회
            const likeCountResult = await this.databaseService.query(LikeQueries.getPostLikeCount, [
                postId,
            ]);
            const likeCount = (likeCountResult[0] as { like_count: number })?.like_count || 0;

            const response: PostLikeResponse = {
                success: true,
                message,
                isLiked,
                likeCount,
            };

            return response;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 포스트 좋아요 토글 실패:`, error);
            throw new Error(`포스트 좋아요 토글 실패: ${errorMessage}`);
        }
    }

    /**
     * 특정 사용자의 포스트 조회 (cursor 기반 페이지네이션)
     * @param targetUserId - 조회할 사용자 ID
     * @param currentUserId - 현재 사용자 ID (좋아요, 팔로우 상태 확인용)
     * @param limit - 조회할 포스트 수 (기본값: 10)
     * @param cursor - 커서 (post_idx 기준, null이면 처음부터)
     */
    async getUserPosts(
        targetUserId: number,
        currentUserId: number,
        limit: number = 10,
        cursor?: number,
    ): Promise<PostsResponse> {
        try {
            console.log(
                `👤 사용자 포스트 조회 시작 - targetUserId: ${targetUserId}, currentUserId: ${currentUserId}`,
            );

            const queryParams = [
                Number(currentUserId), // 좋아요 확인용 (user_like)
                Number(currentUserId), // 팔로우 확인용 (follow)
                Number(targetUserId), // 조회할 사용자 ID
                cursor ?? null, // WHERE 조건 첫 번째 cursor
                cursor ?? null, // WHERE 조건 두 번째 cursor
                Number(limit), // LIMIT
            ];

            const result = await this.databaseService.query(PostQueries.getUserPosts, queryParams);

            const posts: Post[] = result.map((row: PostRow) => ({
                postIdx: row.post_idx,
                userId: row.user_id,
                content: row.content,
                mediaUrl: row.media_url,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                authorName: row.author_name,
                authorProfileImage: row.author_profile_image,
                authorShortBio: row.author_short_bio,
                likeCount: row.like_count,
                commentCount: row.comment_count,
                isLikedByCurrentUser: row.is_liked_by_current_user === 1,
                isFollowingAuthor: row.is_following_author === 1,
            }));

            const nextCursor = posts.length > 0 ? posts[posts.length - 1].postIdx : undefined;
            const hasMore = posts.length === limit;

            const response: PostsResponse = {
                posts,
                nextCursor,
                hasMore,
            };

            console.log(
                `✅ 사용자 포스트 조회 완료 - 포스트 수: ${posts.length}, hasMore: ${hasMore}`,
            );
            return response;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 사용자 포스트 조회 실패:`, error);
            throw new Error(`사용자 포스트 조회 실패: ${errorMessage}`);
        }
    }

    /**
     * 포스트 삭제
     * @param request 포스트 삭제 요청 데이터
     * @returns 포스트 삭제 결과
     */
    async deletePost(request: DeletePostRequest): Promise<DeletePostResponse> {
        try {
            const { postId, userId } = request;

            console.log(`🗑️ 포스트 삭제 시작 - postId: ${postId}, userId: ${userId}`);

            // 포스트 존재 여부 및 작성자 확인
            const postResult = await this.databaseService.query(PostQueries.getPostById, [postId]);

            if (!postResult || postResult.length === 0) {
                throw new Error('포스트를 찾을 수 없습니다.');
            }

            const post = postResult[0] as { user_id: number };
            if (post.user_id !== userId) {
                throw new Error('본인의 포스트만 삭제할 수 있습니다.');
            }

            // 포스트 삭제 (작성자만 삭제 가능)
            await this.databaseService.query(PostQueries.deletePost, [postId, userId]);

            console.log(`✅ 포스트 삭제 완료`);

            return {
                success: true,
                message: '포스트가 성공적으로 삭제되었습니다.',
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`❌ 포스트 삭제 실패:`, error);
            throw new Error(`포스트 삭제 실패: ${errorMessage}`);
        }
    }
}
