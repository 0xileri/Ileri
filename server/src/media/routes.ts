import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertGranted, courseAccess } from '../access/requirements';
import { loadCourse } from '../courses/routes';
import { enrollments, media } from '../db/schema';
import { audit } from '../lib/audit';
import { AppError, badRequest, notFound } from '../lib/errors';
import { isUuid } from '../lib/misc';
import { loadCommunity, requireCommunityRole, requireUser } from '../permissions';
import { verifyMediaSignature } from './sign';

const LESSON_TYPES: Record<string, string[]> = {
  'video/mp4': ['.mp4', '.m4v'],
  'video/webm': ['.webm'],
  'audio/mpeg': ['.mp3'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'text/plain': ['.txt', '.md', '.csv'],
  'text/markdown': ['.md'],
  'text/csv': ['.csv'],
};

const SUBMISSION_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'text/plain': ['.txt', '.md', '.csv'],
  'text/markdown': ['.md'],
  'text/csv': ['.csv'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
};

const SUBMISSION_MAX_BYTES = 25 * 1024 * 1024;
const INLINE_PREFIXES = ['video/', 'audio/', 'image/', 'application/pdf'];

async function receiveFile(req: FastifyRequest, allowed: Record<string, string[]>, maxBytes: number) {
  if (!req.isMultipart()) throw badRequest('Upload a file using multipart/form-data.');
  const file = await req.file();
  if (!file) throw badRequest('No file received.');
  const ext = path.extname(file.filename).toLowerCase();
  const exts = allowed[file.mimetype];
  if (!exts || !exts.includes(ext)) {
    file.file.resume();
    throw badRequest(`That file type is not allowed. Allowed: ${[...new Set(Object.values(allowed).flat())].join(', ')}.`);
  }
  const safeName = path.basename(file.filename).replace(/[^\w.\- ]+/g, '_').slice(0, 150) || `file${ext}`;
  try {
    const saved = await req.server.ctx.storage.save(file.file, maxBytes);
    if (file.file.truncated) throw new Error('File too large');
    return { ...saved, filename: safeName, mimeType: file.mimetype };
  } catch (error) {
    if (error instanceof Error && /too large/i.test(error.message)) {
      throw new AppError(413, 'file_too_large', `Files can be at most ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    throw error;
  }
}

export async function mediaRoutes(app: FastifyInstance) {
  const { ctx } = app;

  // Lesson files uploaded by community staff.
  app.post<{ Params: { id: string } }>('/api/communities/:id/media', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'instructor');
    const saved = await receiveFile(req, LESSON_TYPES, ctx.config.maxUploadBytes);
    const [row] = await ctx.db
      .insert(media)
      .values({
        communityId: community.id,
        purpose: 'lesson',
        uploadedBy: actor.user.id,
        filename: saved.filename,
        mimeType: saved.mimeType,
        sizeBytes: saved.size,
        storageKey: saved.key,
      })
      .returning({ id: media.id, filename: media.filename, mimeType: media.mimeType, sizeBytes: media.sizeBytes });
    await audit(ctx.db, { action: 'media.upload', actorId: actor.user.id, communityId: community.id, targetType: 'media', targetId: row!.id, ip: req.ip });
    return { media: row };
  });

  // Files attached to a learner's own assignment submission.
  app.post<{ Params: { id: string } }>('/api/courses/:id/uploads', async (req) => {
    const user = requireUser(req);
    const { course, community } = await loadCourse(ctx, req.params.id);
    const [enrollment] = await ctx.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.userId, user.id), eq(enrollments.courseId, course.id)));
    if (!enrollment) throw new AppError(404, 'not_enrolled', 'Enroll in this course first.');
    assertGranted(await courseAccess(ctx, user, community, course));
    const saved = await receiveFile(req, SUBMISSION_TYPES, Math.min(SUBMISSION_MAX_BYTES, ctx.config.maxUploadBytes));
    const [row] = await ctx.db
      .insert(media)
      .values({
        communityId: community.id,
        courseId: course.id,
        purpose: 'submission',
        uploadedBy: user.id,
        filename: saved.filename,
        mimeType: saved.mimeType,
        sizeBytes: saved.size,
        storageKey: saved.key,
      })
      .returning({ id: media.id, filename: media.filename, mimeType: media.mimeType, sizeBytes: media.sizeBytes });
    return { media: row };
  });

  // Serves a private file. The signature proves an access check happened recently.
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>('/media/:id', async (req, reply) => {
    const { id } = req.params;
    if (!isUuid(id) || !req.query.exp || !req.query.sig || !verifyMediaSignature(ctx, id, req.query.exp, req.query.sig)) {
      throw new AppError(403, 'link_expired', 'This file link has expired. Reload the page to get a new one.');
    }
    const [file] = await ctx.db.select().from(media).where(eq(media.id, id));
    if (!file || !ctx.storage.exists(file.storageKey)) throw notFound('File');
    const inline = INLINE_PREFIXES.some((p) => file.mimeType.startsWith(p));
    reply
      .header('Content-Type', file.mimeType)
      .header('X-Content-Type-Options', 'nosniff')
      // Sandbox neutralises anything script-like; Chrome's PDF viewer refuses sandboxed documents.
      .header('Content-Security-Policy', file.mimeType === 'application/pdf' ? "default-src 'none'" : "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, max-age=600')
      .header('Accept-Ranges', 'bytes')
      .header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${file.filename.replace(/"/g, '')}"`,
      );
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const size = file.sizeBytes;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end || start >= size) {
        return reply.status(416).header('Content-Range', `bytes */${size}`).send();
      }
      reply.status(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1);
      return reply.send(fs.createReadStream(ctx.storage.pathFor(file.storageKey), { start, end }));
    }
    reply.header('Content-Length', file.sizeBytes);
    return reply.send(ctx.storage.open(file.storageKey));
  });
}
