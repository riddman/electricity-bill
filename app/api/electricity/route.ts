import { NextResponse } from 'next/server';
import {
    fetchDashboardDataWithCache,
    selectAccount,
    getAccountData
} from '@/lib/volyn-scraper';

import {
    extractUidContainers,
    extractFormHiddenFields,
    parseResponse
} from '@/lib/scraper/html-paeser'

export async function GET() {
    const email = process.env.VOLYN_EMAIL;
    const password = process.env.VOLYN_PASSWORD;

    if (!email || !password) {
        return NextResponse.json(
            {
                status: 'error',
                message: 'VOLYN_EMAIL and VOLYN_PASSWORD environment variables are not configured.',
            },
            { status: 500 }
        );
    }

    try {
        // Fetch bill using cached session (or login if cache is empty/expired)
        const html = await fetchDashboardDataWithCache(email, password);

        const hiddenFields = extractFormHiddenFields(html)

        // Extract all div blocks with class uid_container allowed_uid
        const containers = extractUidContainers(html).map((item) => {
            return parseResponse(item)
        });

        let selectedAccount = null;
        let accountData = null;

        if (hiddenFields.form_build_id && hiddenFields.form_token) {
            selectedAccount = await selectAccount(
                email,
                password,
                {
                    formBuildId: hiddenFields.form_build_id,
                    formToken: hiddenFields.form_token,
                    formId: 'user_profile_uidor_form',
                    dummySubmit: containers[0]['data-uid']
                }
            );

            // console.log('=========', selectedAccount);
        }

        if (selectedAccount && selectedAccount.redirectUrl) {
            accountData = await getAccountData(
                email,
                password,
                selectedAccount.redirectUrl
            );
        }

        return NextResponse.json({
            status: 'success',
            message: 'Successfully fetched and parsed account page',
            containersCount: containers.length,
            containers: containers,
            hiddenFields: hiddenFields,
            selectedAccount: selectedAccount,
            accountData: accountData
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                message: error.message || 'Unknown error occurred during scraping',
            },
            { status: 500 }
        );
    }
}
