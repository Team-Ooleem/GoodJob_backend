// src/modules/interview/job-extract.service.ts
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '@/config/config.service';
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

@Injectable()
export class JobExtractService {
    private readonly logger = new Logger(JobExtractService.name);
    private readonly vision: ImageAnnotatorClient;
    private readonly openai: OpenAI;

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
                    try {
                        const r2 = await this.fetchHtmlDynamic(urlStr);
                        html = r2.html;
                        finalUrl = r2.finalUrl;
                        this.logger.log('코드=dynamic_fallback_ok');
                    } catch (e2: any) {
                        this.logger.error(
                            `코드=dynamic_fallback_fail reason=${e2?.code || e2?.message || e2}`,
                        );
                        throw e; // 원 오류 전달
                    }
                } else {
                    this.logger.error(`코드=fetch_error reason=${msg}`);
                    throw e;
                }
            }
            const baseUrl = finalUrl || urlStr;
            const meta = this.extractMeta(html);
            const textFromHtml = this.extractMainText(html);
            const title = meta['og:title'] || meta.title || '';
            const company = this.guessCompany(meta, textFromHtml);

            let images: string[] = [];
            let ocrText = '';

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
            page.setDefaultNavigationTimeout(15000);
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
            // JS 렌더링 대기(최대 2.5초)
            try {
                await page.waitForLoadState('networkidle', { timeout: 2500 });
            } catch {}
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
        const timeout = setTimeout(() => controller.abort(), 8000);
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

    private extractMainText(html: string): string {
        // Remove scripts/styles
        let body = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '');
        // Get body content
        const bodyMatch = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        body = bodyMatch ? bodyMatch[1] : body;
        // Strip tags
        const text = body
            .replace(/<[^>]+>/g, '\n')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
        // Collapse whitespace
        return text
            .split('\n')
            .map((t) => t.trim())
            .filter((t) => t.length > 0)
            .join('\n');
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

    private isTextInsufficient(text: string): boolean {
        if (!text) return true;
        // Heuristic: too short or lacks typical job keywords
        if (text.length < 500) return true;
        const kw = [
            '담당',
            '업무',
            '담당업무',
            '주요',
            '자격',
            '필수',
            '요건',
            '채용',
            '전형',
            '지원',
            '우대',
            '서류',
            '면접',
            '주요업무',
            '자격요건',
            '필수요건',
            '우대사항',
            '근무지',
            '근무형태',
            '연봉',
            'Responsibilities',
            'Qualifications',
            'Preferred',
            'Benefits',
        ];
        const lc = text.toLowerCase();
        const hit = kw.some((k) => lc.includes(k.toLowerCase()));
        return !hit;
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
        if (ogSite) return this.clean(ogSite);
        // Try simple pattern in text
        const m = text.match(/회사명\s*[:\-]\s*([^\n]{1,50})/);
        return m ? this.clean(m[1]) : '';
    }
}
