import type { NextFunction, Request, Response } from 'express';

type AdminRequest = Request & { session: Request['session'] & { adminId?: string } };

/** Session authorization plus an exact Origin check to block cross-site admin form requests. */
export function createAdminMiddleware(allowedOrigins: string[]) {
  return (req: AdminRequest, res: Response, next: NextFunction) => {
    if (!req.session.adminId) return res.status(401).json({ error: 'Please sign in to continue.' });
    const origin = req.get('origin');
    if (origin && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'This request origin is not allowed.' });
    next();
  };
}
