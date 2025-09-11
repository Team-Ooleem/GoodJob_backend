import { Injectable } from '@nestjs/common';
import { MentoringProductDto } from './dto/product.dto';
import { MentoringProductSlotsDto } from './dto/product-slots.dto';
import { ApplicationResponseDto, CreateApplicationDto } from './dto/application.dto';
import { MentoringProductReviewsDto } from './dto/product-reviews.dto';
import { MentorReviewsResponseDto } from './dto/mentor-reviews.dto';
import { CreateProductReviewDto, ProductReviewResponseDto } from './dto/product-review.dto';
import {
    CreateMentoringProductDto,
    MentoringProductCreatedResponseDto,
} from './dto/product-create.dto';
import { MenteeApplicationsResponseDto } from './dto/mentee-applications.dto';

@Injectable()
export class MentoringService {
    getProduct(productIdx: number): MentoringProductDto {
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
        return {
            product_idx: productIdx,
            title: '프론트엔드 면접 대비 1:1 멘토링',
            description: '실제 면접 경험 기반으로 포트폴리오와 코딩테스트 준비를 도와드립니다.',
            price: 50000,
            job_category: '프론트엔드 개발',

            mentee_count: 8,
            review_count: 12,
            average_rating: 4.8,

            mentor: {
                name: '홍길동',
                job_category: '프론트엔드 개발',
                career: '5년차',
                business_name: '네이버',
            },
        };
    }

    getProductSlots(productIdx: number): MentoringProductSlotsDto {
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
        return {
            date: '2025-09-14',
            day_of_week: 7,
            slots: [
                { hour_slot: 9, time_range: '09:00-10:00', available: false },
                { hour_slot: 10, time_range: '10:00-11:00', available: true },
                { hour_slot: 11, time_range: '11:00-12:00', available: false },
                { hour_slot: 15, time_range: '15:00-16:00', available: true },
            ],
        };
    }

    createApplication(
        productIdx: number,
        dto: CreateApplicationDto,
        menteeIdx = 20,
    ): ApplicationResponseDto {
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
        return {
            application_id: 101,
            product_idx: productIdx,
            mentee_idx: menteeIdx,
            regular_slots_idx: dto.regular_slots_idx,
            booked_date: dto.booked_date,
            application_status: 'pending',
            message_to_mentor: dto.message_to_mentor,
            payment: {
                payment_id: 555,
                amount: dto.payment.amount,
                status: dto.payment.status,
                transaction_id: dto.payment.transaction_id,
                paid_at: '2025-09-11T15:20:00Z',
            },
            created_at: '2025-09-11T15:20:00Z',
        };
    }

    getProductReviews(productIdx: number, limit = 10, cursor?: string): MentoringProductReviewsDto {
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

        const reviews = [
            {
                review_idx: 201,
                mentee_name: '홍길동',
                rating: 5,
                review_content: '멘토님 덕분에 면접 잘 봤습니다.',
                created_at: '2025-09-10T12:00:00Z',
            },
            {
                review_idx: 200,
                mentee_name: '이영희',
                rating: 4,
                review_content: '조언이 유익했어요.',
                created_at: '2025-09-09T15:30:00Z',
            },
        ];

        return {
            product_idx: productIdx,
            average_rating: 4.7,
            review_count: 53,
            reviews,
            page_info: {
                next_cursor: '2025-09-09T15:30:00Z',
                has_more: true,
            },
        };
    }

    getMentorReviews(mentorIdx: number, page = 1, limit = 20): MentorReviewsResponseDto {
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

        return {
            mentor_idx: mentorIdx,
            review_count: 53,
            average_rating: 4.8,
            page_info: {
                page,
                limit,
                total_pages: 3,
                has_next: true,
            },
            reviews: [
                {
                    review_idx: 201,
                    product_idx: 1,
                    product_title: '프론트엔드 면접 대비 멘토링',
                    mentee: {
                        user_idx: 20,
                        name: '김민수',
                        profile_img: 'https://cdn.example.com/profiles/20.png',
                    },
                    rating: 5,
                    review_content: '멘토링 덕분에 합격했습니다!',
                    created_at: '2025-09-10T12:00:00Z',
                },
                {
                    review_idx: 200,
                    product_idx: 2,
                    product_title: '포트폴리오 클리닉',
                    mentee: {
                        user_idx: 21,
                        name: '이영희',
                        profile_img: 'https://cdn.example.com/profiles/21.png',
                    },
                    rating: 4,
                    review_content: '도움은 되었지만 시간이 부족했어요.',
                    created_at: '2025-09-09T15:30:00Z',
                },
            ],
        };
    }

    createProductReview(
        productIdx: number,
        body: CreateProductReviewDto,
        menteeIdx = 20,
    ): ProductReviewResponseDto {
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
        return {
            review_idx: 555,
            product_idx: productIdx,
            application_id: body.application_id,
            mentee_idx: menteeIdx,
            rating: body.rating,
            review_content: body.review_content,
            created_at: '2025-09-11T15:30:00Z',
        };
    }

    createProduct(body: CreateMentoringProductDto): MentoringProductCreatedResponseDto {
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

        return {
            mentor_idx: body.mentor_idx,
            title: body.title,
            job_category_id: body.job_category_id,
            description: body.description,
            price: body.price,
            slots: body.slots.map((s) => ({ day_of_week: s.day_of_week, hour_slot: s.hour_slot })),
        };
    }

    getMenteeApplications(menteeIdx: number): MenteeApplicationsResponseDto {
        // 더미 데이터: menteeIdx는 현재 로직에 직접 사용하지 않음
        return {
            applications: [
                {
                    application_id: 101,
                    product_title: '프론트엔드 면접 대비',
                    mentor_name: '홍길동',
                    booked_date: '2025-09-14',
                    application_status: 'approved',
                },
            ],
        };
    }
}
