# Devang Classes — Rebuilt Project

## What I changed
- removed `node_modules` from the project so it can be installed cleanly on your PC
- updated `better-sqlite3` to `^12.8.0` for newer Node compatibility
- removed duplicate dotenv loading from `server.js`
- kept `.env.example` so you can create your own `.env`

## First-time setup
1. Extract the ZIP.
2. Open CMD in the project folder.
3. Run:
   ```bash
   copy .env.example .env
   npm install
   npm start
   ```
4. Open `http://localhost:3000`

## If port 3000 is busy
```bash
set PORT=3001
npm start
```

## Important
- Do not copy old `node_modules` from previous folders.
- Run this project only from this rebuilt folder.
- If you already have an old database and want a fresh start, delete files inside the `database` folder and run:
  ```bash
  npm run init-db
  ```


Corrected build notes:
- Based on the first/original project.
- Parent Reports menu renamed to Student Report in UI.
- Seed teacher/admin user set to: pratiksha@shruticlasses.com / Pratiksha@2024
- Included a .env file copied from .env.example.
