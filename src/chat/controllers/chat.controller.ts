import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { ChatService } from '../services/chat.service';
import type { SendMessageRequest } from '../services/chat.service';

@Controller('chat')
export class ChatController {
    constructor(private readonly chatService: ChatService) {}

    /**
     * 내 채팅방 목록 조회
     * GET /api/chat/conversations/:userId
     */
    @Get('conversations/:userId')
    async getMyConversations(@Param('userId') userId: number) {
        if (!userId || userId <= 0) {
            throw new HttpException('유효하지 않은 사용자 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        return await this.chatService.getMyConversations(userId);
    }

    /**
     * 특정 채팅방의 메시지 조회
     * GET /api/chat/messages/:conversationId
     */
    @Get('messages/:conversationId')
    async getMessages(
        @Param('conversationId') conversationId: number,
        @Query('limit') limit?: number,
        @Query('offset') offset?: number,
    ) {
        if (!conversationId || conversationId <= 0) {
            throw new HttpException('유효하지 않은 채팅방 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        const limitNum = limit ? parseInt(limit.toString()) : 50;
        const offsetNum = offset ? parseInt(offset.toString()) : 0;

        if (limitNum < 1 || limitNum > 100) {
            throw new HttpException(
                'limit은 1-100 사이의 값이어야 합니다.',
                HttpStatus.BAD_REQUEST,
            );
        }

        if (offsetNum < 0) {
            throw new HttpException('offset은 0 이상이어야 합니다.', HttpStatus.BAD_REQUEST);
        }

        return await this.chatService.getMessages(conversationId, limitNum, offsetNum);
    }

    /**
     * 메시지 전송
     * POST /api/chat/messages
     */
    @Post('messages')
    async sendMessage(@Body() request: SendMessageRequest) {
        if (!request.sender_id || request.sender_id <= 0) {
            throw new HttpException('유효하지 않은 발신자 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        if (!request.receiver_id || request.receiver_id <= 0) {
            throw new HttpException('유효하지 않은 수신자 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        if (!request.content || request.content.trim().length === 0) {
            throw new HttpException('메시지 내용을 입력해주세요.', HttpStatus.BAD_REQUEST);
        }

        if (request.content.length > 1000) {
            throw new HttpException('메시지는 1000자 이하로 입력해주세요.', HttpStatus.BAD_REQUEST);
        }

        if (request.sender_id === request.receiver_id) {
            throw new HttpException('자신에게 메시지를 보낼 수 없습니다.', HttpStatus.BAD_REQUEST);
        }

        return await this.chatService.sendMessage(request);
    }

    /**
     * 메시지 읽음 처리
     * POST /api/chat/messages/:conversationId/read
     */
    @Post('messages/:conversationId/read')
    async markAsRead(
        @Param('conversationId') conversationId: number,
        @Body() body: { user_id: number; last_message_id: number },
    ) {
        if (!conversationId || conversationId <= 0) {
            throw new HttpException('유효하지 않은 채팅방 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        if (!body.user_id || body.user_id <= 0) {
            throw new HttpException('유효하지 않은 사용자 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        if (!body.last_message_id || body.last_message_id <= 0) {
            throw new HttpException('유효하지 않은 메시지 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        return await this.chatService.markAsRead(
            conversationId,
            body.user_id,
            body.last_message_id,
        );
    }

    /**
     * 사용자 검색
     * GET /api/chat/search/users
     */
    @Get('search/users')
    async searchUsers(
        @Query('q') searchTerm: string,
        @Query('user_id') currentUserId: number,
        @Query('limit') limit?: number,
    ) {
        if (!searchTerm || searchTerm.trim().length < 1) {
            throw new HttpException('검색어를 입력해주세요.', HttpStatus.BAD_REQUEST);
        }

        if (!currentUserId || currentUserId <= 0) {
            throw new HttpException('유효하지 않은 사용자 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        const limitNum = limit ? parseInt(limit.toString()) : 20;

        if (limitNum < 1 || limitNum > 50) {
            throw new HttpException('limit은 1-50 사이의 값이어야 합니다.', HttpStatus.BAD_REQUEST);
        }

        return await this.chatService.searchUsers(searchTerm, currentUserId, limitNum);
    }

    /**
     * 읽지 않은 메시지가 있는 채팅방 목록 조회
     * GET /api/chat/unread/:userId
     */
    @Get('unread/:userId')
    async getUnreadConversations(@Param('userId') userId: number) {
        if (!userId || userId <= 0) {
            throw new HttpException('유효하지 않은 사용자 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        return await this.chatService.getUnreadConversations(userId);
    }

    /**
     * 채팅 통계 조회
     * GET /api/chat/stats/:userId
     */
    @Get('stats/:userId')
    async getChatStats(@Param('userId') userId: number) {
        if (!userId || userId <= 0) {
            throw new HttpException('유효하지 않은 사용자 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        return await this.chatService.getChatStats(userId);
    }

    /**
     * 채팅방 삭제
     * DELETE /api/chat/conversations
     */
    @Post('conversations/delete')
    async deleteConversation(@Body() body: { user1_id: number; user2_id: number }) {
        if (!body.user1_id || body.user1_id <= 0) {
            throw new HttpException('유효하지 않은 사용자 1 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        if (!body.user2_id || body.user2_id <= 0) {
            throw new HttpException('유효하지 않은 사용자 2 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        if (body.user1_id === body.user2_id) {
            throw new HttpException(
                '같은 사용자 간의 채팅방은 삭제할 수 없습니다.',
                HttpStatus.BAD_REQUEST,
            );
        }

        return await this.chatService.deleteConversation(body.user1_id, body.user2_id);
    }

    /**
     * 두 사용자 간의 채팅방 ID 조회
     * GET /api/chat/conversation-id/:user1Id/:user2Id
     */
    @Get('conversation-id/:user1Id/:user2Id')
    async getConversationId(@Param('user1Id') user1Id: number, @Param('user2Id') user2Id: number) {
        if (!user1Id || user1Id <= 0) {
            throw new HttpException('유효하지 않은 사용자 1 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        if (!user2Id || user2Id <= 0) {
            throw new HttpException('유효하지 않은 사용자 2 ID입니다.', HttpStatus.BAD_REQUEST);
        }

        if (user1Id === user2Id) {
            throw new HttpException(
                '같은 사용자 간의 채팅방은 조회할 수 없습니다.',
                HttpStatus.BAD_REQUEST,
            );
        }

        const conversationId = await this.chatService.getConversationId(user1Id, user2Id);

        return {
            success: true,
            data: {
                conversation_id: conversationId,
            },
            message: conversationId ? '채팅방을 찾았습니다.' : '채팅방이 존재하지 않습니다.',
        };
    }
}
