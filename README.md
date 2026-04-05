# Devang Classes — merged full project

This zip contains the frontend + backend together in one project.

## Added in this version
- Parent mobile number field during student registration
- Parent mobile OTP verification flow (demo OTP shown on screen for local testing)
- Forgot password flow for teacher and student accounts
- Student login now accepts email or student ID
- Existing email OTP verification kept for new student registration

## How to run on Windows
1. Extract the zip.
2. Open the project folder in VS Code.
3. Open Command Prompt in that folder.
4. If needed, run:
   npm install
5. Copy `.env.example` to `.env`
6. Start the server:
   npm start
7. Open:
   http://localhost:3000

## Quick Windows start
You can also double-click `start.bat`.

## Demo login
- Teacher: `admin@shruticlasses.com` / `Shruti@2024`
- Student: `aarav@gmail.com` / `pass123`
- Student ID login also works, for example: `SC001` / `pass123`

## Important notes
- Parent mobile verification is set up in demo mode right now, so the OTP is shown inside the app for testing.
- Email OTP and forgot-password OTP work in demo mode too unless you add real Gmail credentials in `.env`.
- AI quiz needs a valid `ANTHROPIC_API_KEY` in `.env`.
- If `better-sqlite3` gives an error on your PC, run `npm install` once again on that same Windows machine so it rebuilds correctly.
