import express from "express";
import { defenseRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use(defenseRouter);
app.listen(Number(process.env.PORT ?? 3002), () => console.log("defense dev server on :" + (process.env.PORT ?? 3002)));
