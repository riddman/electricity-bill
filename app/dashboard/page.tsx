
import React from 'react';

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

import { unstable_cache } from 'next/cache';
import { accountData } from '@/data/dummy';

const getCachedProfileData = unstable_cache(
    async () => profileData(),
    ['profile-data'],
    { revalidate: 3600 }
);

export default async function DashboardPage() {
    // const data = await getCachedProfileData();
    const data = await profileData();

    // const data = accountData;

    return (
        <main className="p-6">
            <h1 className="text-2xl font-bold">Особовий рахунок</h1>

            <div className="grid grid-cols-[minmax(120px,35%)_1fr] border rounded-xl">
                {
                    data?.map((item) => (
                        <React.Fragment key={item.name}>
                            <div className="border-b border-r p-3 font-medium">
                                {item.name}
                            </div>

                            <div className="border-b p-3">
                                {item.value}
                            </div>
                        </React.Fragment>
                    ))
                }
            </div>

        </main>
    );
}

async function profileData() {
    const email = process.env.VOLYN_EMAIL;
    const password = process.env.VOLYN_PASSWORD;

    if (!email || !password) {
        return undefined;
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

        return accountData;
    } catch (error: any) {
        return undefined;
    }
}
