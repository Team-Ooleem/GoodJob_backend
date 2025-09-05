export const ChatQueries = {
    /**
     * 내가 참여한 1:1 채팅방 목록 조회 (최근 메시지 순)
     *
     * 파라미터 순서:
     * 1. userId (number) - 현재 사용자 ID
     */
    getMyConversations: `
        SELECT 
            c.conversation_id,
            CASE 
                WHEN c.user1_id = ? THEN c.user2_id 
                ELSE c.user1_id 
            END as other_user_id,
            u.name as other_user_name,
            u.profile_img as other_user_profile_img,
            u.short_bio as other_user_short_bio,
            m.content as last_message,
            m.created_at as last_message_time,
            crs.unread_count,
            crs.last_read_time
        FROM conversations c
        JOIN users u ON u.idx = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
        LEFT JOIN messages m ON m.message_id = c.last_message_id
        LEFT JOIN conversation_read_status crs ON crs.conversation_id = c.conversation_id AND crs.user_id = ?
        WHERE c.user1_id = ? OR c.user2_id = ?
        ORDER BY c.last_message_time DESC
    `,

    /**
     * 특정 채팅방의 메시지 조회 (페이지네이션 지원)
     *
     * 파라미터 순서:
     * 1. conversationId (number) - 채팅방 ID
     * 2. limit (number) - 가져올 메시지 수
     * 3. offset (number) - 오프셋
     */
    getMessagesByConversation: `
        SELECT 
            m.message_id,
            m.sender_id,
            m.receiver_id,
            m.content,
            m.created_at,
            m.is_read,
            m.read_at,
            u.name as sender_name,
            u.profile_img as sender_profile_img
        FROM messages m
        JOIN users u ON u.idx = m.sender_id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
        LIMIT ? OFFSET ?
    `,

    /**
     * 두 사용자 간의 채팅방 ID 조회
     *
     * 파라미터 순서:
     * 1. user1Id (number) - 첫 번째 사용자 ID
     * 2. user2Id (number) - 두 번째 사용자 ID
     */
    getConversationId: `
        SELECT conversation_id
        FROM conversations 
        WHERE (user1_id = ? AND user2_id = ?)
           OR (user1_id = ? AND user2_id = ?)
        LIMIT 1
    `,

    /**
     * 1:1 채팅방 생성 (중복 방지)
     *
     * 파라미터 순서:
     * 1. user1Id (number) - 작은 ID
     * 2. user2Id (number) - 큰 ID
     */
    createConversation: `
        INSERT INTO conversations (user1_id, user2_id, created_at)
        VALUES (LEAST(?, ?), GREATEST(?, ?), NOW())
        ON DUPLICATE KEY UPDATE updated_at = NOW()
    `,

    /**
     * 메시지 전송
     *
     * 파라미터 순서:
     * 1. conversationId (number) - 채팅방 ID
     * 2. senderId (number) - 발신자 ID
     * 3. receiverId (number) - 수신자 ID
     * 4. content (string) - 메시지 내용
     */
    sendMessage: `
        INSERT INTO messages (conversation_id, sender_id, receiver_id, content, created_at)
        VALUES (?, ?, ?, ?, NOW())
    `,

    /**
     * 채팅방의 마지막 메시지 정보 업데이트
     *
     * 파라미터 순서:
     * 1. conversationId (number) - 채팅방 ID
     * 2. messageId (number) - 메시지 ID
     * 3. messageTime (datetime) - 메시지 시간
     */
    updateLastMessage: `
        UPDATE conversations 
        SET last_message_id = ?, 
            last_message_time = ?,
            updated_at = NOW()
        WHERE conversation_id = ?
    `,

    /**
     * 읽지 않은 메시지 수 증가
     *
     * 파라미터 순서:
     * 1. conversationId (number) - 채팅방 ID
     * 2. userId (number) - 사용자 ID
     */
    incrementUnreadCount: `
        UPDATE conversation_read_status 
        SET unread_count = unread_count + 1,
            updated_at = NOW()
        WHERE conversation_id = ? AND user_id = ?
    `,

    /**
     * 메시지 읽음 처리 (채팅방 진입 시)
     *
     * 파라미터 순서:
     * 1. conversationId (number) - 채팅방 ID
     * 2. userId (number) - 사용자 ID
     * 3. lastMessageId (number) - 마지막 메시지 ID
     */
    markAsRead: `
        UPDATE conversation_read_status 
        SET last_read_message_id = ?, 
            last_read_time = NOW(),
            unread_count = 0,
            updated_at = NOW()
        WHERE conversation_id = ? AND user_id = ?
    `,

    /**
     * 사용자 검색 (이름으로만 검색)
     *
     * 파라미터 순서:
     * 1. currentUserId (number) - 현재 사용자 ID (자기 자신 제외)
     * 2. searchTerm (string) - 검색어
     * 3. limit (number) - 검색 결과 수 제한
     */
    searchUsers: `
        SELECT 
            u.idx as user_id,
            u.name,
            u.email,
            u.short_bio,
            u.profile_img,
            CASE 
                WHEN ip.desired_job IS NOT NULL THEN jr.name
                WHEN bp.company_name IS NOT NULL THEN bp.company_name
                ELSE NULL
            END as job_info
        FROM users u
        LEFT JOIN individual_profile ip ON ip.user_idx = u.idx
        LEFT JOIN business_profile bp ON bp.user_idx = u.idx
        LEFT JOIN job_role jr ON jr.id = ip.desired_job
        WHERE u.idx != ?
          AND u.name LIKE CONCAT('%', ?, '%')
        ORDER BY 
            CASE WHEN u.name LIKE CONCAT(?, '%') THEN 1 ELSE 2 END,
            u.name
        LIMIT ?
    `,

    /**
     * 읽지 않은 메시지가 있는 채팅방 목록 조회
     *
     * 파라미터 순서:
     * 1. userId (number) - 사용자 ID
     */
    getUnreadConversations: `
        SELECT 
            c.conversation_id,
            CASE 
                WHEN c.user1_id = ? THEN c.user2_id 
                ELSE c.user1_id 
            END as other_user_id,
            u.name as other_user_name,
            u.profile_img as other_user_profile_img,
            crs.unread_count
        FROM conversations c
        JOIN users u ON u.idx = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
        JOIN conversation_read_status crs ON crs.conversation_id = c.conversation_id AND crs.user_id = ?
        WHERE (c.user1_id = ? OR c.user2_id = ?)
          AND crs.unread_count > 0
        ORDER BY c.last_message_time DESC
    `,

    /**
     * 채팅방 통계 조회
     *
     * 파라미터 순서:
     * 1. userId (number) - 사용자 ID
     */
    getChatStats: `
        SELECT 
            COUNT(DISTINCT c.conversation_id) as total_conversations,
            SUM(crs.unread_count) as total_unread_messages,
            COUNT(DISTINCT CASE WHEN c.last_message_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN c.conversation_id END) as active_conversations_24h
        FROM conversations c
        LEFT JOIN conversation_read_status crs ON crs.conversation_id = c.conversation_id AND crs.user_id = ?
        WHERE c.user1_id = ? OR c.user2_id = ?
    `,

    /**
     * 채팅방 삭제
     *
     * 파라미터 순서:
     * 1. user1Id (number) - 첫 번째 사용자 ID
     * 2. user2Id (number) - 두 번째 사용자 ID
     */
    deleteConversation: `
        DELETE FROM conversations 
        WHERE (user1_id = ? AND user2_id = ?)
           OR (user1_id = ? AND user2_id = ?)
    `,

    /**
     * 채팅방 읽음 상태 초기화 (채팅방 생성 시)
     *
     * 파라미터 순서:
     * 1. conversationId (number) - 채팅방 ID
     * 2. user1Id (number) - 사용자 1 ID
     * 3. user2Id (number) - 사용자 2 ID
     */
    initializeReadStatus: `
        INSERT INTO conversation_read_status (conversation_id, user_id, unread_count)
        VALUES (?, ?, 0), (?, ?, 0)
        ON DUPLICATE KEY UPDATE unread_count = 0
    `,

    /**
     * 특정 사용자와의 최근 메시지 조회
     *
     * 파라미터 순서:
     * 1. userId (number) - 현재 사용자 ID
     * 2. otherUserId (number) - 상대방 사용자 ID
     */
    getRecentMessage: `
        SELECT 
            m.content,
            m.created_at,
            m.sender_id
        FROM messages m
        JOIN conversations c ON c.conversation_id = m.conversation_id
        WHERE (c.user1_id = ? AND c.user2_id = ?)
           OR (c.user1_id = ? AND c.user2_id = ?)
        ORDER BY m.created_at DESC
        LIMIT 1
    `,
};
