import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db, users } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      usuarioId?: number;
    }
  }
}

function secret() {
  const value = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!value) throw new Error("JWT_SECRET debe estar configurado.");
  return value;
}

export function verifyToken(token: string) {
  const payload = jwt.verify(token, secret()) as { usuarioId?: number };
  if (!payload.usuarioId) throw new Error("Sesión inválida.");
  return payload.usuarioId;
}

export function signToken(usuarioId: number) {
  return jwt.sign({ usuarioId }, secret(), { expiresIn: "7d" });
}

async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
  allowUnverifiedEmail: boolean,
) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Necesitás iniciar sesión." });
  let usuarioId: number;
  try {
    usuarioId = verifyToken(header.slice(7));
  } catch {
    return res.status(401).json({ error: "Tu sesión expiró. Volvé a iniciar sesión." });
  }
  try {
    const [account] = await db.select({
      active: users.activo,
      emailVerifiedAt: users.emailVerifiedAt,
    }).from(users).where(eq(users.id, usuarioId)).limit(1);
    if (!account?.active) return res.status(401).json({ error: "La cuenta no está activa." });
    if (!allowUnverifiedEmail && !account.emailVerifiedAt) {
      return res.status(403).json({
        error: "Verificá tu email para seguir usando Worky.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }
    req.usuarioId = usuarioId;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  return authenticate(req, res, next, false);
}

export function requireAuthAllowingUnverifiedEmail(req: Request, res: Response, next: NextFunction) {
  return authenticate(req, res, next, true);
}