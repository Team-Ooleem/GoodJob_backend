import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from '../services/chat.service';

@WebSocketGateway({
    cors: {
        origin: [
            'http://localhost:3001',
            'http://localhost:3000',
            'http://localhost:4000',
            'https://localhost:3443',
        ],
        credentials: true,
    },
    namespace: '/api/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;

    constructor(private readonly chatService: ChatService) {}

    handleConnection(client: Socket) {
        console.log('✅ 채팅 클라이언트 연결됨:', client.id);
    }

    handleDisconnect(client: Socket) {
        console.log('❌ 채팅 클라이언트 연결 해제됨:', client.id);
    }

    /**
     * 메시지 전송
     */
    @SubscribeMessage('send_message')
    async handleSendMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { senderId: number; receiverId: number; content: string },
    ) {
        try {
            const { senderId, receiverId, content } = data;

            if (!senderId || senderId <= 0) {
                client.emit('error', { message: '유효하지 않은 발신자 ID입니다.' });
                return;
            }

            if (!receiverId || receiverId <= 0) {
                client.emit('error', { message: '유효하지 않은 수신자 ID입니다.' });
                return;
            }

            if (!content || content.trim().length === 0) {
                client.emit('error', { message: '메시지 내용을 입력해주세요.' });
                return;
            }

            if (content.length > 1000) {
                client.emit('error', { message: '메시지는 1000자 이하로 입력해주세요.' });
                return;
            }

            if (senderId === receiverId) {
                client.emit('error', { message: '자신에게 메시지를 보낼 수 없습니다.' });
                return;
            }

            // 메시지 저장
            const result = await this.chatService.sendMessage({
                sender_id: senderId,
                receiver_id: receiverId,
                content: content.trim(),
            });

            if (!result.success) {
                client.emit('error', { message: result.message });
                return;
            }

            // 메시지 객체 생성
            const messageData = {
                message_id: result.message_id,
                sender_id: senderId,
                receiver_id: receiverId,
                content: content.trim(),
                created_at: new Date().toISOString(),
            };

            // 발신자에게 전송 성공 알림
            client.emit('message_sent', {
                success: true,
                message: result.message,
                messageData,
            });

            // 모든 연결된 클라이언트에게 메시지 브로드캐스트
            this.server.emit('receive_message', messageData);

            console.log(`💬 메시지 저장됨: ${senderId} → ${receiverId} (${content.length}자)`);
        } catch (error) {
            console.error('메시지 전송 에러:', error);
            client.emit('error', { message: '메시지 전송에 실패했습니다.' });
        }
    }

    /**
     * 채팅방 읽음 처리
     */
    @SubscribeMessage('mark_conversation_read')
    async handleMarkConversationRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: number; userId: number; lastMessageId: number },
    ) {
        try {
            const { conversationId, userId, lastMessageId } = data;

            if (!conversationId || conversationId <= 0) {
                client.emit('error', { message: '유효하지 않은 채팅방 ID입니다.' });
                return;
            }

            if (!userId || userId <= 0) {
                client.emit('error', { message: '유효하지 않은 사용자 ID입니다.' });
                return;
            }

            if (!lastMessageId || lastMessageId <= 0) {
                client.emit('error', { message: '유효하지 않은 메시지 ID입니다.' });
                return;
            }

            const result = await this.chatService.markAsRead(conversationId, userId, lastMessageId);
            client.emit('conversation_read_result', {
                success: result.success,
                conversationId,
                message: result.message,
            });

            if (result.success) {
                console.log(`📖 채팅방 읽음 처리: 사용자 ${userId}, 채팅방 ${conversationId}`);
            }
        } catch (error) {
            console.error('채팅방 읽음 처리 에러:', error);
            client.emit('error', { message: '채팅방 읽음 처리에 실패했습니다.' });
        }
    }

    /**
     * 모든 연결된 사용자에게 브로드캐스트
     */
    broadcastToAll(event: string, data: any) {
        this.server.emit(event, data);
    }
}
