/**
 * Volyn Electricity Scraper - Steps 1, 2, and 3
 */

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ScraperSession {
    formBuildId: string;
    cookies: string;
}

/**
 * Extracts cookie string from response headers (supports both getSetCookie and set-cookie).
 */
export function extractCookiesFromHeaders(headers: Headers): string {
    if (typeof headers.getSetCookie === 'function') {
        const setCookies = headers.getSetCookie();
        return setCookies.map(cookie => cookie.split(';')[0]).join('; ');
    }

    const setCookieHeader = headers.get('set-cookie');
    if (setCookieHeader) {
        return setCookieHeader
            .split(/,(?=[^ \t]+=)/)
            .map(c => c.trim().split(';')[0])
            .join('; ');
    }

    return '';
}

/**
 * Merges two cookie strings uniquely by cookie name using a Map.
 */
export function mergeCookies(oldCookies: string, newCookies: string): string {
    const cookieMap = new Map<string, string>();

    const parseAndSet = (cookieString: string) => {
        cookieString.split(';').forEach(c => {
            const [key, ...val] = c.trim().split('=');
            if (key) cookieMap.set(key, val.join('='));
        });
    };

    parseAndSet(oldCookies);
    parseAndSet(newCookies);

    return Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

/**
 * Extracts form_build_id from login page HTML using regular expressions.
 */
export function extractFormBuildId(html: string): string {
    const match = html.match(/name="form_build_id"\s+value="([^"]+)"/i) || html.match(/value="([^"]+)"[^>]+name="form_build_id"/i);

    if (!match || !match[1]) {
        throw new Error('Could not find form_build_id on the login page');
    }

    return match[1];
}

/**
 * Step 1: Fetches the login page and extracts form_build_id and initial cookies.
 */
export async function getLoginContext(): Promise<ScraperSession> {
    const url = 'https://pay.elektro.volyn.ua/login';

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch login page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const cookies = extractCookiesFromHeaders(response.headers);
    const formBuildId = extractFormBuildId(html);

    return {
        formBuildId,
        cookies,
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
            'User-Agent': DEFAULT_USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': context.cookies,
            'Origin': 'https://pay.elektro.volyn.ua',
            'Referer': 'https://pay.elektro.volyn.ua/login',
        },
        body: formData.toString(),
        redirect: 'manual',
    });

    const newCookiesString = extractCookiesFromHeaders(response.headers);
    const mergedCookies = mergeCookies(context.cookies, newCookiesString);

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
export async function fetchDashboardDataWithCache(email: string, pass: string): Promise<string> {
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

/**
 * Interface for Uidor form data.
 */
export interface UidorFormData {
    formBuildId: string;
    formToken: string;
    formId: string;
    dummySubmit: string;
}

/**
 * Step 3: Fetches the dashboard / profile page and extracts the payment amount.
 */
export async function getDashboardData(cookies: string): Promise<string> {
    const dashboardUrl = 'https://pay.elektro.volyn.ua/my/uidor';

    const response = await fetch(dashboardUrl, {
        method: 'GET',
        headers: {
            'User-Agent': DEFAULT_USER_AGENT,
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
 * Step 4:
 * Submits the Uidor form to switch/select an account.
 * Returns the potential redirect URL and updated cookies.
 */
export async function selectAccount(
    email: string,
    pass: string,
    data: UidorFormData
): Promise<{ redirectUrl: string | null; cookies: string, response: Response }> {
    const url = 'https://pay.elektro.volyn.ua/my/uidor';

    const cookies = await getAuthenticatedSession(email, pass);

    const formData = new URLSearchParams({
        form_build_id: data.formBuildId,
        form_token: data.formToken,
        form_id: data.formId,
        dummy_submit: data.dummySubmit,
    });

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookies,
            'Origin': 'https://pay.elektro.volyn.ua',
            'Referer': 'https://pay.elektro.volyn.ua/my/uidor',
        },
        body: formData.toString(),
        redirect: 'manual',
    });

    const newCookies = extractCookiesFromHeaders(response.headers);
    const mergedCookies = mergeCookies(cookies, newCookies);
    // const redirectUrl = response.headers.get('location');

    const headers = Object.fromEntries(response.headers.entries());

    if (response.status !== 303 && response.status !== 302 && response.status !== 200) {
        throw new Error(`Uidor submission failed with status: ${response.status}`);
    }

    const now = Date.now();

    sessionCache = {
        cookies: mergedCookies,
        expiresAt: now + SESSION_TTL,
    };

    // console.log('==========');

    // console.log(
    //     // response,
    //     headers,
    //     headers.location
    // );

    return {
        redirectUrl: headers.location,
        cookies: mergedCookies,
        response: response
    };
}
