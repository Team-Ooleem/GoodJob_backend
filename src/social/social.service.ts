import { Injectable } from '@nestjs/common';
import {
    UserProfileService,
    UserProfileInfo,
    UserProfileDetailResponse,
} from './services/user-profile.service';
import {
    PostService,
    PostsResponse,
    CreatePostRequest,
    CreatePostResponse,
    PostLikeRequest,
    PostLikeResponse,
    DeletePostRequest,
    DeletePostResponse,
} from './services/post.service';
import {
    CommentService,
    AddCommentRequest,
    AddCommentResponse,
    DeleteCommentRequest,
    DeleteCommentResponse,
    GetCommentsResponse,
} from './services/comment.service';
import { FollowService, FollowRequest, FollowResponse } from './services/follow.service';

// Re-export interfaces from individual services for backward compatibility
export type { UserProfileInfo, UserProfileDetailResponse } from './services/user-profile.service';
export type {
    Post,
    PostsResponse,
    CreatePostRequest,
    CreatePostResponse,
    PostLikeRequest,
    PostLikeResponse,
    DeletePostRequest,
    DeletePostResponse,
} from './services/post.service';
export type {
    Comment,
    AddCommentRequest,
    AddCommentResponse,
    DeleteCommentRequest,
    DeleteCommentResponse,
    GetCommentsResponse,
} from './services/comment.service';
export type { FollowRequest, FollowResponse } from './services/follow.service';

/**
 * SocialService - Facade 패턴으로 구현된 소셜 기능 통합 서비스
 * 각 도메인별 서비스들을 조합하여 클라이언트에게 단순한 인터페이스 제공
 */
@Injectable()
export class SocialService {
    constructor(
        private readonly userProfileService: UserProfileService,
        private readonly postService: PostService,
        private readonly commentService: CommentService,
        private readonly followService: FollowService,
    ) {}

    // ==================== User Profile 관련 메서드 ====================

    /**
     * 사용자 프로필 정보 조회 (Facade)
     */
    async getUserProfileInfo(userId: number): Promise<UserProfileInfo> {
        return this.userProfileService.getUserProfileInfo(userId);
    }

    /**
     * 사용자 프로필 상세 정보 조회 (프로필 정보 + 포스트 목록) (Facade)
     */
    async getUserProfileDetail(
        targetUserId: number,
        currentUserId: number,
        postsLimit: number = 10,
        postsCursor?: number,
    ): Promise<UserProfileDetailResponse> {
        return this.userProfileService.getUserProfileDetail(
            targetUserId,
            currentUserId,
            postsLimit,
            postsCursor,
        );
    }

    // ==================== Post 관련 메서드 ====================

    /**
     * 포스트 목록 조회 (Facade)
     */
    async getPosts(
        currentUserId: number,
        limit: number = 5,
        cursor?: number,
    ): Promise<PostsResponse> {
        return this.postService.getPosts(currentUserId, limit, cursor);
    }

    /**
     * 포스트 생성 (Facade)
     */
    async createPost(request: CreatePostRequest): Promise<CreatePostResponse> {
        return this.postService.createPost(request);
    }

    /**
     * 포스트 좋아요 토글 (Facade)
     */
    async togglePostLike(request: PostLikeRequest): Promise<PostLikeResponse> {
        return this.postService.togglePostLike(request);
    }

    /**
     * 포스트 삭제 (Facade)
     */
    async deletePost(request: DeletePostRequest): Promise<DeletePostResponse> {
        return this.postService.deletePost(request);
    }

    /**
     * 특정 사용자의 포스트 조회 (Facade)
     */
    async getUserPosts(
        targetUserId: number,
        currentUserId: number,
        limit: number = 10,
        cursor?: number,
    ): Promise<PostsResponse> {
        return this.postService.getUserPosts(targetUserId, currentUserId, limit, cursor);
    }

    // ==================== Comment 관련 메서드 ====================

    /**
     * 댓글 추가 (Facade)
     */
    async addComment(request: AddCommentRequest): Promise<AddCommentResponse> {
        return this.commentService.addComment(request);
    }

    /**
     * 댓글 삭제 (Facade)
     */
    async deleteComment(request: DeleteCommentRequest): Promise<DeleteCommentResponse> {
        return this.commentService.deleteComment(request);
    }

    /**
     * 포스트 댓글 조회 (Facade)
     */
    async getComments(postId: number): Promise<GetCommentsResponse> {
        return this.commentService.getComments(postId);
    }

    // ==================== Follow 관련 메서드 ====================

    /**
     * 팔로우 토글 (Facade)
     */
    async toggleFollow(request: FollowRequest): Promise<FollowResponse> {
        return this.followService.toggleFollow(request);
    }
}
