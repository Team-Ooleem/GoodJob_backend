import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { MentoringProductDto } from './dto/product.dto';
import { MentoringProductSlotsDto } from './dto/product-slots.dto';
import { ProductRegularSlotsResponseDto } from './dto/product-regular-slots.dto';
import { ApplicationResponseDto, CreateApplicationDto } from './dto/application.dto';
import { MentoringProductReviewsDto } from './dto/product-reviews.dto';
import { MentorReviewsResponseDto } from './dto/mentor-reviews.dto';
import { CreateProductReviewDto, ProductReviewResponseDto } from './dto/product-review.dto';
import {
    CreateMentoringProductDto,
    MentoringProductCreatedResponseDto,
} from './dto/product-create.dto';
import { MenteeApplicationsResponseDto } from './dto/mentee-applications.dto';
import { MentoringApplicationsResponseDto } from './dto/mentoring-applications.dto';
import {
    UpdateApplicationStatusDto,
    UpdateApplicationStatusResponseDto,
} from './dto/application-update.dto';
import {
    CreateMentorApplicationDto,
    MentorApplicationCreateResponseDto,
} from './dto/mentor-application.dto';
import { JobCategoryResponseDto } from './dto/job-category.dto';
import {
    MentoringProductListResponseDto,
    MentoringProductListItemDto,
    MentoringProductListQueryDto,
} from './dto/product-list.dto';
import { MentorProductsResponseDto } from './dto/mentor-products.dto';
import { MentorScopedProductResponseDto } from './dto/mentor-product.dto';
import { DatabaseService } from '@/database/database.service';

@Injectable()
export class MentoringService {
    constructor(private readonly databaseService: DatabaseService) {}
    async getMentorProduct(
        mentorIdx: number,
        productIdx: number,
    ): Promise<MentorScopedProductResponseDto> {
        // 멘토 + 상품 단건 조회 (멘토 소유 검증 포함)
        const row = await this.databaseService.queryOne<{
            mentor_idx: number;
            mentor_name: string;
            business_name: string;
            mentor_job_category: string;
            product_idx: number;
            title: string;
            description: string;
            product_job_category: string;
            price: any;
            is_active: number;
            created_at: Date;
            updated_at: Date;
        }>(
            `SELECT 
                 mp.mentor_idx,
                 u.name AS mentor_name,
                 mp.business_name,
                 jc_m.name AS mentor_job_category,
                 p.product_idx,
                 p.title,
                 p.description,
                 jc_p.name AS product_job_category,
                 p.price,
                 p.is_active,
                 p.created_at,
                 p.updated_at
               FROM mentoring_products p
               JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
               JOIN users u ON mp.user_idx = u.idx
               JOIN job_category jc_m ON mp.preferred_field_id = jc_m.id
               JOIN job_category jc_p ON p.job_category_id = jc_p.id
              WHERE p.mentor_idx = ?
                AND p.product_idx = ?
              LIMIT 1`,
            [mentorIdx, productIdx],
        );

        if (!row) {
            throw new NotFoundException('멘토 또는 상품을 찾을 수 없습니다.');
        }

        return {
            mentor: {
                mentor_idx: row.mentor_idx,
                mentor_name: row.mentor_name,
                business_name: row.business_name,
                job_category: row.mentor_job_category,
            },
            product: {
                product_idx: row.product_idx,
                title: row.title,
                description: row.description,
                job_category: row.product_job_category,
                price: Number(row.price),
                is_active: Number(row.is_active) === 1,
                created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
                updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : '',
            },
        };
    }
    async getMentorProducts(mentorIdx: number): Promise<MentorProductsResponseDto> {
        // 1) 멘토 정보 조회
        const mentorRow = await this.databaseService.queryOne<{
            mentor_idx: number;
            mentor_name: string;
        }>(
            `SELECT mp.mentor_idx, u.name AS mentor_name
               FROM mentor_profiles mp
               JOIN users u ON mp.user_idx = u.idx
              WHERE mp.mentor_idx = ?
              LIMIT 1`,
            [mentorIdx],
        );

        if (!mentorRow) {
            throw new NotFoundException('해당 멘토를 찾을 수 없습니다.');
        }

        // 2) 멘토의 멘토링 상품 목록 조회
        const productRows = await this.databaseService.query<{
            product_idx: number;
            title: string;
            job_category: string;
            price: any;
            is_active: number;
            created_at: Date;
        }>(
            `SELECT 
                 p.product_idx,
                 p.title,
                 jc.name AS job_category,
                 p.price,
                 p.is_active,
                 p.created_at
               FROM mentoring_products p
               JOIN job_category jc ON p.job_category_id = jc.id
              WHERE p.mentor_idx = ?
              ORDER BY p.created_at DESC`,
            [mentorIdx],
        );

        return {
            mentor_idx: mentorRow.mentor_idx,
            mentor_name: mentorRow.mentor_name,
            products: productRows.map((r) => ({
                product_idx: r.product_idx,
                title: r.title,
                job_category: r.job_category,
                price: Number(r.price),
                is_active: Number(r.is_active) === 1,
                created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
            })),
        };
    }
    async getProduct(productIdx: number): Promise<MentoringProductDto> {
        /*
        SELECT 
            p.product_idx,
            p.title,
            p.description,
            p.price,
            jc.name AS job_category,
            
            -- 리뷰 개수 & 평균 평점
            COUNT(DISTINCT r.review_idx) AS review_count,
            COALESCE(ROUND(AVG(r.rating), 1), 0) AS average_rating,
            
            -- 멘토 정보
            u.name AS mentor_name,
            jc2.name AS mentor_job_category,
            mp.business_name,
            -- 경력 컬럼은 스키마에 없음, 필요시 mentor_profiles에 career 컬럼 추가
            
            -- 멘티 수
            COUNT(DISTINCT a.mentee_idx) AS mentee_count
            
        FROM mentoring_products p
        JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
        JOIN users u ON mp.user_idx = u.idx
        JOIN job_category jc ON p.job_category_id = jc.id
        JOIN job_category jc2 ON mp.preferred_field_id = jc2.id
        LEFT JOIN mentoring_reviews r ON p.product_idx = r.product_idx
        LEFT JOIN mentoring_applications a 
            ON p.product_idx = a.product_idx 
            AND a.application_status = 'completed'

        WHERE p.product_idx = 1

        GROUP BY 
            p.product_idx, p.title, p.description, p.price, jc.name,
            u.name, jc2.name, mp.business_name;
        */
        const sql = `
            SELECT 
                p.product_idx,
                p.title,
                p.description,
                p.price,
                jc.name AS job_category,
                COUNT(DISTINCT r.review_idx) AS review_count,
                COALESCE(ROUND(AVG(r.rating), 1), 0) AS average_rating,
                u.name AS mentor_name,
                jc2.name AS mentor_job_category,
                mp.business_name,
                COUNT(DISTINCT CASE WHEN a.application_status = 'completed' THEN a.mentee_idx END) AS mentee_count
            FROM mentoring_products p
            JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
            JOIN users u ON mp.user_idx = u.idx
            JOIN job_category jc ON p.job_category_id = jc.id
            JOIN job_category jc2 ON mp.preferred_field_id = jc2.id
            LEFT JOIN mentoring_reviews r ON p.product_idx = r.product_idx
            LEFT JOIN mentoring_applications a ON p.product_idx = a.product_idx
            WHERE p.product_idx = ?
            GROUP BY p.product_idx, p.title, p.description, p.price, jc.name, u.name, jc2.name, mp.business_name
        `;

        const row = await this.databaseService.queryOne<{
            product_idx: number;
            title: string;
            description: string;
            price: number;
            job_category: string;
            review_count: number;
            average_rating: number;
            mentor_name: string;
            mentor_job_category: string;
            business_name: string;
            mentee_count: number;
        }>(sql, [productIdx]);

        if (!row) {
            throw new Error('멘토링 상품을 찾을 수 없습니다.');
        }

        return {
            product_idx: row.product_idx,
            title: row.title,
            description: row.description,
            price: Number(row.price),
            job_category: row.job_category,
            mentee_count: Number(row.mentee_count ?? 0),
            review_count: Number(row.review_count ?? 0),
            average_rating: Number(row.average_rating ?? 0),
            mentor: {
                name: row.mentor_name,
                job_category: row.mentor_job_category,
                career: '',
                business_name: row.business_name,
            },
        };
    }

    async getProductSlots(productIdx: number, date: string): Promise<MentoringProductSlotsDto> {
        // productIdx는 더미 응답에 직접적 영향을 주지 않지만, 시그니처로 포함
        /*
        -- 1. 날짜로 요일 계산 (MySQL: 1=일요일, 2=월요일 ...)
        SET @date := '2025-09-14';
        SET @day_of_week := DAYOFWEEK(@date); -- 예: 1=일요일

        -- 2. 슬롯 + 예약 건수 조회
        SELECT 
            s.regular_slots_idx,
            s.hour_slot,
            CONCAT(LPAD(s.hour_slot,2,'0'), ':00-', LPAD(s.hour_slot+1,2,'0'), ':00') AS time_range,
            COUNT(a.application_id) AS reserved_count,
            1 AS capacity,
            CASE 
                WHEN COUNT(a.application_id) < 1 THEN TRUE 
                ELSE FALSE 
            END AS available
        FROM mentoring_regular_slots s
        LEFT JOIN mentoring_applications a 
            ON s.regular_slots_idx = a.regular_slots_idx
        AND a.booked_date = @date
        AND a.application_status IN ('approved','completed')
        WHERE s.product_idx = 1
        AND s.day_of_week = @day_of_week
        GROUP BY s.regular_slots_idx, s.hour_slot;

        */
        // validate date (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!date || !dateRegex.test(date)) {
            throw new Error('유효한 날짜 형식이 필요합니다. 예: 2025-09-14');
        }
        const d = new Date(date);
        if (isNaN(d.getTime())) {
            throw new Error('유효한 날짜가 아닙니다.');
        }
        const jsDay = d.getDay(); // 0=Sun..6=Sat
        const dayOfWeek = ((jsDay + 6) % 7) + 1; // 1=Mon..7=Sun

        const sql = `
            SELECT 
                s.hour_slot,
                CONCAT(LPAD(s.hour_slot,2,'0'), ':00-', LPAD(s.hour_slot+1,2,'0'), ':00') AS time_range,
                COUNT(a.application_id) AS reserved_count
            FROM mentoring_regular_slots s
            LEFT JOIN mentoring_applications a 
                ON s.regular_slots_idx = a.regular_slots_idx
               AND a.booked_date = ?
               AND a.application_status IN ('approved','completed')
            WHERE s.product_idx = ?
              AND s.day_of_week = ?
            GROUP BY s.hour_slot
            ORDER BY s.hour_slot ASC
        `;

        const rows = await this.databaseService.query<{
            hour_slot: number;
            time_range: string;
            reserved_count: number;
        }>(sql, [date, productIdx, dayOfWeek]);

        const slotsAll = rows.map((r) => ({
            hour_slot: Number(r.hour_slot),
            time_range: r.time_range,
            available: Number(r.reserved_count ?? 0) === 0,
        }));

        // 가능한(예약되지 않은) 정기 슬롯만 반환
        const slots = slotsAll.filter((s) => s.available);

        return {
            date,
            day_of_week: dayOfWeek,
            slots,
        };
    }

    async getProductRegularSlots(productIdx: number): Promise<ProductRegularSlotsResponseDto> {
        const sql = `
            SELECT regular_slots_idx, day_of_week, hour_slot
              FROM mentoring_regular_slots
             WHERE product_idx = ?
             ORDER BY day_of_week, hour_slot
        `;
        const rows = await this.databaseService.query<{
            regular_slots_idx: number;
            day_of_week: number;
            hour_slot: number;
        }>(sql, [productIdx]);

        const slots = rows.map((r) => ({
            regular_slots_idx: Number(r.regular_slots_idx),
            day_of_week: Number(r.day_of_week),
            hour_slot: Number(r.hour_slot),
            time_range: `${String(r.hour_slot).padStart(2, '0')}:00-${String(r.hour_slot + 1).padStart(2, '0')}:00`,
        }));

        return { product_idx: productIdx, slots };
    }

    async createApplication(
        productIdx: number,
        dto: CreateApplicationDto,
        menteeIdx: number,
    ): Promise<ApplicationResponseDto> {
        // Basic validations
        if (!menteeIdx || Number.isNaN(Number(menteeIdx))) {
            throw new BadRequestException('유효한 멘티 ID가 필요합니다.');
        }
        const user = await this.databaseService.queryOne<{ idx: number }>(
            'SELECT idx FROM users WHERE idx = ? LIMIT 1',
            [menteeIdx],
        );
        if (!user) {
            throw new NotFoundException('해당 멘티가 존재하지 않습니다.');
        }

        const product = await this.databaseService.queryOne<{ product_idx: number }>(
            'SELECT product_idx FROM mentoring_products WHERE product_idx = ? AND is_active = 1 LIMIT 1',
            [productIdx],
        );
        if (!product) {
            throw new NotFoundException('활성화된 멘토링 상품을 찾을 수 없습니다.');
        }

        const slot = await this.databaseService.queryOne<{
            regular_slots_idx: number;
            day_of_week: number;
        }>(
            'SELECT regular_slots_idx, day_of_week FROM mentoring_regular_slots WHERE regular_slots_idx = ? AND product_idx = ? LIMIT 1',
            [dto.regular_slots_idx, productIdx],
        );
        if (!slot) {
            throw new BadRequestException('해당 상품에 속하지 않는 예약 슬롯입니다.');
        }

        // Validate date format and weekday match
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dto.booked_date || !dateRegex.test(dto.booked_date)) {
            throw new BadRequestException('예약일자는 YYYY-MM-DD 형식이어야 합니다.');
        }
        const booked = new Date(dto.booked_date);
        if (isNaN(booked.getTime())) {
            throw new BadRequestException('유효한 예약일자가 아닙니다.');
        }
        const jsDay = booked.getDay();
        const dayOfWeek = ((jsDay + 6) % 7) + 1; // 1=Mon..7=Sun
        if (dayOfWeek !== Number(slot.day_of_week)) {
            throw new BadRequestException(
                '선택한 예약일자의 요일과 슬롯 요일이 일치하지 않습니다.',
            );
        }

        // Prevent double booking on approved/completed
        const reserved = await this.databaseService.queryOne<{ cnt: number }>(
            `SELECT COUNT(*) AS cnt
               FROM mentoring_applications
              WHERE regular_slots_idx = ? AND booked_date = ? AND application_status IN ('approved','completed')`,
            [dto.regular_slots_idx, dto.booked_date],
        );
        if (Number(reserved?.cnt ?? 0) > 0) {
            throw new BadRequestException('이미 예약된 시간입니다. 다른 슬롯을 선택해주세요.');
        }

        // 🔥 중복 방지: 같은 transaction_id로 이미 신청이 있는지 확인
        const existingPayment = await this.databaseService.queryOne<{ payment_id: number }>(
            'SELECT payment_id FROM payments WHERE transaction_id = ? LIMIT 1',
            [dto.payment.transaction_id],
        );

        if (existingPayment) {
            throw new BadRequestException(
                '이미 처리된 결제입니다. 같은 transaction_id로 중복 신청할 수 없습니다.',
            );
        }
        /* 결제 정보 저장 */
        /*
        INSERT INTO payments (user_idx, product_idx, amount, payment_status, transaction_id, paid_at)
            VALUES (20, 1, 50000, 'completed', 'PAY-20250911-123456', NOW());
        */

        /* 신청 정보 저장 */
        /*
        INSERT INTO mentoring_applications (
            mentee_idx, product_idx, regular_slots_idx, booked_date,
            payment_id, message_to_mentor, application_status, created_at
        )
        VALUES (
            20, 1, 42, '2025-09-14',
            LAST_INSERT_ID(), '포트폴리오 피드백 위주로 받고 싶습니다.', 'pending', NOW()
        );
        */
        return this.databaseService.transaction(async (conn) => {
            // 0) 멘토 이름 조회 (멘토 프로필 -> 유저 이름)
            const mentorRowSql = `
                SELECT u.name AS mentor_name
                  FROM mentoring_products p
                  JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
                  JOIN users u ON mp.user_idx = u.idx
                 WHERE p.product_idx = ?
                 LIMIT 1
            `;
            const [mentorRow] = await conn.query<any[]>(mentorRowSql, [productIdx]);
            const mentorName: string | undefined = mentorRow?.[0]?.mentor_name;
            const paySql = `
                INSERT INTO payments (user_idx, product_idx, amount, payment_status, transaction_id, paid_at)
                VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'completed' THEN NOW() ELSE NULL END)
            `;
            const [payRes]: any = await conn.execute(paySql, [
                menteeIdx,
                productIdx,
                dto.payment.amount,
                dto.payment.status,
                dto.payment.transaction_id,
                dto.payment.status,
            ]);
            const paymentId = payRes.insertId as number;

            const appSql = `
                INSERT INTO mentoring_applications (
                    mentee_idx, product_idx, regular_slots_idx, booked_date, payment_id, message_to_mentor, application_status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())
            `;
            const [appRes]: any = await conn.execute(appSql, [
                menteeIdx,
                productIdx,
                dto.regular_slots_idx,
                dto.booked_date,
                paymentId,
                dto.message_to_mentor ?? null,
            ]);
            const applicationId = appRes.insertId as number;

            const appRowSql = `
                SELECT application_id, mentee_idx, product_idx, regular_slots_idx, booked_date, application_status, message_to_mentor, created_at
                  FROM mentoring_applications WHERE application_id = ?
            `;
            const [appRow] = await conn.query<any[]>(appRowSql, [applicationId]);
            const created = appRow[0];

            const payRowSql = `
                SELECT payment_id, amount, payment_status AS status, transaction_id, paid_at
                  FROM payments WHERE payment_id = ?
            `;
            const [payRow] = await conn.query<any[]>(payRowSql, [paymentId]);
            const payment = payRow[0];

            // 4) 캔버스 생성 (멘토명 기반 타이틀)
            const canvasId = uuidv4();
            const canvasTitle = mentorName ? `${mentorName}님의 라이브룸` : null;
            await conn.execute(
                `INSERT INTO canvas (id, application_id, name, created_by) VALUES (?, ?, ?, ?)`,
                [canvasId, applicationId, canvasTitle, menteeIdx],
            );

            return {
                application_id: applicationId,
                product_idx: productIdx,
                mentee_idx: menteeIdx,
                regular_slots_idx: dto.regular_slots_idx,
                booked_date: dto.booked_date,
                application_status: created?.application_status ?? 'pending',
                message_to_mentor: dto.message_to_mentor,
                payment: {
                    payment_id: paymentId,
                    amount: Number(payment?.amount ?? dto.payment.amount),
                    status: payment?.status ?? dto.payment.status,
                    transaction_id: payment?.transaction_id ?? dto.payment.transaction_id,
                    paid_at: payment?.paid_at ? new Date(payment.paid_at).toISOString() : '',
                } as any,
                created_at: created?.created_at
                    ? new Date(created.created_at).toISOString()
                    : new Date().toISOString(),
                canvas_id: canvasId,
            };
        });
    }

    async getProductReviews(
        productIdx: number,
        limit = 10,
        cursor?: string,
    ): Promise<MentoringProductReviewsDto> {
        /*
        SELECT 
            r.review_idx,
            r.rating,
            r.review_content,
            r.created_at,
            u.name AS mentee_name,
            u.profile_img
        FROM mentoring_reviews r
        JOIN users u ON r.mentee_idx = u.idx
        WHERE r.product_idx = 1
        AND (r.created_at < '2025-09-10 12:00:00')  -- cursor 조건
        ORDER BY r.created_at DESC
        LIMIT 10;
        */

        const aggSql = `
            SELECT COUNT(*) AS review_count, COALESCE(ROUND(AVG(rating),1),0) AS average_rating
              FROM mentoring_reviews
             WHERE product_idx = ?
        `;
        const agg = await this.databaseService.queryOne<{
            review_count: number;
            average_rating: number;
        }>(aggSql, [productIdx]);

        let listSql = `
            SELECT r.review_idx, r.rating, r.review_content, r.created_at, u.name AS mentee_name
              FROM mentoring_reviews r
              JOIN users u ON r.mentee_idx = u.idx
             WHERE r.product_idx = ?
        `;
        const params: any[] = [productIdx];
        if (cursor) {
            listSql += ' AND r.created_at < ?';
            params.push(new Date(cursor));
        }
        listSql += ' ORDER BY r.created_at DESC LIMIT ?';
        params.push(Number(limit));

        const rows = await this.databaseService.query<{
            review_idx: number;
            rating: number;
            review_content: string;
            created_at: Date;
            mentee_name: string;
        }>(listSql, params);

        const reviews = rows.map((r) => ({
            review_idx: r.review_idx,
            mentee_name: r.mentee_name,
            rating: Number(r.rating),
            review_content: r.review_content,
            created_at: new Date(r.created_at).toISOString(),
        }));

        const nextCursor = reviews.length > 0 ? reviews[reviews.length - 1].created_at : null;

        return {
            product_idx: productIdx,
            average_rating: Number(agg?.average_rating ?? 0),
            review_count: Number(agg?.review_count ?? 0),
            reviews,
            page_info: {
                next_cursor: nextCursor,
                has_more: reviews.length === Number(limit),
            },
        };
    }

    async getMentorReviews(
        mentorIdx: number,
        page = 1,
        limit = 20,
    ): Promise<MentorReviewsResponseDto> {
        /*
          SELECT 
            r.review_idx,
            r.product_idx,
            p.title AS product_title,
            r.rating,
            r.review_content,
            r.created_at,
            u.idx AS mentee_idx,
            u.name AS mentee_name,
            u.profile_img
            FROM mentoring_reviews r
            JOIN mentoring_products p ON r.product_idx = p.product_idx
            JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
            JOIN users u ON r.mentee_idx = u.idx
            WHERE mp.mentor_idx = ?
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?;
        */

        /*
        SELECT 
        COUNT(*) AS review_count,
        ROUND(AVG(r.rating),1) AS average_rating
        FROM mentoring_reviews r
        JOIN mentoring_products p ON r.product_idx = p.product_idx
        WHERE p.mentor_idx = ?;
        */

        const aggSql = `
            SELECT COUNT(*) AS review_count, COALESCE(ROUND(AVG(r.rating),1),0) AS average_rating
              FROM mentoring_reviews r
              JOIN mentoring_products p ON r.product_idx = p.product_idx
             WHERE p.mentor_idx = ?
        `;
        const agg = await this.databaseService.queryOne<{
            review_count: number;
            average_rating: number;
        }>(aggSql, [mentorIdx]);

        const offset = (Number(page) - 1) * Number(limit);
        const listSql = `
            SELECT 
                r.review_idx,
                r.product_idx,
                p.title AS product_title,
                r.rating,
                r.review_content,
                r.created_at,
                u.idx AS mentee_idx,
                u.name AS mentee_name,
                u.profile_img
            FROM mentoring_reviews r
            JOIN mentoring_products p ON r.product_idx = p.product_idx
            JOIN users u ON r.mentee_idx = u.idx
            WHERE p.mentor_idx = ?
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.databaseService.query<any>(listSql, [
            mentorIdx,
            Number(limit),
            offset,
        ]);

        const reviews = rows.map((r: any) => ({
            review_idx: r.review_idx,
            product_idx: r.product_idx,
            product_title: r.product_title,
            mentee: {
                user_idx: r.mentee_idx,
                name: r.mentee_name,
                profile_img: r.profile_img ?? '',
            },
            rating: Number(r.rating),
            review_content: r.review_content,
            created_at: new Date(r.created_at).toISOString(),
        }));

        const totalPages = Math.max(1, Math.ceil(Number(agg?.review_count ?? 0) / Number(limit)));

        return {
            mentor_idx: mentorIdx,
            review_count: Number(agg?.review_count ?? 0),
            average_rating: Number(agg?.average_rating ?? 0),
            page_info: {
                page: Number(page),
                limit: Number(limit),
                total_pages: totalPages,
                has_next: Number(page) < totalPages,
            },
            reviews,
        };
    }

    async createProductReview(
        productIdx: number,
        body: CreateProductReviewDto,
        menteeIdx = 20,
    ): Promise<ProductReviewResponseDto> {
        /*
        INSERT INTO mentoring_reviews (
        application_id,
        product_idx,
        mentee_idx,
        rating,
        review_content,
        created_at
        )
        SELECT
        a.application_id,
        a.product_idx,
        a.mentee_idx,
        5, -- rating
        '멘토님이 실제 면접에서 유용한 팁을 많이 알려주셨어요!',
        NOW()
        FROM mentoring_applications a
        WHERE a.application_id = 101
        AND a.application_status = 'completed';
        */
        const appSql = `
            SELECT application_id, product_idx, mentee_idx
              FROM mentoring_applications
             WHERE application_id = ?
               AND product_idx = ?
               AND application_status = 'completed'
        `;
        const app = await this.databaseService.queryOne<{
            application_id: number;
            product_idx: number;
            mentee_idx: number;
        }>(appSql, [body.application_id, productIdx]);

        if (!app) {
            throw new Error('리뷰를 작성할 수 있는 완료된 신청이 없습니다.');
        }

        const insertSql = `
            INSERT INTO mentoring_reviews (
                application_id, product_idx, mentee_idx, rating, review_content, created_at
            ) VALUES (?, ?, ?, ?, ?, NOW())
        `;
        const res = await this.databaseService.execute(insertSql, [
            app.application_id,
            app.product_idx,
            app.mentee_idx,
            body.rating,
            body.review_content,
        ]);
        const reviewIdx = (res as any).insertId as number;

        return {
            review_idx: reviewIdx,
            product_idx: productIdx,
            application_id: app.application_id,
            mentee_idx: app.mentee_idx,
            rating: body.rating,
            review_content: body.review_content,
            created_at: new Date().toISOString(),
        };
    }

    async createProduct(
        body: CreateMentoringProductDto,
    ): Promise<MentoringProductCreatedResponseDto> {
        // mentor 존재 및 승인 상태 확인
        const mentor = await this.databaseService.queryOne<{
            mentor_idx: number;
            is_approved: number;
        }>('SELECT mentor_idx, is_approved FROM mentor_profiles WHERE mentor_idx = ? LIMIT 1', [
            body.mentor_idx,
        ]);
        if (!mentor) {
            throw new NotFoundException(
                '유효하지 않은 mentor_idx 입니다. 먼저 멘토 등록을 해주세요.',
            );
        }
        if (Number(mentor.is_approved) !== 1) {
            throw new BadRequestException(
                '멘토가 아직 승인되지 않았습니다. 승인 후 상품을 등록할 수 있습니다.',
            );
        }

        // job_category 존재 확인
        const category = await this.databaseService.queryOne<{ id: number }>(
            'SELECT id FROM job_category WHERE id = ? LIMIT 1',
            [body.job_category_id],
        );
        if (!category) {
            throw new BadRequestException('존재하지 않는 직무 카테고리입니다.');
        }

        // 슬롯 유효성 확인
        if (body.slots && Array.isArray(body.slots)) {
            for (const s of body.slots) {
                if (s.day_of_week < 1 || s.day_of_week > 7) {
                    throw new BadRequestException('day_of_week는 1~7 범위여야 합니다.');
                }
                if (s.hour_slot < 0 || s.hour_slot > 23) {
                    throw new BadRequestException('hour_slot은 0~23 범위여야 합니다.');
                }
            }
        }

        /*
        INSERT INTO mentoring_products (
            mentor_idx, title, job_category_id, description, price, is_active, created_at
            ) VALUES (
            10, 
            '프론트엔드 면접 대비 1:1 멘토링',
            101,
            '실제 면접 경험 기반으로 포트폴리오와 코딩테스트 준비를 도와드립니다.',
            50000,
            1,
            NOW()
            );

            -- 새로 생성된 product_idx 얻기
            SET @productId = LAST_INSERT_ID();
            */

        /*
        INSERT INTO mentoring_regular_slots (product_idx, day_of_week, hour_slot, created_at)
        VALUES 
        (@productId, 2, 19, NOW()),
        (@productId, 4, 21, NOW());
        */

        const result = await this.databaseService.transaction(async (conn) => {
            const insertProductSql = `
                INSERT INTO mentoring_products (
                    mentor_idx, title, job_category_id, description, price, is_active, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, NOW())
            `;
            const isActive = body.is_active === undefined ? 1 : body.is_active ? 1 : 0;
            const [prodRes]: any = await conn.execute(insertProductSql, [
                body.mentor_idx,
                body.title,
                body.job_category_id,
                body.description,
                body.price,
                isActive,
            ]);
            const productIdx = prodRes.insertId as number;

            const slots = body.slots || [];
            if (slots.length > 0) {
                const insertSlotSql = `
                    INSERT IGNORE INTO mentoring_regular_slots (product_idx, day_of_week, hour_slot, created_at)
                    VALUES (?, ?, ?, NOW())
                `;
                for (const s of slots) {
                    await conn.execute(insertSlotSql, [productIdx, s.day_of_week, s.hour_slot]);
                }
            }

            const slotRowsSql = `
                SELECT day_of_week, hour_slot FROM mentoring_regular_slots WHERE product_idx = ? ORDER BY day_of_week, hour_slot
            `;
            const [slotRows] = await conn.query<any[]>(slotRowsSql, [productIdx]);

            return {
                mentor_idx: body.mentor_idx,
                title: body.title,
                job_category_id: body.job_category_id,
                description: body.description,
                price: body.price,
                slots: slotRows.map((r) => ({
                    day_of_week: r.day_of_week,
                    hour_slot: r.hour_slot,
                })),
            } as MentoringProductCreatedResponseDto;
        });

        return result;
    }

    async getMenteeApplications(menteeIdx: number): Promise<MenteeApplicationsResponseDto> {
        const sql = `
            SELECT a.application_id, p.title AS product_title, u.name AS mentor_name, a.booked_date, a.application_status
              FROM mentoring_applications a
              JOIN mentoring_products p ON a.product_idx = p.product_idx
              JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
              JOIN users u ON mp.user_idx = u.idx
             WHERE a.mentee_idx = ?
             ORDER BY a.created_at DESC
        `;
        const rows = await this.databaseService.query<{
            application_id: number;
            product_title: string;
            mentor_name: string;
            booked_date: Date;
            application_status: any;
        }>(sql, [menteeIdx]);

        return {
            applications: rows.map((r) => ({
                application_id: r.application_id,
                product_title: r.product_title,
                mentor_name: r.mentor_name,
                booked_date: new Date(r.booked_date).toISOString().slice(0, 10),
                application_status: r.application_status,
            })),
        };
    }

    async getMyMentoringApplications(
        userIdx: number,
        page = 1,
        limit = 10,
    ): Promise<MentoringApplicationsResponseDto> {
        // 전체 개수
        const countSql = `
        SELECT COUNT(*) AS total
        FROM mentoring_applications a
        WHERE a.mentee_idx = ?
    `;
        const countRow = await this.databaseService.queryOne<{ total: number }>(countSql, [
            userIdx,
        ]);
        const total = Number(countRow?.total ?? 0);

        const offset = (page - 1) * limit;

        // 멘티 본인이 예약한 상품 리스트 조회
        const listSql = `
        SELECT 
            a.application_id,
            a.booked_date,
            a.application_status,

            -- 멘티 정보
            u.idx AS mentee_user_idx,
            u.name AS mentee_name,
            u.profile_img AS mentee_profile_img,

            -- 상품 정보
            p.product_idx,
            p.title AS product_title,

            -- 멘토 정보
            mp.mentor_idx,
            mp.business_name,
            jc.name AS mentor_job_category,

            -- 캔버스 정보 (application_id FK 추가했을 경우)
            c.id AS canvas_id
        FROM mentoring_applications a
        JOIN users u ON a.mentee_idx = u.idx
        LEFT JOIN mentoring_products p ON a.product_idx = p.product_idx
        LEFT JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
        LEFT JOIN job_category jc ON p.job_category_id = jc.id
        LEFT JOIN canvas c ON c.application_id = a.application_id
        WHERE a.mentee_idx = ?
        ORDER BY a.created_at DESC
        LIMIT ? OFFSET ?
    `;

        const rows = await this.databaseService.query<any>(listSql, [userIdx, limit, offset]);

        return {
            applications: rows.map((r: any) => ({
                application_id: r.application_id,
                canvas_id: r.canvas_id ?? null, // 연결 안된 경우 null
                product_idx: r.product_idx,
                product_title: r.product_title,
                booked_date: r.booked_date
                    ? new Date(r.booked_date).toISOString().slice(0, 10)
                    : null,
                application_status: r.application_status,
                mentee: {
                    user_idx: r.mentee_user_idx,
                    name: r.mentee_name,
                    profile_img: r.mentee_profile_img ?? '',
                },
                mentor: {
                    mentor_idx: r.mentor_idx,
                    business_name: r.business_name,
                    job_category: r.mentor_job_category,
                },
            })),
            page_info: {
                page,
                limit,
                total,
                has_next: offset + limit < total,
            },
        };
    }

    async getMentoringApplications(
        userIdx: number,
        page = 1,
        limit = 10,
    ): Promise<MentoringApplicationsResponseDto> {
        const mentorRow = await this.databaseService.queryOne<{ mentor_idx: number }>(
            'SELECT mentor_idx FROM mentor_profiles WHERE user_idx = ? LIMIT 1',
            [userIdx],
        );

        if (!mentorRow) {
            return {
                applications: [],
                page_info: { page, limit, total: 0, has_next: false },
            } as MentoringApplicationsResponseDto;
        }

        const mentorIdx = mentorRow.mentor_idx;

        const countSql = `
            SELECT COUNT(*) AS total
              FROM mentoring_applications a
              JOIN mentoring_products p ON a.product_idx = p.product_idx
             WHERE p.mentor_idx = ?
        `;
        const countRow = await this.databaseService.queryOne<{ total: number }>(countSql, [
            mentorIdx,
        ]);
        const total = Number(countRow?.total ?? 0);

        const offset = (Number(page) - 1) * Number(limit);
        const listSql = `
            SELECT 
                a.application_id,
                a.product_idx,
                p.title AS product_title,
                a.booked_date,
                a.application_status,
                mpu.idx AS mentee_idx,
                mpu.name AS mentee_name,
                mpu.profile_img AS mentee_profile_img,
                mp.mentor_idx,
                mp.business_name,
                jc.name AS mentor_job_category
            FROM mentoring_applications a
            JOIN mentoring_products p ON a.product_idx = p.product_idx
            JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
            JOIN job_category jc ON mp.preferred_field_id = jc.id
            JOIN users mpu ON a.mentee_idx = mpu.idx
            WHERE p.mentor_idx = ?
            ORDER BY a.created_at DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.databaseService.query<any>(listSql, [
            mentorIdx,
            Number(limit),
            offset,
        ]);

        return {
            applications: rows.map((r: any) => ({
                application_id: r.application_id,
                product_idx: r.product_idx,
                product_title: r.product_title,
                booked_date: new Date(r.booked_date).toISOString().slice(0, 10),
                application_status: r.application_status,
                mentee: {
                    user_idx: r.mentee_idx,
                    name: r.mentee_name,
                    profile_img: r.mentee_profile_img ?? '',
                },
                mentor: {
                    mentor_idx: r.mentor_idx,
                    business_name: r.business_name,
                    job_category: r.mentor_job_category,
                },
            })),
            page_info: {
                page: Number(page),
                limit: Number(limit),
                total,
                has_next: offset + Number(limit) < total,
            },
        };
    }

    async updateApplicationStatus(
        applicationId: number,
        dto: UpdateApplicationStatusDto,
    ): Promise<UpdateApplicationStatusResponseDto> {
        const sql = `
            UPDATE mentoring_applications
               SET application_status = ?,
                   rejection_reason = ?,
                   approved_at = CASE WHEN ? = 'approved' THEN NOW() ELSE approved_at END,
                   rejected_at = CASE WHEN ? = 'rejected' THEN NOW() ELSE rejected_at END,
                   completed_at = CASE WHEN ? = 'completed' THEN NOW() ELSE completed_at END,
                   updated_at = NOW()
             WHERE application_id = ?
        `;
        await this.databaseService.execute(sql, [
            dto.application_status,
            dto.rejection_reason ?? null,
            dto.application_status,
            dto.application_status,
            dto.application_status,
            applicationId,
        ]);

        return {
            application_id: applicationId,
            application_status: dto.application_status,
            rejection_reason: dto.rejection_reason,
            updated_at: new Date().toISOString(),
        };
    }

    async createMentorApplication(
        dto: CreateMentorApplicationDto,
        userIdx: number,
    ): Promise<MentorApplicationCreateResponseDto> {
        try {
            // 먼저 이미 멘토로 등록되어 있는지 확인
            const checkSql = 'SELECT mentor_idx FROM mentor_profiles WHERE user_idx = ?';
            const existingMentor = await this.databaseService.queryOne(checkSql, [userIdx]);

            if (existingMentor) {
                return {
                    success: false,
                    message: '이미 경험을 나눠주고 계세요! 멘토링 상품을 등록하거나 관리해보세요.',
                    mentor_idx: existingMentor.mentor_idx,
                };
            }

            const sql = `
                INSERT INTO mentor_profiles (
                    user_idx, contact_email, business_name, contact_phone, 
                    preferred_field_id, introduction, portfolio_link, is_approved, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())
            `;

            const params = [
                userIdx,
                dto.contact_email,
                dto.business_name,
                dto.contact_phone,
                dto.preferred_field_id,
                dto.introduction,
                dto.portfolio_link || null,
            ];

            const result = await this.databaseService.execute(sql, params);
            const mentorIdx = (result as { insertId: number }).insertId;

            return {
                success: true,
                message: '멘토가 되어주셔서 감사합니다. 다른 분들에게 경험을 공유해주세요.',
                mentor_idx: mentorIdx,
            };
        } catch (error) {
            console.error('멘토 지원 등록 실패:', error);
            return {
                success: false,
                message: '멘토 지원 등록 중 오류가 발생했습니다.',
            };
        }
    }

    async getJobCategories(): Promise<JobCategoryResponseDto> {
        try {
            const sql = 'SELECT id, name FROM job_category ORDER BY id';
            const categories = await this.databaseService.query(sql);

            return {
                categories: categories.map((category: { id: number; name: string }) => ({
                    id: category.id,
                    name: category.name,
                })),
            };
        } catch (error) {
            console.error('직무 카테고리 조회 실패:', error);
            return {
                categories: [],
            };
        }
    }

    async getProductList(
        query: MentoringProductListQueryDto,
    ): Promise<MentoringProductListResponseDto> {
        try {
            const limit = 8; // 고정 8개
            const cursorProductIdx = query.cursor ? parseInt(query.cursor) : null;

            // 기본 정렬 설정 (product_idx 기준으로 최신순)
            const sortOrder = 'desc';

            // WHERE 조건 구성
            const whereConditions = ['p.is_active = 1'];
            const params: any[] = [];

            // 커서 기반 페이징 (product_idx 기준)
            if (cursorProductIdx !== null && cursorProductIdx > 0) {
                if (sortOrder === 'desc') {
                    whereConditions.push('p.product_idx < ?');
                } else {
                    whereConditions.push('p.product_idx > ?');
                }
                params.push(cursorProductIdx);
            }

            const whereClause =
                whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

            // 정렬 조건 구성 (product_idx 기준으로 최신순)
            const orderBy = `ORDER BY p.product_idx ${sortOrder}`;

            const sql = `
                SELECT 
                    p.product_idx,
                    p.title,
                    p.price,
                    u.name AS mentor_nickname,
                    u.profile_img,
                    mp.introduction AS mentor_profile,
                    COALESCE(ROUND(AVG(r.rating), 1), 0) AS rating,
                    COUNT(DISTINCT CASE WHEN a.application_status = 'approved' THEN a.mentee_idx END) AS participants,
                    p.created_at
                FROM mentoring_products p
                JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
                JOIN users u ON mp.user_idx = u.idx
                LEFT JOIN mentoring_reviews r ON p.product_idx = r.product_idx
                LEFT JOIN mentoring_applications a ON p.product_idx = a.product_idx
                ${whereClause}
                GROUP BY p.product_idx, p.title, p.price, u.name, u.profile_img, mp.introduction, p.created_at
                ${orderBy}
                LIMIT ${limit + 1}
            `;

            const rows = await this.databaseService.query(sql, params);

            // 다음 페이지 존재 여부 확인
            const hasMore = rows.length > limit;
            const products = hasMore ? rows.slice(0, limit) : rows;

            // 다음 커서 생성 (마지막 상품의 product_idx)
            const nextCursor =
                hasMore && products.length > 0
                    ? products[products.length - 1].product_idx.toString()
                    : undefined;

            // 응답 데이터 변환
            const productList: MentoringProductListItemDto[] = products.map((row: any) => ({
                product_idx: row.product_idx,
                title: row.title,
                mentor: {
                    nickname: row.mentor_nickname,
                    profile: row.mentor_profile,
                    profile_img: row.profile_img || 'https://picsum.photos/200?3',
                    info: [row.mentor_profile], // 멘토 프로필을 info 배열에 포함
                },
                rating: row.rating,
                participants: row.participants,
                price: row.price,
            }));

            // 전체 개수 조회 (캐싱을 위해 별도 쿼리)
            const countSql = `
                SELECT COUNT(DISTINCT p.product_idx) as total_count
                FROM mentoring_products p
                JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
                JOIN users u ON mp.user_idx = u.idx
                ${whereClause}
            `;

            const countResult = await this.databaseService.queryOne(countSql, params);
            const totalCount = countResult?.total_count || 0;

            return {
                products: productList,
                next_cursor: nextCursor,
                has_more: hasMore,
                total_count: totalCount,
            };
        } catch (error) {
            console.error('멘토링 상품 리스트 조회 실패:', error);
            throw new BadRequestException('멘토링 상품 리스트를 조회하는 중 오류가 발생했습니다.');
        }
    }

    async getMyMentorIdx(
        userIdx: number,
    ): Promise<{ mentor_idx: number | null; is_mentor: boolean }> {
        try {
            const mentorRow = await this.databaseService.queryOne<{ mentor_idx: number }>(
                'SELECT mentor_idx FROM mentor_profiles WHERE user_idx = ? LIMIT 1',
                [userIdx],
            );

            if (!mentorRow) {
                return {
                    mentor_idx: null,
                    is_mentor: false,
                };
            }

            return {
                mentor_idx: mentorRow.mentor_idx,
                is_mentor: true,
            };
        } catch (error) {
            console.error('멘토 idx 조회 실패:', error);
            throw new BadRequestException('멘토 정보를 조회하는 중 오류가 발생했습니다.');
        }
    }
}
