import express from "express";
import { defenseRouter } from "./routes.js";
import { eventLog } from "./mocks/core.js";

const app = express();
app.use(express.json());
app.use(defenseRouter);
app.get("/defense/events", (_req, res) => res.json(eventLog)); // debugging only
app.listen(Number(process.env.PORT ?? 3002), () => console.log("defense dev server on :" + (process.env.PORT ?? 3002)));
