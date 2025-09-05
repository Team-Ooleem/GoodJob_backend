import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class LocationsService {
    constructor(private readonly databaseService: DatabaseService) {}

    // 시도 목록 조회
    async getSidoList() {
        const query = 'SELECT sido_code, sido_name FROM sido ORDER BY sido_code';
        return await this.databaseService.query(query);
    }

    // 특정 시도의 구/군 목록 조회
    async getGuListBySido(sidoCode: string) {
        const query = `
      SELECT gu_code, gu_name 
      FROM gu 
      WHERE sido_code = ? 
      ORDER BY gu_name
    `;
        return await this.databaseService.query(query, [sidoCode]);
    }

    // 모든 지역 정보 조회 (시도별로 그룹화)
    async getAllLocations() {
        const query = `
      SELECT 
        s.sido_code,
        s.sido_name,
        g.gu_code,
        g.gu_name
      FROM sido s
      LEFT JOIN gu g ON s.sido_code = g.sido_code
      ORDER BY s.sido_code, g.gu_name
    `;
        return await this.databaseService.query(query);
    }
}
