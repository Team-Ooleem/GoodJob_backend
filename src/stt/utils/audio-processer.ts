export class AudioProcessorUtil {
    static getAudioConfig(mimeType: string) {
        if (mimeType.includes('mp3')) return { encoding: 'MP3', sampleRate: 16000 };
        if (mimeType.includes('mp4')) return { encoding: 'MP3', sampleRate: 16000 };
        if (mimeType.includes('webm')) return { encoding: 'WEBM_OPUS', sampleRate: 48000 };
        if (mimeType.includes('flac')) return { encoding: 'FLAC', sampleRate: 16000 };
        if (mimeType.includes('wav')) return { encoding: 'LINEAR16', sampleRate: 16000 };
        return { encoding: 'LINEAR16', sampleRate: 16000 };
    }

    /* mp4 오디오 전처리 */
    static getMP4Duration(audioBuffer: Buffer): Promise<number> {
        try {
            // Node.js 환경에서는 브라우저 API를 사용할 수 없으므로 추정 방식 사용
            return Promise.resolve(this.estimateDurationByFormat(audioBuffer, 'audio/mp4'));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`MP4 duration 계산 실패: ${errorMessage}`);
        }
    }

    static async getMP4DurationWithValidation(audioBuffer: Buffer): Promise<number> {
        try {
            const standardDuration = await this.getMP4Duration(audioBuffer);

            const estimatedDuration = this.estimateDurationByFormat(audioBuffer, 'audio/mp4');

            const difference = Math.abs(standardDuration - estimatedDuration);
            const tolerance = 0.1;

            if (difference > tolerance) {
                console.warn(`MP4 duration 계산 실패: ${difference}초`);
            }

            if (difference > 3.0) {
                console.warn(`큰 차이로 인해 추정값 사용 : ${estimatedDuration.toFixed(2)}초`);
                return estimatedDuration;
            }

            return standardDuration; // 🆕 Add this return statement
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`MP4 duration 계산 실패: ${errorMessage}`);
            const estimatedDuration = this.estimateDurationByFormat(audioBuffer, 'audio/mp4');
            return estimatedDuration; // 🆕 Add this return statement
        }
    }

    // 🆕 포맷별 duration 추정
    static estimateDurationByFormat(audioBuffer: Buffer, mimeType: string): number {
        if (mimeType.includes('mp4')) {
            // MP3: 일반적으로 128 kbps
            const bitrate = 128 * 1000;
            return (audioBuffer.length * 8) / bitrate;
        } else if (mimeType.includes('wav')) {
            // WAV: 16-bit, 44.1kHz 기준
            const sampleRate = 44100;
            const channels = 2;
            const bitsPerSample = 16;
            const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8;
            return audioBuffer.length / bytesPerSecond;
        } else if (mimeType.includes('flac')) {
            // FLAC: 일반적으로 1000 kbps
            const bitrate = 1000 * 1000;
            return (audioBuffer.length * 8) / bitrate;
        } else {
            // 기본값: 16kHz 기준
            return audioBuffer.length / 16000;
        }
    }

    // �� Duration 품질 검증
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

    static preprocessAudio(audioBuffer: Buffer): Buffer {
        const minLength = 2048;
        if (audioBuffer.length < minLength) {
            console.warn(`오디오 버퍼가 너무 짧습니다: ${audioBuffer.length} bytes`);
        }

        const processedBuffer = this.normalizeAudio(audioBuffer);

        const maxSize = 10 * 1024 * 1024; // 10MB
        if (processedBuffer.length > maxSize) {
            console.warn(
                `오디오 크기가 제한을 초과하여 압축합니다: ${processedBuffer.length} bytes`,
            );
            return this.compressAudio(processedBuffer);
        }

        console.log(`오디오 전처리 완료: ${processedBuffer.length} bytes`);
        return processedBuffer;
    }

    static normalizeAudio(audioBuffer: Buffer): Buffer {
        return audioBuffer;
    }

    static compressAudio(audioBuffer: Buffer): Buffer {
        return audioBuffer;
    }

    static convertToGcsUri(gcsUrl: string): string {
        if (gcsUrl.startsWith('gs://')) return gcsUrl;
        if (gcsUrl.includes('storage.googleapis.com')) {
            const match = gcsUrl.match(/storage\.googleapis\.com\/([^/]+)\/(.+)/);
            if (match) return `gs://${match[1]}/${match[2]}`;
        }
        return gcsUrl;
    }

    // 🆕 통합 오디오 duration 계산 메서드 (MP4 우선)
    static async getAudioDuration(audioBuffer: Buffer, mimeType: string): Promise<number> {
        try {
            if (mimeType.includes('mp4')) {
                // MP4의 경우 검증된 duration 계산 사용
                return await this.getMP4DurationWithValidation(audioBuffer);
            } else {
                // 다른 포맷의 경우 추정 방식 사용
                return this.estimateDurationByFormat(audioBuffer, mimeType);
            }
        } catch (error) {
            // 에러 발생 시 추정값 사용
            const estimatedDuration = this.estimateDurationByFormat(audioBuffer, mimeType);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(
                `Duration 계산 실패, 추정값 사용: ${estimatedDuration.toFixed(2)}초 - ${errorMessage}`,
            );
            return estimatedDuration;
        }
    }
}
