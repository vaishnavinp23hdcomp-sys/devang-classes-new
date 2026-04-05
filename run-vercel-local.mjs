import dotenv from "dotenv";

dotenv.config();
process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.NODE_ENV = 'production';
process.env.PORT = 3000;

await import("./server.js");