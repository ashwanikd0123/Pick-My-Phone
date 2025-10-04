import handler from "./server.js";

const PORT = 8080;

handler.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);   
});