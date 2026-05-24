import os
import asyncio
from app.services.safety import safety_service
from dotenv import load_dotenv

async def test_safety():
    load_dotenv()
    print(f"Testing safety service with model: {safety_service._model}")
    try:
        result = await safety_service.check_topic("the french revolution")
        print(f"Result: {result}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    os.chdir("c:\\CatchupX\\New_LMS\\backend")
    asyncio.run(test_safety())
