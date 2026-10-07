import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";
import { db, users } from "@workspace/db";
import { verifyToken } from "./auth";

export const requireWorkyUser: RequestHandler = (req, res, next) => {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Iniciá sesión para continuar." });
    return;
  }

  try {
    req.usuarioId = verifyToken(match[1]);
    next();
  } catch {
    res.status(401).json({ error: "La sesión venció. Volvé a iniciar sesión." });
  }
};

export const requireWorkyAdmin: RequestHandler = async (req, res, next) => {
  if (!req.usuarioId) {
    res.status(401).json({ error: "Iniciá sesión para continuar." });
    return;
  }

  const [account] = await db
    .select({ rol: users.rol, activo: users.activo })
    .from(users)
    .where(eq(users.id, req.usuarioId))
    .limit(1);

  if (!account || !account.activo) {
    res.status(401).json({ error: "La cuenta no está activa." });
    return;
  }
  if (account.rol !== "admin") {
    res.status(403).json({ error: "No tenés permisos para acceder al panel." });
    return;
  }
  next();
};
