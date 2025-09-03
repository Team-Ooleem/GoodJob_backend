import { Injectable } from '@nestjs/common';

@Injectable()
export class CollabService {
    // 추후 문서 저장, 히스토리 관리 등 비즈니스 로직 추가 가능
    saveDocumentState(docId: string, state: any) {
        console.log(`Saving doc ${docId}`, state);
    }
}
