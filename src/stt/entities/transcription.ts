import { SpeakerSegment } from './speaker-segment';

export interface TranscriptionResult {
    transcript: string;
    confidence: number;
    speakers?: SpeakerSegment[];
}

export interface STTResult {
    transcript: string;
    confidence: number;
    speakers?: Array<{
        text_Content: string;
        startTime: number;
        endTime: number;
        speakerTag: number;
    }>;
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
    usePynoteDiarization?: boolean;
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
        text_content: string;
        startTime: number;
        endTime: number;
    }>;
    segmentIndex?: number;
}

export interface SessionUserResponse {
    success: boolean;
    canvasId: string;
    mentor: { idx: number; name: string };
    mentee: { idx: number; name: string };
}

export interface ChatMessage {
    messageIdx: number;
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
    audioDuration: number;
}

export interface ChunkCacheData {
    mentorIdx: number;
    menteeIdx: number;
    chunks: Array<{
        audioUrl: string;
        speakers: Array<{
            text_content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }>;
        duration: number; // 🆕 duration 필드 추가
    }>;
    segmentIndex: number;
    lastActivity: number;
    sessionStartTime: number;
}

export interface RawSessionData {
    stt_session_idx: number;
    audio_url: string;
    created_at: string;
    mentor_idx: number;
    mentee_idx: number;
    mentor_name?: string;
    mentee_name?: string;
    speaker_idx: number;
    text_content: string;
    start_time: number;
    end_time: number;
}

export interface TransformedSession {
    messageId: number;
    audioUrl: string;
    timestamp: string;
    mentor_idx: number;
    mentee_idx: number;
    mentor_name?: string;
    mentee_name?: string;
    segments: Array<{
        speakerTag: number;
        textContent: string;
        startTime: number;
        endTime: number;
    }>;
    audioDuration: number;
}

export interface PynoteDiarizationResult {
    success: boolean;
    speaker_segments?: PynoteSegment[];
}

export interface PynoteSegment {
    start_time: number;
    end_time: number;
    speaker_id: number;
}

export interface PynoteResponse {
    success: boolean;
    speaker_segments?: any[];
}

// 🆕 PyAnote 결과 타입 정의
export interface PyAnoteResult {
    success: boolean;
    speaker_segments: PyAnoteSegment[];
    audioBuffer?: Buffer;
}

export interface PyAnoteSegment {
    start_time: number;
    end_time: number;
    speaker_tag: string;
    text_content: string;
}

export interface PyAnoteSTTResult {
    speakers: SpeakerSegment[];
    totalDuration: number;
}

// 🆕 매핑된 스피커 세그먼트 타입
export interface MappedSpeakerSegment {
    userId: number;
    text_Content: string;
    startTime: number;
    endTime: number;
}

// 🆕 데이터베이스 쿼리 결과 타입
export interface DatabaseQueryResult {
    insertId?: number;
    affectedRows?: number;
    changedRows?: number;
}

// 🆕 임시 세션 데이터 타입
export interface TempSessionData {
    stt_session_idx: number;
}

// 🆕 세그먼트 데이터 타입
export interface SegmentQueryResult {
    speaker_idx: number;
    text_content: string;
    start_time: number;
    end_time: number;
}

// 🆕 컨텍스트 스피커 데이터 타입
export interface ContextSpeakerData {
    speakerTag: number;
    text_content: string;
    startTime: number;
    endTime: number;
}
