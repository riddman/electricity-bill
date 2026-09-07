
import React from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';

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
const getCachedProfileData = unstable_cache(
    async () => profileData(),
    ['profile-data'],
    { revalidate: 3600 }
);

async function loginAction(formData: FormData) {
    'use server';

    const password = formData.get('password') as string;
    const correctPassword = process.env.DASHBOARD_PASSWORD;

    if (!correctPassword) {
        console.error('DASHBOARD_PASSWORD is not set in environment variables');
        redirect('/dashboard?error=setup');
    }

    if (password === correctPassword) {
        const cookieStore = await cookies();
        cookieStore.set('dashboard_auth', password, {
            maxAge: 3600, // 1 година
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/'
        });
    } else {
        redirect('/dashboard?error=true');
    }

    redirect('/dashboard');
}

interface PageProps {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
    const resolvedSearchParams = await searchParams;
    const hasError = resolvedSearchParams.error === 'true';
    const hasSetupError = resolvedSearchParams.error === 'setup';

    const cookieStore = await cookies();
    const isAuthenticated = cookieStore.get('dashboard_auth')?.value === process.env.DASHBOARD_PASSWORD;

    const data = await getCachedProfileData();

    if (!isAuthenticated || !process.env.DASHBOARD_PASSWORD) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
                <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-950">
                    <div className="text-center">
                        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                            Доступ обмежено
                        </h1>
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                            Для перегляду Особового рахунку введіть пароль доступу.
                        </p>
                    </div>

                    <form action={loginAction} className="mt-8 space-y-4">
                        <div>
                            <input
                                type="password"
                                name="password"
                                placeholder="Введіть пароль"
                                required
                                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            />
                        </div>

                        {hasError && (
                            <p className="text-sm font-medium text-red-600 dark:text-red-400">
                                Невірний пароль. Спробуйте ще раз.
                            </p>
                        )}

                        {hasSetupError && (
                            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                                Помилка налаштування: DASHBOARD_PASSWORD не задано
                            </p>
                        )}

                        <button
                            type="submit"
                            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none transition-colors"
                        >
                            Увійти
                        </button>
                    </form>
                </div>
            </main>
        );
    }

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
        const html = await fetchDashboardDataWithCache(email, password);

        const hiddenFields = extractFormHiddenFields(html)

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
