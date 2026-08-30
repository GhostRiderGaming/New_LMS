import asyncio
from app.services.bella_voice_engine import bella_voice_engine

async def main():
    print('Starting synthesis in thread...')
    try:
        audio, phonemes = await asyncio.to_thread(
            bella_voice_engine.synthesize_speech,
            text='Hello world'
        )
        print('Success! Audio size:', len(audio))
    except Exception as e:
        print('Error:', e)

asyncio.run(main())
