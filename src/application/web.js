import express from "express";
import session from "express-session";
import passport from "./passport.js";
import { env } from "./env.js";
import { errorMiddleware } from "../middlewares/errorMiddleware.js";
import { publicRouter } from "../routes/publicApi.js";
import { userRouter } from "../routes/api.js";
import { oauthRouter } from "../routes/oauthApi.js";
import path from "path";
import { fileURLToPath } from "url"
import YAML from "yamljs";
import swaggerUi from "swagger-ui-express";
import i18n from "i18n";
import cors from "cors";

export const web = express();
web.use(express.json());

// web.use(cors());
web.use(cors({
    origin: [
        "https://cyclefy.vercel.app",
        "http://localhost:3000"
    ],
    credentials: true,
}));

web.use(session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
}));
web.use(passport.initialize());
web.use(passport.session());

// API Specification
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const swaggerDocument = YAML.load(path.join(__dirname, "../../docs/openapi.yaml"));
web.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

i18n.configure({
    locales: ["en", "id"],
    directory: path.join(__dirname, "../../locales"),
    defaultLocale: "en",
    queryParameter: "lang",  // optional, ex: /api/...?lang=en
    objectNotation: true,
    autoReload: true,   //make sure to be false in unit test
    updateFiles: false,
    syncFiles: false,
    // cookie: "lang"        // optional
});
web.use(i18n.init);

web.use(publicRouter);
web.use(oauthRouter);
web.use('/api', userRouter);

web.use('/assets/profiles', express.static(path.join(__dirname, '../../src/assets/profiles')));
web.use('/assets/donations/offers', express.static(path.join(__dirname, '../../src/assets/donations/offers')));
web.use('/assets/barters/postings', express.static(path.join(__dirname, '../../src/assets/barters/postings')));
web.use('/assets/barters/applications', express.static(path.join(__dirname, '../../src/assets/barters/applications')));
web.use('/assets/borrows/postings', express.static(path.join(__dirname, '../../src/assets/borrows/postings')));
// web.use('/assets/borrows/applications', express.static(path.join(__dirname, '../../src/assets/borrows/applications')));
web.use('/assets/recycles/posts', express.static(path.join(__dirname, '../../src/assets/recycles/posts')));
web.use('/assets/recycles/locations', express.static(path.join(__dirname, '../../src/assets/recycles/locations')));
web.use('/assets/repairs', express.static(path.join(__dirname, '../../src/assets/repairs')));
web.use((req, res, next) => {
    res.status(404).json({
        success: false,
        // errors: `${req.method} ${req.url} not found. Visit /api/docs for documentation`
        errors: req.__('common.not_found', { reqMethod: req.method, reqURL: req.url }),
    });
});

web.use(errorMiddleware);