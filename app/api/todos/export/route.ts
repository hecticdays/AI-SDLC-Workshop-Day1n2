import { NextResponse } from 'next/server';
import { apiError, requireSession } from '@/lib/api';
import { DataError, getDatabase, todoDB } from '@/lib/db';
import { createPortability, exportFilename, toCsv } from '@/lib/portability';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const format = new URL(request.url).searchParams.get('format') ?? 'json';
    if (format !== 'json' && format !== 'csv') throw new DataError('Unsupported export format', 400);
    const body = format === 'csv' ? toCsv(todoDB.findAllByUser(session.userId)) :
      JSON.stringify(createPortability(getDatabase()).exportAll(session.userId), null, 2);
    return new NextResponse(body, { headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFilename(format)}"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return apiError(error); }
}