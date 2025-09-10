import { SpeakerSegment } from './speaker-segment';

export interface TranscriptionResult {
    transcript: string;
    confidence: number;
    speakers?: SpeakerSegment[];
}

export interface ConnectionTestResult {
    status: 'success' | 'error';
    message: string;
}

export interface TranscribeChunkRequest {
    audioData: string;
    mimeType?: string;
    canvasId: string;
    mentorIdx: number;
    menteeIdx: number;
    duration?: number;
    chunkIndex: number;
    totalChunks: number;
    isFinalChunk?: boolean;
    isNewRecordingSession?: boolean; // 새 녹화 세션 여부
    url?: string;
}

export interface STTWithContextResponse {
    success: boolean;
    timestamp: string;
    processingTime: number;
    sttSessionIdx: number;
    contextText: string;
    audioUrl: string;
    speakers: Array<{
        speakerTag: number;
        textContent: string;
        startTime: number;
        endTime: number;
    }>;
    segmentIndex?: number; // 현재 세그먼트 인덱스
}

export interface SessionUserResponse {
    success: boolean;
    canvasId: string;
    mentor: { idx: number; name: string };
    mentee: { idx: number; name: string };
}

export interface ChatMessage {
    messageId: number;
    contextText: string;
    audioUrl: string;
    timestamp: string;
    mentor_idx: number;
    mentee_idx: number;
    speakerInfo: { mentor: string; mentee: string };
    canvasId: string;
    segmentIndex: number; // 세그먼트 인덱스 추가
    segments?: Array<{
        speakerTag: number;
        textContent: string;
        startTime: number;
        endTime: number;
    }>;
}

export interface ChunkCacheData {
    mentorIdx: number;
    menteeIdx: number;
    chunks: Array<{ audioUrl: string; speakers: SpeakerSegment[] }>;
    segmentIndex: number; // 현재 세그먼트 인덱스
    lastActivity: number; // 마지막 활동 시간
    sessionStartTime: number; // 세션 시작 시간
}
