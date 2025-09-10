export class AudioProcessorUtil {
    static getAudioConfig(mimeType: string) {
        if (mimeType.includes('mp3')) return { encoding: 'MP3', sampleRate: 16000 }; // 44100 → 16000
        if (mimeType.includes('webm')) return { encoding: 'WEBM_OPUS', sampleRate: 48000 }; // 원본 유지
        if (mimeType.includes('flac')) return { encoding: 'FLAC', sampleRate: 16000 };
        if (mimeType.includes('wav')) return { encoding: 'LINEAR16', sampleRate: 16000 };
        return { encoding: 'LINEAR16', sampleRate: 16000 };
    }

    static preprocessAudio(audioBuffer: Buffer): Buffer {
        // 최소 길이 체크 강화
        const minLength = 2048; // 1024 → 2048 (더 긴 오디오 요구)
        if (audioBuffer.length < minLength) {
            console.warn(`오디오 버퍼가 너무 짧습니다: ${audioBuffer.length} bytes`);
        }

        // 노이즈 제거 및 정규화
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
        // 오디오 볼륨 정규화 로직
        // 실제 구현에서는 Web Audio API나 오디오 처리 라이브러리 사용
        return audioBuffer;
    }

    static compressAudio(audioBuffer: Buffer): Buffer {
        // 실제 압축 로직 구현 필요
        // 현재는 원본 반환
        return audioBuffer;
    }

    static convertToGcsUri(gcsUrl: string): string {
        // GCS URL을 gs:// 형식으로 변환
        if (gcsUrl.startsWith('gs://')) return gcsUrl;
        if (gcsUrl.includes('storage.googleapis.com')) {
            const match = gcsUrl.match(/storage\.googleapis\.com\/([^/]+)\/(.+)/);
            if (match) return `gs://${match[1]}/${match[2]}`;
        }
        return gcsUrl; // fallback
    }
}
