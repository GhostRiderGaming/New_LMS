hey there!

sorry i'm adding it cause i'm too lazy to write it everytime i login.


run this command always on terminal before start working:-
    git pull

run this command always on terminal before end working:-
    git add .
    git commit -m ""
    git push



Terminal 1 — Backend

cd backend
uvicorn app.main:app --reload --port 8000

Wait until you see Uvicorn running on http://127.0.0.1:8000 before moving on.



Terminal 2 — Celery worker

cd backend
celery -A app.worker worker --loglevel=info --pool=solo

The --pool=solo flag is important on Windows — Celery's default multiprocessing pool doesn't work well there.



Terminal 3 — Frontend

cd frontend
npm run dev

Then open:
http://localhost:3000 — the app
http://localhost:8000/health — should return {"status":"ok"}
http://localhost:8000/api/v1/docs — Swagger UI to test endpoints directly