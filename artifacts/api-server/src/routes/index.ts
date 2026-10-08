import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workyRouter from "./worky";
import adminRouter from "./admin";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/v1", healthRouter);
router.use("/v1", workyRouter);
router.use("/v1/admin", adminRouter);
router.use("/v1", storageRouter);

export default router;
