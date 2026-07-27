# Next.js Server & Build Rules
- **NEVER** run a build command (`npm run build`) while a dev or prod server (`npm run dev`, `npm start`) is actively serving from the same `.next` directory. Wiping the `.next` directory during runtime causes catastrophic server crashes (`ERR_CONNECTION_REFUSED`).
- **ALWAYS** stop the server first, run the build command, and then restart the server.
- **CONFIRM** no server process is live on the relevant port (e.g. 3000) before running any build command.
