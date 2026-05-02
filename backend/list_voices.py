import edge_tts
import asyncio

async def main():
    voices = await edge_tts.list_voices()
    for v in voices:
        if 'en' in v.get('Locale', '').lower() and 'Female' in v.get('Gender', ''):
            print(v['ShortName'], v.get('Gender',''), v.get('Locale',''))

asyncio.run(main())
