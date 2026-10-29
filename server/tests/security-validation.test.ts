import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createAdminMiddleware } from '../src/admin-auth.js';
import { detectSupportedImage } from '../src/upload-validation.js';

function invokeGuard(adminId: string | undefined, origin: string | undefined) {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const next = vi.fn();
  const req = { session: { adminId }, get: () => origin } as unknown as Request;
  const res = { status, json } as unknown as Response;
  createAdminMiddleware(['https://boutique.example'])(req as never, res, next as NextFunction);
  return { status, json, next };
}

describe('admin authorization guard', () => {
  it('rejects requests without an authenticated administrator session', () => {
    const result = invokeGuard(undefined, 'https://boutique.example');
    expect(result.status).toHaveBeenCalledWith(401);
    expect(result.next).not.toHaveBeenCalled();
  });
  it('rejects cross-origin requests even when a session exists', () => {
    const result = invokeGuard('admin-1', 'https://attacker.example');
    expect(result.status).toHaveBeenCalledWith(403);
    expect(result.next).not.toHaveBeenCalled();
  });
  it('allows an authenticated request from the configured storefront', () => {
    const result = invokeGuard('admin-1', 'https://boutique.example');
    expect(result.next).toHaveBeenCalledOnce();
  });
});

describe('image byte validation', () => {
  it('accepts supported JPEG, PNG, and WebP signatures', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm0QAAAAASUVORK5CYII=', 'base64');
    const webp = Buffer.alloc(12); webp.write('RIFF', 0); webp.writeUInt32LE(4, 4); webp.write('WEBP', 8);
    expect((await detectSupportedImage(jpeg))?.mime).toBe('image/jpeg');
    expect((await detectSupportedImage(png))?.mime).toBe('image/png');
    expect((await detectSupportedImage(webp))?.mime).toBe('image/webp');
  });
  it('rejects a renamed non-image payload', async () => {
    expect(await detectSupportedImage(Buffer.from('not an image'))).toBeNull();
  });
});
