import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

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

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Necesitás iniciar sesión." });
  try {
    req.usuarioId = verifyToken(header.slice(7));
    return next();
  } catch {
    return res.status(401).json({ error: "Tu sesión expiró. Volvé a iniciar sesión." });
  }
}