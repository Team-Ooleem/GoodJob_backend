import { parseBuffer } from 'music-metadata';

export class AudioProcessorUtil {
    static async getAudioDuration(audioBuffer: Buffer, mimeType: string): Promise<number> {
        try {
            // 1️⃣ music-metadata로 정확한 duration 추출
            const metadata = await parseBuffer(audioBuffer, mimeType);
            if (metadata.format.duration && metadata.format.duration > 0) {
                console.log(`정확한 duration: ${metadata.format.duration.toFixed(2)}초`);
                return metadata.format.duration;
            }

            // 2️⃣ duration이 없는 경우 fallback
            console.warn(`metadata에서 duration을 찾을 수 없음 → 추정값 사용`);
            const estimatedDuration = this.estimateDurationByFormat(audioBuffer, mimeType);
            return estimatedDuration || 0; // undefined인 경우 0 반환
        } catch (error) {
            // 3️⃣ 파싱 실패 시 fallback
            const estimatedDuration = this.estimateDurationByFormat(audioBuffer, mimeType);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(
                `Duration 계산 실패, 추정값 사용: ${estimatedDuration.toFixed(2)}초 - ${errorMessage}`,
            );
            return estimatedDuration || 0; // undefined인 경우 0 반환
        }
    }

    // 🆕 오디오 전처리
    static preprocessAudio(audioBuffer: Buffer, mimeType: string = 'audio/mp4'): Buffer {
        console.log(`${mimeType} 오디오 처리: ${audioBuffer.length} bytes`);

        // 모든 형식은 원본 그대로 반환 (전처리 하지 않음)
        return audioBuffer;
    }

    // 🆕 포맷별 duration 추정
    static estimateDurationByFormat(audioBuffer: Buffer, mimeType: string): number {
        if (mimeType.includes('wav')) {
            // WAV: 16-bit, 44.1kHz 기준
            const sampleRate = 44100;
            const channels = 2;
            const bitsPerSample = 16;
            const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8;
            return audioBuffer.length / bytesPerSecond;
        } else if (mimeType.includes('webm')) {
            // WebM: 일반적으로 128 kbps
            const bitrate = 128 * 1000;
            return (audioBuffer.length * 8) / bitrate;
        } else if (mimeType.includes('mp4')) {
            // MP4/AAC: 더 높은 비트레이트 사용
            const bitrate = 256 * 1000; // 256 kbps로 증가
            return (audioBuffer.length * 8) / bitrate;
        } else {
            // 기본값: 더 높은 비트레이트
            const bitrate = 256 * 1000;
            return (audioBuffer.length * 8) / bitrate;
        }
    }

    // 🆕 Duration 품질 검증
    static validateDurationQuality(
        calculatedDuration: number,
        audioBuffer: Buffer,
        mimeType: string,
    ): {
        isValid: boolean;
        confidence: number;
        message: string;
    } {
        const estimatedDuration = this.estimateDurationByFormat(audioBuffer, mimeType);
        const difference = Math.abs(calculatedDuration - estimatedDuration);
        const ratio = difference / Math.max(calculatedDuration, estimatedDuration);

        let confidence = 1.0;
        let message = 'Duration 계산이 정확합니다.';

        if (ratio > 0.5) {
            confidence = 0.3;
            message = 'Duration 계산에 큰 불일치가 있습니다.';
        } else if (ratio > 0.2) {
            confidence = 0.6;
            message = 'Duration 계산에 중간 정도의 불일치가 있습니다.';
        } else if (ratio > 0.1) {
            confidence = 0.8;
            message = 'Duration 계산에 작은 불일치가 있습니다.';
        }

        return {
            isValid: confidence > 0.5,
            confidence,
            message,
        };
    }

    static convertToGcsUri(gcsUrl: string): string {
        if (gcsUrl.startsWith('gs://')) return gcsUrl;
        if (gcsUrl.includes('storage.googleapis.com')) {
            const match = gcsUrl.match(/storage\.googleapis\.com\/([^/]+)\/(.+)/);
            if (match) return `gs://${match[1]}/${match[2]}`;
        }
        return gcsUrl;
    }
}
