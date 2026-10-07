import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workyRouter from "./worky";
import storageRouter from "./storage";
import adminPlatformRouter from "./admin-platform";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/v1", healthRouter);
router.use("/v1", workyRouter);
router.use("/v1", adminPlatformRouter);
router.use("/v1", storageRouter);

export default router;
