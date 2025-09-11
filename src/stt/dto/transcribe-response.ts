import { ApiProperty } from '@nestjs/swagger';

export class SpeakerSegmentDto {
    @ApiProperty({ description: '화자 태그' })
    speakerTag: number;

    @ApiProperty({ description: '텍스트 내용' })
    textContent: string;

    @ApiProperty({ description: '시작 시간' })
    startTime: number;

    @ApiProperty({ description: '종료 시간' })
    endTime: number;
}

export class STTResultDto {
    @ApiProperty({ description: '전사된 텍스트' })
    transcript: string;

    @ApiProperty({ description: '신뢰도' })
    confidence: number;

    @ApiProperty({ description: '화자 세그먼트', type: [SpeakerSegmentDto], required: false })
    speakers?: SpeakerSegmentDto[];
}

export class STTResponseDto {
    @ApiProperty({ description: '성공 여부' })
    success: boolean;

    @ApiProperty({ description: '타임스탬프' })
    timestamp: string;

    @ApiProperty({ description: '처리 시간' })
    processingTime: number;

    @ApiProperty({ description: 'STT 결과', type: STTResultDto })
    result: STTResultDto;
}

export class STTWithContextResponseDto {
    @ApiProperty({ description: '성공 여부' })
    success: boolean;

    @ApiProperty({ description: '타임스탬프' })
    timestamp: string;

    @ApiProperty({ description: '처리 시간' })
    processingTime: number;

    @ApiProperty({ description: 'STT 세션 인덱스' })
    sttSessionIdx: number;

    @ApiProperty({ description: '컨텍스트 텍스트' })
    contextText: string;

    @ApiProperty({ description: '오디오 URL' })
    audioUrl: string;

    @ApiProperty({ description: '화자 세그먼트', type: [SpeakerSegmentDto] })
    speakers: SpeakerSegmentDto[];

    @ApiProperty({ description: '세그먼트 인덱스', required: false })
    segmentIndex?: number;
}

export class ChatMessageDto {
    @ApiProperty({ description: '메시지 ID' })
    messageId: number;

    @ApiProperty({ description: '컨텍스트 텍스트' })
    contextText: string;

    @ApiProperty({ description: '오디오 URL' })
    audioUrl: string;

    @ApiProperty({ description: '타임스탬프' })
    timestamp: string;

    @ApiProperty({ description: '멘토 인덱스' })
    mentor_idxx: number;

    @ApiProperty({ description: '멘티 인덱스' })
    mentee_idx: number;

    @ApiProperty({ description: '화자 정보' })
    speakerInfo: {
        mentor: string;
        mentee: string;
    };

    @ApiProperty({ description: '캔버스 ID' })
    canvasId: string;

    @ApiProperty({ description: '세그먼트 인덱스' })
    segmentIndex: number;

    @ApiProperty({ description: '세그먼트 목록', type: [SpeakerSegmentDto], required: false })
    segments?: SpeakerSegmentDto[];
}

export class ChatMessagesResponseDto {
    @ApiProperty({ description: '성공 여부' })
    success: boolean;

    @ApiProperty({ description: '메시지 목록', type: [ChatMessageDto] })
    messages: ChatMessageDto[];

    @ApiProperty({ description: '총 개수' })
    totalCount: number;

    @ApiProperty({ description: '현재 페이지' })
    page: number;

    @ApiProperty({ description: '페이지당 항목 수' })
    limit: number;

    @ApiProperty({ description: '더 많은 데이터 여부' })
    hasMore: boolean;
}

export class SampleResponseDto {
    @ApiProperty({ description: '성공 여부' })
    success: boolean;

    @ApiProperty({ description: '메시지' })
    message: string;

    @ApiProperty({ description: 'STT 결과', type: STTResultDto })
    result: STTResultDto;
}

export class ConnectionTestResponseDto {
    @ApiProperty({ description: '상태' })
    status: 'success' | 'error';

    @ApiProperty({ description: '메시지' })
    message: string;
}

export class SessionUsersResponseDto {
    @ApiProperty({ description: '성공 여부' })
    success: boolean;

    @ApiProperty({ description: '캔버스 ID' })
    canvasId: string;

    @ApiProperty({ description: '멘토 정보' })
    mentor: {
        idx: number;
        name: string;
    };

    @ApiProperty({ description: '멘티 정보' })
    mentee: {
        idx: number;
        name: string;
    };
}

export class MessageDetailResponseDto {
    @ApiProperty({ description: '성공 여부' })
    success: boolean;

    @ApiProperty({ description: '세션 정보' })
    session: any;

    @ApiProperty({ description: '컨텍스트 텍스트' })
    contextText: string;

    @ApiProperty({ description: '세그먼트 목록', type: [SpeakerSegmentDto] })
    segments: SpeakerSegmentDto[];
}

export class ContextResponseDto {
    @ApiProperty({ description: '컨텍스트 텍스트' })
    contextText: string;

    @ApiProperty({ description: '화자 목록', type: [SpeakerSegmentDto] })
    speakers: SpeakerSegmentDto[];
}

export class CleanupResponseDto {
    @ApiProperty({ description: '성공 여부' })
    success: boolean;

    @ApiProperty({ description: '정리된 세션 수' })
    cleanedCount: number;
}
