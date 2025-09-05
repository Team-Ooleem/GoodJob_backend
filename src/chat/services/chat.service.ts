import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ChatQueries } from '../queries/chat.queries';

export interface Conversation {
    conversation_id: number;
    other_user_id: number;
    other_user_name: string;
    other_user_profile_img?: string;
    other_user_short_bio?: string;
    last_message?: string;
    last_message_time?: string;
    unread_count: number;
    last_read_time?: string;
}

export interface Message {
    message_id: number;
    sender_id: number;
    receiver_id: number;
    content: string;
    created_at: string;
    is_read: number;
    read_at?: string;
    sender_name: string;
    sender_profile_img?: string;
}

export interface SendMessageRequest {
    sender_id: number;
    receiver_id: number;
    content: string;
}

export interface SearchUserResult {
    user_id: number;
    name: string;
    email: string;
    short_bio?: string;
    profile_img?: string;
    job_info?: string;
}

export interface ChatStats {
    total_conversations: number;
    total_unread_messages: number;
    active_conversations_24h: number;
}

@Injectable()
export class ChatService {
    constructor(private readonly databaseService: DatabaseService) {}

    /**
     * 내 채팅방 목록 조회
     */
    async getMyConversations(userId: number): Promise<{
        success: boolean;
        data?: Conversation[];
        message: string;
    }> {
        try {
            const conversations = await this.databaseService.query(ChatQueries.getMyConversations, [
                userId,
                userId,
                userId,
                userId,
                userId,
            ]);

            return {
                success: true,
                data: conversations,
                message: '채팅방 목록을 성공적으로 조회했습니다.',
            };
        } catch (error) {
            console.error('채팅방 목록 조회 실패:', error);
            return {
                success: false,
                message: '채팅방 목록 조회에 실패했습니다.',
            };
        }
    }

    /**
     * 특정 채팅방의 메시지 조회
     */
    async getMessages(
        conversationId: number,
        limit: number = 50,
        offset: number = 0,
    ): Promise<{
        success: boolean;
        data?: Message[];
        message: string;
    }> {
        try {
            const messages = await this.databaseService.query(
                ChatQueries.getMessagesByConversation,
                [conversationId, limit, offset],
            );

            return {
                success: true,
                data: messages,
                message: '메시지를 성공적으로 조회했습니다.',
            };
        } catch (error) {
            console.error('메시지 조회 실패:', error);
            return {
                success: false,
                message: '메시지 조회에 실패했습니다.',
            };
        }
    }

    /**
     * 두 사용자 간의 채팅방 ID 조회
     */
    async getConversationId(user1Id: number, user2Id: number): Promise<number | null> {
        try {
            const result = await this.databaseService.query(ChatQueries.getConversationId, [
                user1Id,
                user2Id,
                user2Id,
                user1Id,
            ]);

            return result.length > 0
                ? (result[0] as { conversation_id: number }).conversation_id
                : null;
        } catch (error) {
            console.error('채팅방 ID 조회 실패:', error);
            return null;
        }
    }

    /**
     * 1:1 채팅방 생성 또는 조회
     */
    async createOrGetConversation(
        user1Id: number,
        user2Id: number,
    ): Promise<{
        success: boolean;
        conversation_id?: number;
        message: string;
    }> {
        try {
            // 기존 채팅방 조회
            let conversationId = await this.getConversationId(user1Id, user2Id);

            if (!conversationId) {
                // 채팅방 생성
                await this.databaseService.query(ChatQueries.createConversation, [
                    user1Id,
                    user2Id,
                    user1Id,
                    user2Id,
                ]);

                // 생성된 채팅방 ID 조회
                conversationId = await this.getConversationId(user1Id, user2Id);

                if (conversationId) {
                    // 읽음 상태 초기화
                    await this.databaseService.query(ChatQueries.initializeReadStatus, [
                        conversationId,
                        user1Id,
                        conversationId,
                        user2Id,
                    ]);
                }
            }

            if (!conversationId) {
                return {
                    success: false,
                    message: '채팅방 생성에 실패했습니다.',
                };
            }

            return {
                success: true,
                conversation_id: conversationId,
                message: '채팅방을 성공적으로 생성/조회했습니다.',
            };
        } catch (error) {
            console.error('채팅방 생성/조회 실패:', error);
            return {
                success: false,
                message: '채팅방 생성/조회에 실패했습니다.',
            };
        }
    }

    /**
     * 메시지 전송
     */
    async sendMessage(request: SendMessageRequest): Promise<{
        success: boolean;
        message_id?: number;
        conversation_id?: number;
        message: string;
    }> {
        try {
            const { sender_id, receiver_id, content } = request;

            // 유효성 검사
            if (sender_id === receiver_id) {
                return {
                    success: false,
                    message: '자신에게 메시지를 보낼 수 없습니다.',
                };
            }

            if (!content || content.trim().length === 0) {
                return {
                    success: false,
                    message: '메시지 내용을 입력해주세요.',
                };
            }

            if (content.length > 1000) {
                return {
                    success: false,
                    message: '메시지는 1000자 이하로 입력해주세요.',
                };
            }

            // 채팅방 생성 또는 조회
            const conversationResult = await this.createOrGetConversation(sender_id, receiver_id);

            if (!conversationResult.success || !conversationResult.conversation_id) {
                return {
                    success: false,
                    message: '채팅방 생성에 실패했습니다.',
                };
            }

            const conversationId = conversationResult.conversation_id;

            // 메시지 저장
            const result = await this.databaseService.query(ChatQueries.sendMessage, [
                conversationId,
                sender_id,
                receiver_id,
                content.trim(),
            ]);

            const messageId = (result as unknown as { insertId: number }).insertId;

            // 채팅방의 마지막 메시지 정보 업데이트
            await this.databaseService.query(ChatQueries.updateLastMessage, [
                messageId,
                new Date(),
                conversationId,
            ]);

            // 수신자의 읽지 않은 메시지 수 증가
            await this.databaseService.query(ChatQueries.incrementUnreadCount, [
                conversationId,
                receiver_id,
            ]);

            return {
                success: true,
                message_id: messageId,
                conversation_id: conversationId,
                message: '메시지가 성공적으로 전송되었습니다.',
            };
        } catch (error) {
            console.error('메시지 전송 실패:', error);
            return {
                success: false,
                message: '메시지 전송에 실패했습니다.',
            };
        }
    }

    /**
     * 메시지 읽음 처리 (채팅방 진입 시)
     */
    async markAsRead(
        conversationId: number,
        userId: number,
        lastMessageId: number,
    ): Promise<{
        success: boolean;
        message: string;
    }> {
        try {
            await this.databaseService.query(ChatQueries.markAsRead, [
                lastMessageId,
                conversationId,
                userId,
            ]);

            return {
                success: true,
                message: '메시지를 읽음 처리했습니다.',
            };
        } catch (error) {
            console.error('읽음 처리 실패:', error);
            return {
                success: false,
                message: '읽음 처리에 실패했습니다.',
            };
        }
    }

    /**
     * 사용자 검색
     */
    async searchUsers(
        searchTerm: string,
        currentUserId: number,
        limit: number = 20,
    ): Promise<{
        success: boolean;
        data?: SearchUserResult[];
        message: string;
    }> {
        try {
            console.log('🔍 ChatService.searchUsers 호출됨:');
            console.log('  - searchTerm:', searchTerm);
            console.log('  - currentUserId:', currentUserId);
            console.log('  - limit:', limit);

            if (!searchTerm || searchTerm.trim().length < 1) {
                console.log('❌ 검색어가 비어있음');
                return {
                    success: false,
                    message: '검색어를 입력해주세요.',
                };
            }

            console.log('📊 데이터베이스 쿼리 실행 중...');
            console.log('  - 쿼리:', ChatQueries.searchUsers);
            console.log('  - 파라미터:', [currentUserId, searchTerm, searchTerm, limit]);

            const users = await this.databaseService.query(ChatQueries.searchUsers, [
                currentUserId,
                searchTerm,
                searchTerm,
                limit,
            ]);

            console.log('📊 데이터베이스 쿼리 결과:');
            console.log('  - 결과 개수:', users ? users.length : 0);
            console.log('  - 결과 데이터:', users);

            const result = {
                success: true,
                data: users,
                message: '사용자 검색을 완료했습니다.',
            };

            console.log('✅ 최종 응답 데이터:', result);
            return result;
        } catch (error) {
            console.error('❌ 사용자 검색 실패:', error);
            return {
                success: false,
                message: '사용자 검색에 실패했습니다.',
            };
        }
    }

    /**
     * 읽지 않은 메시지가 있는 채팅방 목록 조회
     */
    async getUnreadConversations(userId: number): Promise<{
        success: boolean;
        data?: Conversation[];
        message: string;
    }> {
        try {
            const conversations = await this.databaseService.query(
                ChatQueries.getUnreadConversations,
                [userId, userId, userId, userId, userId],
            );

            return {
                success: true,
                data: conversations,
                message: '읽지 않은 메시지가 있는 채팅방을 조회했습니다.',
            };
        } catch (error) {
            console.error('읽지 않은 채팅방 조회 실패:', error);
            return {
                success: false,
                message: '읽지 않은 채팅방 조회에 실패했습니다.',
            };
        }
    }

    /**
     * 채팅 통계 조회
     */
    async getChatStats(userId: number): Promise<{
        success: boolean;
        data?: ChatStats;
        message: string;
    }> {
        try {
            const result = await this.databaseService.query(ChatQueries.getChatStats, [
                userId,
                userId,
                userId,
            ]);

            return {
                success: true,
                data: result[0] as ChatStats,
                message: '채팅 통계를 조회했습니다.',
            };
        } catch (error) {
            console.error('채팅 통계 조회 실패:', error);
            return {
                success: false,
                message: '채팅 통계 조회에 실패했습니다.',
            };
        }
    }

    /**
     * 채팅방 삭제
     */
    async deleteConversation(
        user1Id: number,
        user2Id: number,
    ): Promise<{
        success: boolean;
        message: string;
    }> {
        try {
            await this.databaseService.query(ChatQueries.deleteConversation, [
                user1Id,
                user2Id,
                user2Id,
                user1Id,
            ]);

            return {
                success: true,
                message: '채팅방이 삭제되었습니다.',
            };
        } catch (error) {
            console.error('채팅방 삭제 실패:', error);
            return {
                success: false,
                message: '채팅방 삭제에 실패했습니다.',
            };
        }
    }
}
