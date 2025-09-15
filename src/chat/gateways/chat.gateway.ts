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
            'http://172.21.101.139:3000',
        ],
        credentials: true,
    },
    namespace: '/api/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;

    // 사용자 ID와 소켓 매핑을 위한 Map
    private userSocketMap = new Map<number, Socket>();

    constructor(private readonly chatService: ChatService) {}

    handleConnection(client: Socket) {
        console.log('✅ 채팅 클라이언트 연결됨:', client.id);

        // 클라이언트에서 사용자 ID를 전송하도록 기다림 (한 번만 실행)
        client.once('register_user', (userId: number) => {
            if (userId && userId > 0) {
                this.userSocketMap.set(userId, client);
                console.log(`👤 사용자 ${userId}가 채팅에 등록됨`);
            }
        });
    }

    handleDisconnect(client: Socket) {
        console.log('❌ 채팅 클라이언트 연결 해제됨:', client.id);

        // 연결 해제된 소켓을 사용자 매핑에서 제거
        for (const [userId, socket] of this.userSocketMap.entries()) {
            if (socket.id === client.id) {
                this.userSocketMap.delete(userId);
                console.log(`👤 사용자 ${userId}가 채팅에서 제거됨`);
                break;
            }
        }
    }

    /**
     * 메시지 전송
     */
    @SubscribeMessage('send_message')
    handleSendMessage(
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

            // ⚠️ 주의: WebSocket은 실시간 알림용으로만 사용
            // 실제 메시지 저장은 HTTP API (/api/chat/messages)에서만 처리
            console.log('📡 WebSocket 메시지 수신 - 실시간 전달만 처리');

            // 메시지 객체 생성 (DB 저장 없이 실시간 전달용)
            const messageData = {
                sender_id: senderId,
                receiver_id: receiverId,
                content: content.trim(),
                created_at: new Date().toISOString(),
                is_realtime_only: true, // 실시간 전달임을 표시
            };

            // 발신자에게 확인 알림 (DB 저장은 HTTP API에서 처리됨을 알림)
            client.emit('message_sent', {
                success: true,
                message: '실시간 메시지가 전달되었습니다. (저장은 HTTP API에서 처리)',
                messageData,
            });

            // 수신자에게만 실시간 메시지 전송
            const receiverSocket = this.userSocketMap.get(receiverId);
            if (receiverSocket) {
                receiverSocket.emit('receive_message', messageData);
                console.log(`📤 실시간 메시지 전달됨: ${senderId} → ${receiverId}`);
            } else {
                console.log(`⚠️ 수신자 ${receiverId}가 온라인이 아닙니다.`);
            }

            console.log(
                `💬 WebSocket 메시지 처리 완료: ${senderId} → ${receiverId} (${content.length}자)`,
            );
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

    @SubscribeMessage('recordingStatus')
    handleRecordingStatus(
        client: Socket,
        payload: { room: string; isRecording: boolean; userId: number },
    ) {
        const { room, isRecording, userId } = payload;
        console.log(
            `🎤 녹음 상태 변경: User ${userId} - ${isRecording ? '시작' : '중지'} in ${room}`,
        );

        // 같은 방의 다른 사용자들에게 전달
        client.to(room).emit('recordingStatus', { isRecording, userId });
    }
}
