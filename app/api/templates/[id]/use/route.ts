import { NextResponse } from 'next/server';
import { templateDB } from '@/lib/db';
import { apiError, parseId, readBody, requireSession } from '@/lib/api';
import { z } from 'zod';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    if ((await request.clone().text()).length > 0) z.object({}).strict().parse(await readBody(request));
    return NextResponse.json(templateDB.use(parseId(id), session.userId), { status: 201 });
  } catch (error) { return apiError(error); }
}