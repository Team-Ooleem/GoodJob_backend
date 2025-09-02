import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

export const s3 = new S3Client({
    region: 'ap-northeast-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

/**
 * S3에 파일을 업로드하는 함수
 * @param filePath 로컬 파일 경로
 * @param s3Key S3에 저장될 키 (파일명)
 * @param contentType 파일의 MIME 타입 (선택사항)
 * @returns 업로드 결과
 */
export async function uploadFileToS3(filePath: string, s3Key: string, contentType?: string) {
    try {
        // 파일 읽기
        const fileContent = readFileSync(filePath);

        // S3 업로드 명령 생성
        const command = new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME!,
            Key: s3Key,
            Body: fileContent,
            ContentType: contentType,
        });

        // S3에 업로드 실행
        const result = await s3.send(command);

        return {
            success: true,
            etag: result.ETag,
            key: s3Key,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
