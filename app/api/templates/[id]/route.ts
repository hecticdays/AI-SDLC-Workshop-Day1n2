import { NextResponse } from 'next/server';
import { DataError, templateDB, templateUpdateSchema } from '@/lib/db';
import { apiError, parseId, readBody, requireSession } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    const template = templateDB.findById(parseId(id), session.userId);
    if (!template) throw new DataError('Template not found', 404);
    return NextResponse.json(template);
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    return NextResponse.json(templateDB.update(parseId(id), session.userId, templateUpdateSchema.parse(await readBody(request))));
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    templateDB.delete(parseId(id), session.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}