import * as cheerio from 'cheerio';

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

type HiddenFields = {
    form_build_id: string|undefined,
    form_token: string|undefined
};

export function extractFormHiddenFields(html: string): HiddenFields {
    return {
        form_build_id: html.match(
            /<input[^>]+name="form_build_id"[^>]+value="([^"]+)"/
        )?.[1],

        form_token: html.match(
            /<input[^>]+name="form_token"[^>]+value="([^"]+)"/
        )?.[1],
    };
}

export function parseResponse(html: string): Record<string, string> {
    const uid = html.match(/data-uid="([^"]+)"/)?.[1];

    const result: Record<string, string> = {};
    if (uid) {
        result['data-uid'] = uid;
    }

    const regex = /<span>([\s\S]*?)<\/span>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const parts = match[1].split(':');
        const key = parts[0]?.trim();
        const value = parts.slice(1).join(':').trim();
        if (key) {
            result[key] = value;
        }
    }

    return result;
}

export function parseTable(html: string): {name: string, value: string}[] {
    const $ = cheerio.load(html);

    return $('#pc-version').find('table.custom_table_vertical tr').map((_, row) => {
        return {
            name: $(row).find('th').text().trim(),
            value: $(row).find('td').text().trim()
        };
    }).get();
}
