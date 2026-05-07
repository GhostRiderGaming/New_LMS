import os
import asyncio
from groq import AsyncGroq
from dotenv import load_dotenv

load_dotenv()

async def test_groq():
    api_key = os.environ.get("GROQ_API_KEY", "")
    print(f"Using API Key: {api_key[:10]}...")
    client = AsyncGroq(api_key=api_key)
    try:
        completion = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": "Say hello"}],
            max_tokens=10
        )
        print("Success!")
        print(completion.choices[0].message.content)
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test_groq())
