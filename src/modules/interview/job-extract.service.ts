// src/modules/interview/job-extract.service.ts
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '@/config/config.service';
import { z } from 'zod';
import { ImageAnnotatorClient } from '@google-cloud/vision';

export type ExtractResult =
    | {
          ok: true;
          url: string;
          source: 'html' | 'ocr' | 'mixed';
          title?: string;
          company?: string;
          content: string; // consolidated text
          imagesTried: string[];
          meta?: Record<string, string>;
      }
    | {
          ok: false;
          url: string;
          error?: string;
      };

// JSON 구조 요약 타입
export type JobPostSummary = {
    jobTitle?: string;
    company?: string;
    responsibilities: string[];
    mustRequirements: string[];
    preferred?: string[];
    keywords?: string[];
};

@Injectable()
export class JobExtractService {
    private readonly logger = new Logger(JobExtractService.name);
    private readonly vision: ImageAnnotatorClient;
    private readonly openai: OpenAI;
    private readonly summarySchema = z.object({
        jobTitle: z.string().optional(),
        company: z.string().optional(),
        responsibilities: z.array(z.string()).optional(),
        mustRequirements: z.array(z.string()).optional(),
        preferred: z.array(z.string()).optional(),
        keywords: z.array(z.string()).optional(),
    });

    constructor(private readonly config: AppConfigService) {
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            this.logger.warn(
                'GOOGLE_APPLICATION_CREDENTIALS 환경변수가 없습니다. Vision 사용 불가.',
            );
        }
        // 인증 정보는 GOOGLE_APPLICATION_CREDENTIALS를 통해 자동 로드
        this.vision = new ImageAnnotatorClient();
        this.openai = new OpenAI({ apiKey: this.config.openai.apiKey });
    }

    // Public API
    async extract(urlStr: string): Promise<ExtractResult> {
        try {
            const safe = this.validateUrl(urlStr);
            if (!safe.ok) return { ok: false, url: urlStr, error: safe.error };

            const t0 = Date.now();
            let html = '';
            let finalUrl: string | undefined = undefined;
            let usedDynamic = false;

            // 사람인과 잡코리아는 바로 동적 렌더링 사용
            if (this.shouldUseDynamicFirst(urlStr)) {
                try {
                    const r = await this.fetchHtmlDynamic(urlStr);
                    html = r.html;
                    finalUrl = r.finalUrl;
                    usedDynamic = true;
                    this.logger.log('코드=dynamic_first_ok');
                } catch (e: any) {
                    this.logger.warn(`코드=dynamic_first_fail reason=${e?.message}`);
                    // 동적 렌더링 실패시 정적 페이지 시도
                }
            }

            // 동적 렌더링을 시도하지 않았거나 실패한 경우 정적 페이지 시도
            if (!usedDynamic || !html) {
                try {
                    const r = await this.fetchHtml(urlStr);
                    html = r.html;
                    finalUrl = r.finalUrl;
                } catch (e: any) {
                    const msg = String(e?.message || e || 'unknown');
                    if (/HTTP\s+(403|406|503)/.test(msg)) {
                        this.logger.warn(
                            `코드=fetch_blocked status=${msg.match(/HTTP\s+\d+/)?.[0] || 'unknown'} url=${urlStr}`,
                        );
                        if (!usedDynamic) {
                            try {
                                const r2 = await this.fetchHtmlDynamic(urlStr);
                                html = r2.html;
                                finalUrl = r2.finalUrl;
                                this.logger.log('코드=dynamic_fallback_ok');
                                usedDynamic = true;
                            } catch (e2: any) {
                                this.logger.error(
                                    `코드=dynamic_fallback_fail reason=${e2?.code || e2?.message || e2}`,
                                );
                                throw e; // 원 오류 전달
                            }
                        } else {
                            throw e;
                        }
                    } else {
                        this.logger.error(`코드=fetch_error reason=${msg}`);
                        throw e;
                    }
                }
            }

            const baseUrl = finalUrl || urlStr;
            const meta = this.extractMeta(html);
            let textFromHtml = this.extractMainText(html);
            const title = meta['og:title'] || meta.title || '';
            const company = this.guessCompany(meta, textFromHtml);

            let images: string[] = [];
            let ocrText = '';

            // 텍스트가 부족하고 동적 시도를 아직 안했다면 Playwright로 재시도
            if (this.isTextInsufficient(textFromHtml) && !usedDynamic) {
                try {
                    const u = new URL(baseUrl);
                    if (/saramin\.co\.kr|jobkorea\.co\.kr/i.test(u.hostname)) {
                        this.logger.warn('코드=dynamic_on_insufficient 도메인=kr_job_board');
                    } else {
                        this.logger.warn('코드=dynamic_on_insufficient');
                    }
                    const r3 = await this.fetchHtmlDynamic(baseUrl);
                    html = r3.html;
                    textFromHtml = this.extractMainText(html);
                    usedDynamic = true;
                } catch (e: any) {
                    this.logger.warn(`코드=dynamic_on_insufficient_fail reason=${e?.message}`);
                }
            }

            if (this.isTextInsufficient(textFromHtml)) {
                images = this.extractImageUrls(html, baseUrl).slice(0, 5);
                ocrText = await this.ocrImages(images);
            }

            const content = this.mergeContents(textFromHtml, ocrText);
            const source: 'html' | 'ocr' | 'mixed' =
                textFromHtml && ocrText ? 'mixed' : textFromHtml ? 'html' : 'ocr';

            this.logger.log(
                `job-extract 완료: url=${urlStr}, source=${source}, len=${content.length}, durMs=${Date.now() - t0}`,
            );

            if (!content || content.trim().length < 30) {
                return { ok: false, url: urlStr, error: '본문 추출 실패(내용 부족)' };
            }

            return {
                ok: true,
                url: urlStr,
                source,
                title: title || undefined,
                company: company || undefined,
                content,
                imagesTried: images,
                meta,
            };
        } catch (e: any) {
            this.logger.error(`job-extract 실패: ${e?.message}`);
            return { ok: false, url: urlStr, error: e?.message || 'unknown error' };
        }
    }

    // 동적 렌더링을 우선적으로 사용해야 하는 도메인인지 판단
    private shouldUseDynamicFirst(urlStr: string): boolean {
        try {
            const u = new URL(urlStr);
            const hostname = u.hostname.toLowerCase();
            // 한국 주요 채용사이트들은 동적 렌더링 우선
            const dynamicFirstDomains = [
                'saramin.co.kr',
                'jobkorea.co.kr',
                'wanted.co.kr',
                'programmers.co.kr',
                'jumpit.co.kr',
                'rocketpunch.com',
                'catch.co.kr',
            ];
            return dynamicFirstDomains.some((domain) => hostname.includes(domain));
        } catch {
            return false;
        }
    }

    // Playwright를 사용한 동적 렌더링 추출 (선택적)
    private async fetchHtmlDynamic(urlStr: string): Promise<{ html: string; finalUrl?: string }> {
        // 동적 import로 의존성 여부를 확인
        let playwright: any;
        try {
            playwright = await import('playwright');
        } catch (e: any) {
            const msg = `playwright 모듈 없음`;
            (e as any).code = 'dynamic_missing_dep';
            this.logger.warn(`코드=dynamic_missing_dep url=${urlStr}`);
            throw e;
        }

        const browser = await playwright.chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        const ctx = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            viewport: { width: 1366, height: 900 },
            locale: 'ko-KR',
        });
        const page = await ctx.newPage();
        try {
            page.setDefaultNavigationTimeout(20000); // 타임아웃을 20초로 증가
            await page.route('**/*', (route) => {
                const req = route.request();
                const resourceType = req.resourceType();
                // 이미지/폰트/미디어는 차단하여 속도 향상
                if (['image', 'font', 'media'].includes(resourceType)) {
                    return route.abort();
                }
                return route.continue();
            });

            await page.goto(urlStr, { waitUntil: 'domcontentloaded' });

            // 사람인 특화: 채용공고 콘텐츠 로딩 대기
            if (urlStr.includes('saramin.co.kr')) {
                try {
                    // 채용공고 메인 콘텐츠가 로드될 때까지 대기
                    await page.waitForSelector(
                        '.job_sector, .job-description, .content, [class*="job"], [class*="recruit"]',
                        { timeout: 10000 },
                    );
                } catch {
                    this.logger.warn('사람인 채용공고 콘텐츠 대기 실패, 일반 대기로 전환');
                }
            }

            // JS 렌더링 대기(최대 5초)
            try {
                await page.waitForLoadState('networkidle', { timeout: 5000 });
            } catch {}

            // 추가 대기: 동적 콘텐츠 완전 로딩 대기
            await page.waitForTimeout(2000);

            const html = await page.evaluate(() => document.documentElement.outerHTML);
            const finalUrl = page.url();
            return { html, finalUrl };
        } catch (e: any) {
            (e as any).code = (e as any).code || 'dynamic_navigation_error';
            this.logger.error(`코드=${(e as any).code} url=${urlStr} reason=${e?.message}`);
            throw e;
        } finally {
            await ctx.close().catch(() => {});
            await browser.close().catch(() => {});
        }
    }

    // 한국 채용사이트에 특화된 텍스트 추출 로직 개선
    private extractMainText(html: string): string {
        // Remove scripts/styles
        let body = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<!--[\s\S]*?-->/gi, ''); // 주석 제거

        // Get body content
        const bodyMatch = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        body = bodyMatch ? bodyMatch[1] : body;

        // 사람인 특화: 불필요한 영역 제거
        if (html.includes('saramin.co.kr')) {
            // 헤더, 네비게이션, 푸터, 광고 등 제거
            body = body
                .replace(/<header[\s\S]*?<\/header>/gi, '')
                .replace(/<nav[\s\S]*?<\/nav>/gi, '')
                .replace(/<footer[\s\S]*?<\/footer>/gi, '')
                .replace(
                    /<div[^>]*class="[^"]*(?:header|nav|footer|ad|banner|sidebar)[^"]*"[\s\S]*?<\/div>/gi,
                    '',
                )
                .replace(
                    /<div[^>]*id="[^"]*(?:header|nav|footer|ad|banner|sidebar)[^"]*"[\s\S]*?<\/div>/gi,
                    '',
                );
        }

        // Strip tags but preserve structure
        const text = body
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?(p|div|h[1-6]|li|tr|td|th)[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        // Collapse whitespace and clean up
        const lines = text
            .split('\n')
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter((line) => {
                // 의미없는 짧은 라인이나 네비게이션 텍스트 제거
                if (line.length < 3) return false;
                const excludePatterns = [
                    /^(메뉴|로그인|회원가입|검색|홈|이전|다음|TOP|닫기)$/,
                    /^[0-9\-\s]+$/,
                    /^[\s]*$/,
                ];
                return !excludePatterns.some((pattern) => pattern.test(line));
            });

        return lines.join('\n');
    }

    // 텍스트 부족 여부 판단 로직 개선
    private isTextInsufficient(text: string): boolean {
        if (!text) return true;

        // 길이 기준 완화 (사이트에 따라 다름)
        if (text.length < 300) return true;

        // 한국어 채용공고 키워드 확장
        const koreanJobKeywords = [
            '담당업무',
            '주요업무',
            '업무내용',
            '직무내용',
            '자격요건',
            '필수요건',
            '우대사항',
            '우대조건',
            '근무조건',
            '근무지',
            '근무형태',
            '급여',
            '연봉',
            '채용전형',
            '지원방법',
            '서류전형',
            '면접',
            '회사소개',
            '복리후생',
            '기업문화',
        ];

        const englishJobKeywords = [
            'responsibilities',
            'requirements',
            'qualifications',
            'preferred',
            'benefits',
            'location',
            'salary',
            'position',
            'role',
            'experience',
            'skills',
        ];

        const allKeywords = [...koreanJobKeywords, ...englishJobKeywords];
        const lowerText = text.toLowerCase();

        // 키워드 매칭 개수 확인 (최소 2개 이상)
        const keywordMatches = allKeywords.filter((keyword) =>
            lowerText.includes(keyword.toLowerCase()),
        ).length;

        return keywordMatches < 2;
    }

    // LLM 기반 채용공고 요약(한국어, 구조화)
    async summarizeJobPost(text: string, maxChars = 1200): Promise<string> {
        const t0 = Date.now();
        const raw = (text || '').toString();
        if (!raw.trim()) return '';
        const system = '너는 채용공고를 요약하는 도우미다. 반드시 한국어로 간결히 핵심만 정리하라.';
        const user =
            `다음 채용공고를 간단 명료하게 요약해라. 형식:\n` +
            `- 직무명:\n- 회사:\n- 주요업무: (2-4줄)\n- 필수요건: (불릿 3-6개)\n- 우대사항: (불릿 2-5개, 없으면 생략)\n- 핵심키워드: (콤마 구분 6-12개)\n문서:\n${raw.slice(0, 8000)}`;

        try {
            const r = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            });
            const out = (r.choices?.[0]?.message?.content || '').trim();
            const cleaned = out.replace(/\s+$/g, '');
            const limited = cleaned.length > maxChars ? cleaned.slice(0, maxChars) + '…' : cleaned;
            this.logger.log(
                `summarizeJobPost 완료: len=${limited.length}, durationMs=${Date.now() - t0}`,
            );
            return limited;
        } catch (e: any) {
            this.logger.warn(`summarizeJobPost 실패: ${e?.message}`);
            const truncated = raw.replace(/\s+/g, ' ').trim();
            return truncated.length > maxChars ? truncated.slice(0, maxChars) + '…' : truncated;
        }
    }

    // LLM 기반 채용공고 요약(JSON)
    async summarizeJobPostJson(text: string): Promise<JobPostSummary> {
        const raw = (text || '').toString();
        if (!raw.trim()) return { responsibilities: [], mustRequirements: [] };
        const system = '너는 채용공고를 구조화 요약하는 도우미다. 반드시 JSON만 출력한다.';
        const user = `다음 채용공고를 JSON으로 요약하라. 스키마 키:
- jobTitle?: string
- company?: string
- responsibilities: string[] (2-6)
- mustRequirements: string[] (3-8)
- preferred?: string[] (0-6)
- keywords?: string[] (6-12)
문서:\n${raw.slice(0, 8000)}`;
        try {
            const r = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            });
            const content = r.choices?.[0]?.message?.content || '{}';
            const parsed = this.summarySchema.safeParse(JSON.parse(content));
            if (!parsed.success) throw new Error('summary_json_invalid');
            const o = parsed.data as any;
            return {
                jobTitle: o.jobTitle?.trim() || undefined,
                company: o.company?.trim() || undefined,
                responsibilities: (o.responsibilities || [])
                    .map((s: string) => s.trim())
                    .filter(Boolean),
                mustRequirements: (o.mustRequirements || [])
                    .map((s: string) => s.trim())
                    .filter(Boolean),
                preferred: (o.preferred || []).map((s: string) => s.trim()).filter(Boolean),
                keywords: (o.keywords || []).map((s: string) => s.trim()).filter(Boolean),
            };
        } catch (e: any) {
            this.logger.warn(`summarizeJobPostJson 실패: ${e?.message}`);
            // 폴백: 비어있는 구조 반환
            return { responsibilities: [], mustRequirements: [] };
        }
    }

    // Basic URL validation + SSRF guard (best-effort)
    private validateUrl(urlStr: string): { ok: boolean; error?: string } {
        try {
            const u = new URL(urlStr);
            if (!['http:', 'https:'].includes(u.protocol)) {
                return { ok: false, error: 'http/https만 허용됩니다.' };
            }
            const host = u.hostname.toLowerCase();
            const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
            if (blocked.includes(host) || host.endsWith('.local')) {
                return { ok: false, error: '로컬 주소는 허용되지 않습니다.' };
            }
            // Note: 완전한 SSRF 방지는 DNS/IP 해석이 필요하므로 여기서는 기본 차단만 수행
            return { ok: true };
        } catch {
            return { ok: false, error: '유효하지 않은 URL입니다.' };
        }
    }

    private buildBrowserHeaders(urlStr: string, kind: 'html' | 'image') {
        let origin = '';
        try {
            const u = new URL(urlStr);
            origin = `${u.protocol}//${u.host}`;
        } catch {}
        const common: Record<string, string> = {
            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            Referer: origin || 'https://www.google.com/',
            'Cache-Control': 'no-cache',
        };
        if (kind === 'html') {
            return {
                ...common,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Dest': 'document',
                'Upgrade-Insecure-Requests': '1',
            } as Record<string, string>;
        }
        return {
            ...common,
            Accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Dest': 'image',
        } as Record<string, string>;
    }

    private async fetchHtml(urlStr: string): Promise<{ html: string; finalUrl?: string }> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 타임아웃 증가
        try {
            const primaryHeaders = this.buildBrowserHeaders(urlStr, 'html');
            let res = await fetch(urlStr, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
                headers: primaryHeaders as any,
            } as any);
            // Retry with alternate UA if blocked
            if (!res.ok && (res.status === 403 || res.status === 406)) {
                const altHeaders = {
                    ...primaryHeaders,
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                };
                res = await fetch(urlStr, {
                    method: 'GET',
                    redirect: 'follow',
                    signal: controller.signal,
                    headers: altHeaders as any,
                } as any);
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();
            const finalUrl = (res as any).url || urlStr;
            return { html, finalUrl };
        } catch (e: any) {
            throw new Error(`페이지 로드 실패: ${e?.message || e}`);
        } finally {
            clearTimeout(timeout);
        }
    }

    private extractMeta(html: string): Record<string, string> {
        const meta: Record<string, string> = {};
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) meta.title = this.clean(titleMatch[1]);

        const metaTagRe =
            /<meta[^>]+(name|property)=["']([^"']+)["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
        let m: RegExpExecArray | null;
        while ((m = metaTagRe.exec(html))) {
            const key = m[2].toLowerCase();
            meta[key] = this.clean(m[3]);
        }
        return meta;
    }

    private extractImageUrls(html: string, baseUrl: string): string[] {
        const urls = new Set<string>();
        const re = /<img[^>]+(src|data-src|data-original|data-lazy)=["']([^"']+)["'][^>]*>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html))) {
            const raw = m[2];
            try {
                const u = new URL(raw, baseUrl).toString();
                // Filter suspicious/very small images by extension heuristic
                if (/(\.png|\.jpe?g|\.webp|\.gif)(\?|$)/i.test(u)) {
                    urls.add(u);
                }
            } catch {
                // ignore
            }
        }
        return Array.from(urls);
    }

    private async ocrImages(imageUrls: string[]): Promise<string> {
        if (!imageUrls.length) return '';

        const maxParallel = 2;
        const texts: string[] = [];
        let i = 0;
        const worker = async () => {
            while (i < imageUrls.length) {
                const idx = i++;
                const url = imageUrls[idx];
                try {
                    const buffer = await this.fetchImage(url);
                    if (!buffer || buffer.length === 0) continue;
                    const [result] = await this.vision.textDetection({
                        image: { content: buffer },
                    });
                    const fullText = result.fullTextAnnotation?.text || '';
                    if (fullText && fullText.trim()) texts.push(fullText.trim());
                } catch (e: any) {
                    this.logger.warn(`OCR 실패: ${url} - ${e?.message || e}`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(maxParallel, imageUrls.length) }, worker));
        return texts
            .map((t) => t.replace(/\r/g, '').trim())
            .filter(Boolean)
            .join('\n');
    }

    private async fetchImage(urlStr: string): Promise<Buffer> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const headers = this.buildBrowserHeaders(urlStr, 'image');
            const res = await fetch(urlStr, {
                method: 'GET',
                signal: controller.signal,
                headers: headers as any,
            } as any);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ab = await res.arrayBuffer();
            return Buffer.from(ab);
        } catch (e: any) {
            throw new Error(`이미지 로드 실패: ${e?.message || e}`);
        } finally {
            clearTimeout(timeout);
        }
    }

    private clean(s: string): string {
        return (s || '').replace(/\s+/g, ' ').trim();
    }

    private mergeContents(htmlText: string, ocrText: string): string {
        const parts = [htmlText?.trim(), ocrText?.trim()].filter((t) => t && t.length > 0);
        // Deduplicate simple lines
        const seen = new Set<string>();
        const lines: string[] = [];
        for (const p of parts) {
            for (const line of p.split(/\n+/)) {
                const norm = line.replace(/\s+/g, ' ').trim();
                if (norm && !seen.has(norm)) {
                    seen.add(norm);
                    lines.push(norm);
                }
            }
        }
        return lines.join('\n');
    }

    private guessCompany(meta: Record<string, string>, text: string): string {
        // Try meta first
        const ogSite = meta['og:site_name'] || meta['application-name'];
        if (ogSite && !ogSite.includes('saramin') && !ogSite.includes('jobkorea')) {
            return this.clean(ogSite);
        }

        // 사람인/잡코리아 등에서 회사명 추출 시도
        const companyPatterns = [
            /회사명\s*[:\-]\s*([^\n]{1,50})/,
            /기업명\s*[:\-]\s*([^\n]{1,50})/,
            /회사\s*[:\-]\s*([^\n]{1,50})/,
            /Company\s*[:\-]\s*([^\n]{1,50})/i,
            /기업정보\s*([^\n]{1,50})/,
            // 사람인 특화 패턴
            /class="[^"]*company[^"]*"[^>]*>([^<]{1,50})</,
            /회사소개[\s\S]*?<[^>]+>([^<]{2,50})</,
        ];

        for (const pattern of companyPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const company = this.clean(match[1]);
                // 의미있는 회사명인지 확인
                if (
                    company.length > 1 &&
                    !company.includes('saramin') &&
                    !company.includes('jobkorea')
                ) {
                    return company;
                }
            }
        }

        return '';
    }
}
