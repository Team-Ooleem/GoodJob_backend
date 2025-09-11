export interface SpeakerSegment {
    text_Content: string;
    startTime: number;
    endTime: number;
    speakerTag: number;
}

export interface MappedSpeakerSegment {
    userId: number;
    text_Content: string;
    startTime: number;
    endTime: number;
}

export interface SessionUserData {
    mentor_idx: number;
    mentor_name: string;
    mentee_idx: number;
    mentee_name: string;
}

export interface SessionMessageData {
    stt_session_idx: number;
    mentor_idx: number;
    mentee_idx: number;
    audio_url: string;
    created_at: string;
    mentor_name: string;
    mentee_name: string;
}

export interface SessionDetailData {
    stt_session_idx: number;
    canvas_id: string;
    mentor_idx: number;
    mentee_idx: number;
    audio_url: string;
    created_at: string;
    mentor_name: string;
    mentee_name: string;
}

export interface SegmentData {
    speaker_idx: number;
    text_content: string;
    start_time: number;
    end_time: number;
}

export interface SessionIndexData {
    stt_session_idx: number;
}

export interface ContextSpeakerData {
    speakerTag: number;
    text: string;
    startTime: number;
    endTime: number;
}
