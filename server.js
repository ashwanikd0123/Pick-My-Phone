import fs from "fs";
import express from "express";
import bodyParser from "body-parser";   
import morgan from "morgan";
import {GoogleGenAI} from "@google/genai";
import session from "express-session";
import crypto from "crypto";

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 8080;

const SYSTEM_PROMPT_FILE = __dirname + "/system_prompt.txt";

async function getResponse(modelName, model, prompt) {
    try {
        const response = await model.models.generateContent({
            model: modelName,
            contents: prompt
        });
        return response.text;
    } catch (error) {
        console.error("Error generating content:", error);
        return "Error generating content";
    }
}

function ChatData(text, isUser) {
    this.text = text;
    this.isUser = isUser;
}

const MAX_CONTEXT_LENGTH = 1000000;

function appendNewUserQuery(chats, query) {
    chats.push(new ChatData(query, true));
}

function appendNewModelResponse(chats, response) {
    chats.push(new ChatData(response, false));
}

function buildFinalPrompt(systemPrompt, chats) {
    var finalPrompt = systemPrompt;
    var chatPrommpt = "";
    for (let i = chats.length - 1; i >= 0; i--) {
        const chat = chats[i];
        const prefix = chat.isUser ? "User: " : "Model: ";
        if ((finalPrompt.length + chat.text.length + prefix.length) > MAX_CONTEXT_LENGTH) {
            break;
        }
        chatPrommpt = prefix + chat.text + "\n" + chatPrommpt;
    }
    return finalPrompt + "\n\n" + chatPrommpt + "Model: ";
}

function setApp(app) {
    const sessionSecret = crypto.randomBytes(32).toString("hex");
    app.set('view engine', 'ejs');
    app.use(express.static(path.join(__dirname, 'public')));
    app.set('views', path.join(__dirname, 'views'));
    app.use(bodyParser.urlencoded({extended: true}));
    app.use(morgan("tiny"));
    app.use(session({
        secret: sessionSecret,
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false } 
    }));
}

function startServer(data) {
    const CONFIG = JSON.parse(data);
    console.log("using model: ", CONFIG["model"]);

    console.log("loading GEN AI module...")
    const GEN_AI = new GoogleGenAI({
        apiKey: process.env.API_KEY,
    });

    console.log("loading system prompt from file: ", SYSTEM_PROMPT_FILE);

    var SYSTEM_PROMPT = "";
    try {
        SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf8');
    } catch (err) {
        console.error("Error reading system prompt file:", err);
        return;
    }

    console.log("System Prompt: ", SYSTEM_PROMPT);

    if (SYSTEM_PROMPT.length === 0) {
        console.error("System prompt is empty. Please provide a valid system prompt in system_prompt.txt");
        return;
    }

    const APP = express();

    setApp(APP);

    APP.get("/", function(req, res) {
        req.session.chats = [];
        res.render("index.ejs", {
            chats: undefined
        });
    });

    APP.post("/submit", function(req, res) {
        const message = req.body.message;
        if (!req.session.chats) {
            req.session.chats = [];
        }
        appendNewUserQuery(req.session.chats, message);
        const finalPrompt = buildFinalPrompt(SYSTEM_PROMPT, req.session.chats);

        getResponse(CONFIG["model"], GEN_AI, finalPrompt).then(function(llmResponse) {
            appendNewModelResponse(req.session.chats, llmResponse);
            res.render("index.ejs", {
                chats: req.session.chats
            });
        });
    });

    // APP.listen(PORT, () => {
    //     console.log(`Server is running on http://localhost:${PORT}`);   
    // });

    return APP
}

let handler

try {
    var data = fs.readFileSync(__dirname + "/config.json", "utf-8");
    handler = startServer(data);
} catch (err) {
    console.error("Error reading config file:", err);
    console.log("Exiting server...");
    process.exit(1);
}

export default handler;