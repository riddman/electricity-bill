/**
 * Volyn Electricity Scraper - Steps 1, 2, and 3
 */

export interface ScraperSession {
    formBuildId: string;
    cookies: string;
}

/**
 * Step 1: Fetches the login page and extracts form_build_id and initial cookies.
 */
export async function getLoginContext(): Promise<ScraperSession> {
    const url = 'https://pay.elektro.volyn.ua/login';

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch login page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Extract cookies from Set-Cookie headers
    let cookiesString = '';
    if (typeof response.headers.getSetCookie === 'function') {
        const setCookies = response.headers.getSetCookie();
        cookiesString = setCookies.map(cookie => cookie.split(';')[0]).join('; ');
    } else {
        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader) {
            cookiesString = setCookieHeader
                .split(/,(?=[^ \t]+=)/)
                .map(c => c.trim().split(';')[0])
                .join('; ');
        }
    }

    // Extract form_build_id using regex
    const match = html.match(/name="form_build_id"\s+value="([^"]+)"/i) || html.match(/value="([^"]+)"[^>]+name="form_build_id"/i);

    if (!match || !match[1]) {
        throw new Error('Could not find form_build_id on the login page');
    }

    const formBuildId = match[1];

    return {
        formBuildId,
        cookies: cookiesString,
    };
}

/**
 * Step 2: Performs POST login request and returns authenticated cookies.
 */
export async function loginToVolyn(email: string, pass: string): Promise<string> {
    const context = await getLoginContext();

    const loginUrl = 'https://pay.elektro.volyn.ua/login?destination=/login';

    const formData = new URLSearchParams({
        name: email,
        pass: pass,
        form_build_id: context.formBuildId,
        form_id: 'user_login_form',
        op: 'Вхід',
    });

    const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': context.cookies,
            'Origin': 'https://pay.elektro.volyn.ua',
            'Referer': 'https://pay.elektro.volyn.ua/login',
        },
        body: formData.toString(),
        redirect: 'manual',
    });

    let newCookiesString = '';
    if (typeof response.headers.getSetCookie === 'function') {
        const setCookies = response.headers.getSetCookie();
        newCookiesString = setCookies.map(cookie => cookie.split(';')[0]).join('; ');
    } else {
        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader) {
            newCookiesString = setCookieHeader
                .split(/,(?=[^ \t]+=)/)
                .map(c => c.trim().split(';')[0])
                .join('; ');
        }
    }

    const cookieMap = new Map<string, string>();

    context.cookies.split(';').forEach(c => {
        const [key, ...val] = c.trim().split('=');
        if (key) cookieMap.set(key, val.join('='));
    });

    newCookiesString.split(';').forEach(c => {
        const [key, ...val] = c.trim().split('=');
        if (key) cookieMap.set(key, val.join('='));
    });

    const mergedCookies = Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

    if (response.status !== 302 && response.status !== 303 && response.status !== 200) {
        throw new Error(`Login failed with status: ${response.status}`);
    }

    return mergedCookies;
}

// In-memory cache for 30 minutes
interface CachedSession {
    cookies: string;
    expiresAt: number;
}

let sessionCache: CachedSession | null = null;
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Gets cached session cookies or logs in to acquire new ones.
 */
export async function getAuthenticatedSession(email: string, pass: string, forceRefresh = false): Promise<string> {
    const now = Date.now();

    if (!forceRefresh && sessionCache && sessionCache.expiresAt > now) {
        return sessionCache.cookies;
    }

    const cookies = await loginToVolyn(email, pass);

    sessionCache = {
        cookies,
        expiresAt: now + SESSION_TTL,
    };

    return cookies;
}

/**
 * Clears the active session cache.
 */
export function clearSessionCache() {
    sessionCache = null;
}

/**
 * High-level helper: Fetches electricity bill with automatic session caching and retry on auth failure.
 */
export async function fetchElectricityBillWithCache(email: string, pass: string): Promise<string> {
    try {
        let cookies = await getAuthenticatedSession(email, pass);
        let html = await getDashboardData(cookies);

        // Check if we were redirected to login page (indicating expired session)
        if (html.includes('user-login-form') || html.includes('Адреса електронної пошти')) {
            // Clear cache and retry once
            clearSessionCache();
            cookies = await getAuthenticatedSession(email, pass, true);
            html = await getDashboardData(cookies);
        }

        return html;
    } catch (error) {
        // If any error occurs, clear cache just in case
        clearSessionCache();
        throw error;
    }
}

export function parseResponse(html) {
    const uid = html.match(/data-uid="([^"]+)"/)?.[1];

    const result = {
        'data-uid': uid
    };

    const spans = [...html.matchAll(/<span>(.*?)<\/span>/gs)];

    spans.forEach(match => {
        const [key, ...valueParts] = match[1].split(':');

        result[key.trim()] = valueParts.join(':').trim();
    });

    return result;
}

/**
 * Step 3: Fetches the dashboard / profile page and extracts the payment amount.
 */
export async function getDashboardData(cookies: string): Promise<string> {
    const dashboardUrl = 'https://pay.elektro.volyn.ua/my/uidor';

    const response = await fetch(dashboardUrl, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': cookies,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
        redirect: 'follow',
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch dashboard page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    return html;
}

/**
 * Extracts all div blocks with class "uid_container allowed_uid" from the HTML content.
 */
export function extractUidContainers(html: string): string[] {
    const results: string[] = [];
    const regex = /<div\s+[^>]*class=["'](?:[^"']*\s+)?uid_container\s+allowed_uid(?:\s+[^"']*)?["'][^>]*>/gi;

    let match;
    const htmlLower = html.toLowerCase();

    while ((match = regex.exec(html)) !== null) {
        const startIdx = match.index;
        const tagOpenLength = match[0].length;
        let depth = 1;
        let cursor = startIdx + tagOpenLength;

        while (depth > 0 && cursor < html.length) {
            const nextDivOpen = htmlLower.indexOf('<div', cursor);
            const nextDivClose = htmlLower.indexOf('</div>', cursor);

            if (nextDivClose === -1) {
                break;
            }

            if (nextDivOpen !== -1 && nextDivOpen < nextDivClose) {
                depth++;
                cursor = nextDivOpen + 4;
            } else {
                depth--;
                cursor = nextDivClose + 6;
            }
        }

        if (depth === 0) {
            const containerHtml = html.substring(startIdx, cursor);
            results.push(containerHtml);
        }
    }

    return results;
}
