import app from "./app";
import { logger } from "./lib/logger";
import { cleanupAbandonedChatAttachments, cleanupAbandonedProfilePhotoUploads, startChatAttachmentCleanup, startProfilePhotoCleanup } from "./routes/storage";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startChatAttachmentCleanup();
  startProfilePhotoCleanup();
  void cleanupAbandonedChatAttachments().catch((cleanupError) => {
    logger.error({ err: cleanupError }, "Falló la limpieza inicial de cargas de chat abandonadas");
  });
  void cleanupAbandonedProfilePhotoUploads().catch((cleanupError) => {
    logger.error({ err: cleanupError }, "Falló la limpieza inicial de cargas de fotos de perfil abandonadas");
  });
});
