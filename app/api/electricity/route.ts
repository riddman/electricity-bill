import { NextResponse } from 'next/server';
import { fetchElectricityBillWithCache, extractUidContainers } from '@/lib/volyn-scraper';

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
    const html = await fetchElectricityBillWithCache(email, password);

    // Extract all div blocks with class uid_container allowed_uid
    const containers = extractUidContainers(html);

    return NextResponse.json({
      status: 'success',
      message: 'Successfully fetched and parsed account page',
      containersCount: containers.length,
      containers: containers,
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
