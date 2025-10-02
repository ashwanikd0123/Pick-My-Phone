import fs from "fs";
import express from "express";
import bodyParser from "body-parser";   
import morgan from "morgan";
import {GoogleGenAI} from "@google/genai";
import session from "express-session";
import crypto from "crypto";

import path from 'path';
import { fileURLToPath } from 'url';
import { start } from "repl";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const sample_chats = [
    new ChatData("Hello, how can I assist you today?", false),
    new ChatData("I am looking for a new laptop.", true),
    new ChatData("Sure! What are your requirements?", false)
];

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

function startServer(data) {
    const CONFIG = JSON.parse(data);
    console.log("using model: ", CONFIG["model"]);

    const GEN_AI = new GoogleGenAI({
        apiKey: CONFIG["api-key"],
    });

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
    const PORT = 3000;

    const sessionSecret = crypto.randomBytes(32).toString("hex");

    APP.set('view engine', 'ejs');

    console.log(__dirname);

    APP.use(express.static(path.join(__dirname, 'public')));

    APP.set('views', path.join(__dirname, 'views'));

    APP.use(bodyParser.urlencoded({extended: true}));

    APP.use(morgan("tiny"));

    APP.use(session({
        secret: sessionSecret,
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false } 
    }));

    APP.get("/", function(req, res) {
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
            console.log("Response: ", llmResponse);
            appendNewModelResponse(req.session.chats, llmResponse);
            res.render("index.ejs", {
                chats: req.session.chats
            });
        });
    });

    APP.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);   
    });
}

fs.readFile("./config.json", "utf-8" , (err, data) => {
    if (err) {
        console.error("Error reading config file:", err);
        console.log("Exiting server...");
        exit(1);
    } else {
        startServer(data);
    }
});