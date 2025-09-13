import { TranscriptionResult, ConnectionTestResult } from '../entities/transcription';

export interface SpeechProvider {
    transcribe(
        audioData: string,
        config: AudioConfig,
        gcsUrl?: string,
    ): Promise<TranscriptionResult>;
    testConnection(): Promise<ConnectionTestResult>;
    createSampleResult(): TranscriptionResult;
}

export interface AudioConfig {
    encoding: string;
    sampleRate: number;
    languageCode: string;
    enableAutomaticPunctuation: boolean;
    maxAlternatives: number;
    speechContexts: SpeechContext[];
    enableSpeakerDiarization?: boolean;
    diarizationSpeakerCount?: number; // Add this line
}

export interface SpeechContext {
    phrases: string[];
    boost: number;
}

// Google Speech API 응답 타입 추가
export interface GoogleSpeechResponse {
    results?: Array<{
        alternatives?: Array<{
            transcript?: string;
            confidence?: number;
            words?: GoogleSpeechWord[];
        }>;
    }>;
}

export interface GoogleSpeechWord {
    word: string | null | undefined; // string에서 변경
    startTime?: { seconds?: string | number; nanos?: string | number };
    endTime?: { seconds?: string | number; nanos?: string | number };
    speakerTag?: number;
    confidence?: number;
}

export interface Duration {
    seconds?: string | number;
    nanos?: string | number;
}
