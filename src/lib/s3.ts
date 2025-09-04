import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const s3 = new S3Client({
    region: 'ap-northeast-2',
    // AWS SDK v3는 환경 변수를 자동으로 읽어옵니다
    // AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY 환경 변수가 설정되어 있으면 자동으로 사용됩니다
});

/**
 * S3에 파일을 업로드하는 함수 (FormData로 받은 파일용)
 * @param buffer 파일 버퍼 데이터
 * @param s3Key S3에 저장될 키 (파일명)
 * @param contentType 파일의 MIME 타입
 * @returns 업로드 결과
 */
export async function uploadFileToS3(buffer: Buffer, s3Key: string, contentType: string) {
    try {
        console.log('🔍 AWS 환경 변수 확인:');
        console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID);
        console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY);
        console.log('AWS_BUCKET_NAME:', process.env.AWS_BUCKET_NAME);
        console.log('S3 리전:', 'ap-northeast-2');
        console.log('📦 버퍼 크기:', buffer.length);
        console.log('🔑 S3 키:', s3Key);
        console.log('📄 Content-Type:', contentType);

        // S3 업로드 명령 생성
        const command = new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME!,
            Key: s3Key,
            Body: buffer,
            ContentType: contentType,
            // ACL 제거 - 버킷 정책에서 public-read 설정
        });
        console.log('📤 S3 업로드 명령 생성 완료:', {
            bucket: process.env.AWS_BUCKET_NAME,
            key: s3Key,
        });

        // S3에 업로드 실행
        console.log('🚀 S3 업로드 시작...');
        const result = await s3.send(command);

        // S3 URL 생성
        const s3Url = `https://${process.env.AWS_BUCKET_NAME}.s3.ap-northeast-2.amazonaws.com/${s3Key}`;

        return {
            success: true,
            etag: result.ETag,
            key: s3Key,
            url: s3Url,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * 이미지 파일 유효성 검증
 * @param file Express.Multer.File 객체
 * @returns 유효성 검증 결과
 */
export function validateImageFile(file: any): { isValid: boolean; error?: string } {
    // 파일 객체 유효성 검증
    if (!file || typeof file !== 'object') {
        return { isValid: false, error: '유효하지 않은 파일입니다.' };
    }

    // 파일 크기 제한 (20MB)
    const maxSize = 20 * 1024 * 1024; // 20MB
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (file.size && file.size > maxSize) {
        return { isValid: false, error: '파일 크기는 20MB를 초과할 수 없습니다.' };
    }

    // 허용된 이미지 타입
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
    if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
        return {
            isValid: false,
            error: '지원되지 않는 파일 형식입니다. (JPEG, PNG, GIF, WebP만 허용)',
        };
    }

    return { isValid: true };
}

/**
 * 고유한 S3 키 생성
 * @param originalName 원본 파일명
 * @param userId 사용자 ID
 * @returns 고유한 S3 키
 */
export function generateS3Key(originalName: string, folder: string): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const extension = originalName.split('.').pop()?.toLowerCase() || 'jpg';
    return `${folder}/${timestamp}_${randomString}.${extension}`;
}
