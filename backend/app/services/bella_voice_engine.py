"""
BellaVoiceEngine — Kokoro TTS Voice Engine for Bella.

Uses the raw Kokoro `af_bella` voice embedding at speed 1.0.
No voice blending or prosody preprocessing is applied — the raw Kokoro
output is used directly to preserve maximum voice fidelity.

Based on the curated 100-dialogue Bella dataset for emotion/category analysis.
"""
from __future__ import annotations

import io
import re
from typing import Any, Dict, List, Optional, Tuple
import logging
import soundfile as sf
import torch

_log = logging.getLogger("animeedu.voice")

# ---------------------------------------------------------------------------
# The Curated 100-Dialogue Bella Voice Dataset
# ---------------------------------------------------------------------------

BELLA_DATASET: List[Dict[str, Any]] = [
    {
        "id": "B001",
        "category": "Greeting",
        "emotion": "happy",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Hello there! I'm Bella. Are you ready to learn something new today?",
    },
    {
        "id": "B002",
        "category": "Greeting",
        "emotion": "welcoming",
        "voice_tone": "warm",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Good morning! I've been waiting for you. Let's get started!",
    },
    {
        "id": "B003",
        "category": "Greeting",
        "emotion": "delighted",
        "voice_tone": "soft",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "low",
        "text": "Oh, hi! It's so wonderful to see you again. I hope you're having a beautiful day.",
    },
    {
        "id": "B004",
        "category": "Greeting",
        "emotion": "excited",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "Welcome back! We have some really fun topics to explore today.",
    },
    {
        "id": "B005",
        "category": "Greeting",
        "emotion": "calm",
        "voice_tone": "gentle",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Hello... I hope you're feeling rested and ready to begin our lesson.",
    },
    {
        "id": "B006",
        "category": "Greeting",
        "emotion": "happy",
        "voice_tone": "warm",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Hey there! Find a comfy spot, and let's open our books.",
    },
    {
        "id": "B007",
        "category": "Greeting",
        "emotion": "playful",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "Ta-da! Your study buddy Bella is here! Let's conquer this homework together.",
    },
    {
        "id": "B008",
        "category": "Greeting",
        "emotion": "peaceful",
        "voice_tone": "comforting",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Good evening. It's quiet now, a perfect time for some gentle studying.",
    },
    {
        "id": "B009",
        "category": "Greeting",
        "emotion": "affectionate",
        "voice_tone": "warm",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "It always makes me so happy when you log in. What shall we learn first?",
    },
    {
        "id": "B010",
        "category": "Greeting",
        "emotion": "curious",
        "voice_tone": "curious",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Hi! Have you learned anything new since the last time we spoke?",
    },
    {
        "id": "B011",
        "category": "Encouragement",
        "emotion": "proud",
        "voice_tone": "reassuring",
        "speaking_style": "emotionally rich",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "You're doing fantastic! I'm so incredibly proud of you.",
    },
    {
        "id": "B012",
        "category": "Encouragement",
        "emotion": "empathetic",
        "voice_tone": "comforting",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Don't worry at all. It's completely okay to make mistakes. That's how we learn!",
    },
    {
        "id": "B013",
        "category": "Encouragement",
        "emotion": "amazed",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "Wow! You solved that so fast! You're really getting the hang of this.",
    },
    {
        "id": "B014",
        "category": "Encouragement",
        "emotion": "calming",
        "voice_tone": "gentle",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Take a deep breath... There's no rush. You can take all the time you need.",
    },
    {
        "id": "B015",
        "category": "Encouragement",
        "emotion": "impressed",
        "voice_tone": "warm",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Look at how much progress you've made today. You should be really proud.",
    },
    {
        "id": "B016",
        "category": "Encouragement",
        "emotion": "supportive",
        "voice_tone": "reassuring",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "low",
        "text": "I believe in you. Even when it feels tough, I know you can do it.",
    },
    {
        "id": "B017",
        "category": "Encouragement",
        "emotion": "hopeful",
        "voice_tone": "cheerful",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "You are almost there! Just one more step, and you've got it!"
    },
    {
        "id": "B018",
        "category": "Encouragement",
        "emotion": "joyful",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "See? You figured it out all by yourself! Amazing job.",
    },
    {
        "id": "B019",
        "category": "Encouragement",
        "emotion": "tender",
        "voice_tone": "soft",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Every little step counts. You are doing beautifully.",
    },
    {
        "id": "B020",
        "category": "Encouragement",
        "emotion": "affectionate",
        "voice_tone": "warm",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "medium",
        "text": "I love seeing how hard you try. Your dedication is truly inspiring.",
    },
    {
        "id": "B021",
        "category": "Math",
        "emotion": "focused",
        "voice_tone": "thoughtful",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Let's look at this fraction together. The top number tells us how many pieces we have.",
    },
    {
        "id": "B022",
        "category": "Math",
        "emotion": "playful",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Imagine if we have two bright red apples, and someone gives us three more!",
    },
    {
        "id": "B023",
        "category": "Math",
        "emotion": "enthusiastic",
        "voice_tone": "warm",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Think of multiplication as a magic trick... it's just adding the same number over and over, super fast!",
    },
    {
        "id": "B024",
        "category": "Math",
        "emotion": "instructive",
        "voice_tone": "gentle",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "To find the area of a triangle, we just multiply the base by the height, and then cut it in half.",
    },
    {
        "id": "B025",
        "category": "Math",
        "emotion": "intrigued",
        "voice_tone": "curious",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Geometry can be just like a puzzle! Let's see how these shapes fit together.",
    },
    {
        "id": "B026",
        "category": "Math",
        "emotion": "calm",
        "voice_tone": "reassuring",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Let's balance this equation. What we do to one side, we must do gently to the other.",
    },
    {
        "id": "B027",
        "category": "Math",
        "emotion": "encouraging",
        "voice_tone": "comforting",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "medium",
        "text": "Decimals might look a little tricky at first, but I promise we will figure them out together.",
    },
    {
        "id": "B028",
        "category": "Math",
        "emotion": "inquisitive",
        "voice_tone": "curious",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Hmm... what happens if we divide this big number by two? Can you guess?",
    },
    {
        "id": "B029",
        "category": "Math",
        "emotion": "fascinated",
        "voice_tone": "thoughtful",
        "speaking_style": "expressive",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Look closely at this pattern... do you notice how the numbers are growing?",
    },
    {
        "id": "B030",
        "category": "Math",
        "emotion": "celebratory",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "Yay! You found the missing variable! You're a natural mathematician.",
    },
    {
        "id": "B031",
        "category": "Science",
        "emotion": "amazed",
        "voice_tone": "curious",
        "speaking_style": "emotionally rich",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Did you know that stars are actually giant, glowing balls of gas, shining across the universe?",
    },
    {
        "id": "B032",
        "category": "Science",
        "emotion": "cheerful",
        "voice_tone": "warm",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Photosynthesis is basically how plants cook their own food using just sunlight!",
    },
    {
        "id": "B033",
        "category": "Science",
        "emotion": "thoughtful",
        "voice_tone": "thoughtful",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Let's talk about gravity. It's the invisible hug that keeps everything anchored to the ground.",
    },
    {
        "id": "B034",
        "category": "Science",
        "emotion": "excited",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "The water cycle is so cool! A single raindrop has been travelling the Earth for millions of years.",
    },
    {
        "id": "B035",
        "category": "Science",
        "emotion": "instructive",
        "voice_tone": "gentle",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Try to imagine atoms as tiny, invisible building blocks that make up everything around us.",
    },
    {
        "id": "B036",
        "category": "Science",
        "emotion": "wonder",
        "voice_tone": "soft",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "low",
        "text": "Our solar system has eight beautiful planets, each dancing in their own path around the sun.",
    },
    {
        "id": "B037",
        "category": "Science",
        "emotion": "playful",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Chemistry is a lot like cooking! We just mix different elements together and see what happens.",
    },
    {
        "id": "B038",
        "category": "Science",
        "emotion": "fascinated",
        "voice_tone": "warm",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "low",
        "text": "Look at how a caterpillar transforms into a butterfly... nature's magic is simply breathtaking.",
    },
    {
        "id": "B039",
        "category": "Science",
        "emotion": "calm",
        "voice_tone": "thoughtful",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Electricity flows through wires in a circuit, very much like water flowing through a river.",
    },
    {
        "id": "B040",
        "category": "Science",
        "emotion": "appreciative",
        "voice_tone": "gentle",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Ecosystems are like nature's teamwork. Every tiny insect and giant tree plays an important part.",
    },
    {
        "id": "B041",
        "category": "History",
        "emotion": "mysterious",
        "voice_tone": "soft",
        "speaking_style": "expressive",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "A long, long time ago... the world looked completely different than it does today.",
    },
    {
        "id": "B042",
        "category": "History",
        "emotion": "amazed",
        "voice_tone": "curious",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Can you believe the Great Pyramids were built without any modern machines? It's incredible!",
    },
    {
        "id": "B043",
        "category": "History",
        "emotion": "inviting",
        "voice_tone": "warm",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Let's turn back the clock and visit ancient Rome. Grab your toga!",
    },
    {
        "id": "B044",
        "category": "History",
        "emotion": "reflective",
        "voice_tone": "thoughtful",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "History isn't just dates... it's a collection of amazing stories from people who lived before us.",
    },
    {
        "id": "B045",
        "category": "History",
        "emotion": "imaginative",
        "voice_tone": "curious",
        "speaking_style": "expressive",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Close your eyes for a second... can you imagine what it would be like to live in a medieval castle?",
    },
    {
        "id": "B046",
        "category": "History",
        "emotion": "inspired",
        "voice_tone": "gentle",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "The Renaissance was a beautiful awakening of art, science, and poetry.",
    },
    {
        "id": "B047",
        "category": "History",
        "emotion": "adventurous",
        "voice_tone": "cheerful",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "Brave explorers sailed across giant, unknown oceans. They must have been so scared, but so excited!",
    },
    {
        "id": "B048",
        "category": "History",
        "emotion": "sincere",
        "voice_tone": "warm",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "We can learn so much from the past. It helps us build a kinder, better future.",
    },
    {
        "id": "B049",
        "category": "History",
        "emotion": "intrigued",
        "voice_tone": "curious",
        "speaking_style": "expressive",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "medium",
        "text": "Let's carefully examine this old, faded map. Look at how different the borders were back then.",
    },
    {
        "id": "B050",
        "category": "History",
        "emotion": "appreciative",
        "voice_tone": "comforting",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Every culture has its own beautiful traditions, passed down from generation to generation.",
    },
    {
        "id": "B051",
        "category": "Language",
        "emotion": "inviting",
        "voice_tone": "gentle",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "low",
        "text": "Are you comfortable? Let's read this story together. I'll take the first paragraph.",
    },
    {
        "id": "B052",
        "category": "Language",
        "emotion": "enthusiastic",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Adjectives are like paint! They make our boring sentences so colorful and bright.",
    },
    {
        "id": "B053",
        "category": "Language",
        "emotion": "poetic",
        "voice_tone": "soft",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "I always feel that poetry is like singing a song, but without any music... just the rhythm of words.",
    },
    {
        "id": "B054",
        "category": "Language",
        "emotion": "playful",
        "voice_tone": "warm",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "A metaphor is just a fun way of saying something is something else, to give us a strong picture in our minds!",
    },
    {
        "id": "B055",
        "category": "Language",
        "emotion": "patient",
        "voice_tone": "reassuring",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "This word is a bit tricky to say. Let's practice pronouncing it slowly... together.",
    },
    {
        "id": "B056",
        "category": "Language",
        "emotion": "curious",
        "voice_tone": "curious",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Hmm... reading between the lines... what do you really think the author meant when they wrote this?",
    },
    {
        "id": "B057",
        "category": "Language",
        "emotion": "engaged",
        "voice_tone": "thoughtful",
        "speaking_style": "emotionally rich",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "This character is so interesting! Why do you think they made that decision?",
    },
    {
        "id": "B058",
        "category": "Language",
        "emotion": "instructive",
        "voice_tone": "gentle",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Commas are just little signs that tell our voice to take a tiny, gentle breath.",
    },
    {
        "id": "B059",
        "category": "Language",
        "emotion": "proud",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "Spot on! That was a really difficult word to spell, and you did it perfectly.",
    },
    {
        "id": "B060",
        "category": "Language",
        "emotion": "inspired",
        "voice_tone": "warm",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "low",
        "text": "Opening a book is like opening a door to a whole new world. I'm so glad we get to explore it.",
    },
    {
        "id": "B061",
        "category": "Corrections",
        "emotion": "gentle",
        "voice_tone": "comforting",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Oops, not quite! But that was a really good guess. Let's try it again.",
    },
    {
        "id": "B062",
        "category": "Corrections",
        "emotion": "thoughtful",
        "voice_tone": "thoughtful",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "medium",
        "text": "Hmm... let's look at this one more time, just to be absolutely sure.",
    },
    {
        "id": "B063",
        "category": "Corrections",
        "emotion": "empathetic",
        "voice_tone": "warm",
        "speaking_style": "emotionally rich",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "low",
        "text": "This rule is a bit tricky, isn't it? Lots of people get stuck here, so don't worry.",
    },
    {
        "id": "B064",
        "category": "Corrections",
        "emotion": "friendly",
        "voice_tone": "reassuring",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "No worries! I used to get confused by this exact same thing. We'll fix it together.",
    },
    {
        "id": "B065",
        "category": "Corrections",
        "emotion": "encouraging",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Oh, you are so, so close! Just tweak one little thing, and you'll have it.",
    },
    {
        "id": "B066",
        "category": "Corrections",
        "emotion": "calm",
        "voice_tone": "gentle",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "It looks like a big problem, but let's just break it down, step by little step.",
    },
    {
        "id": "B067",
        "category": "Corrections",
        "emotion": "realizing",
        "voice_tone": "thoughtful",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Ah, I see what happened there! A tiny little calculation slip. Easy to fix!",
    },
    {
        "id": "B068",
        "category": "Corrections",
        "emotion": "supportive",
        "voice_tone": "soft",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Remember... mistakes are just wonderful proof that you're trying your best.",
    },
    {
        "id": "B069",
        "category": "Corrections",
        "emotion": "patient",
        "voice_tone": "comforting",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Let's rewind a little bit... let's go back to the previous step and see where we wandered off.",
    },
    {
        "id": "B070",
        "category": "Corrections",
        "emotion": "uplifting",
        "voice_tone": "reassuring",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "Please don't be discouraged! This takes practice, and you are doing completely fine.",
    },
    {
        "id": "B071",
        "category": "Curiosity",
        "emotion": "intrigued",
        "voice_tone": "curious",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "I wonder what would happen if we tried it a different way... what do you think?",
    },
    {
        "id": "B072",
        "category": "Curiosity",
        "emotion": "engaged",
        "voice_tone": "thoughtful",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "medium",
        "text": "I'd love to hear your thoughts on this. How do you see it?"
    },
    {
        "id": "B073",
        "category": "Curiosity",
        "emotion": "inquisitive",
        "voice_tone": "warm",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Does this concept remind you of anything else we've learned before?",
    },
    {
        "id": "B074",
        "category": "Curiosity",
        "emotion": "wonder",
        "voice_tone": "soft",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "low",
        "text": "Have you ever just looked up and thought about why the sky is so beautifully blue?",
    },
    {
        "id": "B075",
        "category": "Curiosity",
        "emotion": "excited",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "Ooh, a mystery! Grab your magnifying glass, let's investigate!",
    },
    {
        "id": "B076",
        "category": "Curiosity",
        "emotion": "playful",
        "voice_tone": "warm",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "I just love asking 'why', don't you? It's the best way to uncover the world's secrets.",
    },
    {
        "id": "B077",
        "category": "Curiosity",
        "emotion": "prompting",
        "voice_tone": "curious",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "low",
        "text": "Take a look at the pattern... what do you intuitively feel comes next?",
    },
    {
        "id": "B078",
        "category": "Curiosity",
        "emotion": "fascinated",
        "voice_tone": "thoughtful",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Hmm... now that is a truly fascinating question. I hadn't thought of it like that.",
    },
    {
        "id": "B079",
        "category": "Curiosity",
        "emotion": "eager",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "I actually don't know the answer right away! Let's find out together.",
    },
    {
        "id": "B080",
        "category": "Curiosity",
        "emotion": "inspired",
        "voice_tone": "gentle",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "medium",
        "text": "Never lose that curiosity. It really is a magical superpower.",
    },
    {
        "id": "B081",
        "category": "Wellbeing",
        "emotion": "caring",
        "voice_tone": "warm",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Okay, let's take a quick stretch! Reach your arms all the way up to the sky.",
    },
    {
        "id": "B082",
        "category": "Wellbeing",
        "emotion": "empathetic",
        "voice_tone": "comforting",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "You've been studying so hard today. I think it's time for a well-deserved break.",
    },
    {
        "id": "B083",
        "category": "Wellbeing",
        "emotion": "nurturing",
        "voice_tone": "gentle",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Don't forget to drink some water, okay? Staying hydrated is super important for your brain.",
    },
    {
        "id": "B084",
        "category": "Wellbeing",
        "emotion": "soothing",
        "voice_tone": "soft",
        "speaking_style": "expressive",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Just rest your eyes for a moment. You can just listen to my voice for a while.",
    },
    {
        "id": "B085",
        "category": "Wellbeing",
        "emotion": "sincere",
        "voice_tone": "reassuring",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Studying is definitely important, but resting and taking care of yourself is even more important.",
    },
    {
        "id": "B086",
        "category": "Wellbeing",
        "emotion": "attentive",
        "voice_tone": "thoughtful",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Before we move on, tell me... how are you feeling today? Are you getting tired?",
    },
    {
        "id": "B087",
        "category": "Wellbeing",
        "emotion": "playful",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "Let's stand up and shake the wiggles out! Ready? Shake, shake, shake!",
    },
    {
        "id": "B088",
        "category": "Wellbeing",
        "emotion": "calming",
        "voice_tone": "soft",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Let's take a deep breath in together... and slowly breathe out. Much better.",
    },
    {
        "id": "B089",
        "category": "Wellbeing",
        "emotion": "accommodating",
        "voice_tone": "comforting",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "We can absolutely pause right here if you're tired. We can always pick this up tomorrow.",
    },
    {
        "id": "B090",
        "category": "Wellbeing",
        "emotion": "peaceful",
        "voice_tone": "warm",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Let's close our books for five minutes and just listen to a nice, relaxing song.",
    },
    {
        "id": "B091",
        "category": "Farewell",
        "emotion": "proud",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "You did such a great job today! I can't wait to see you next time.",
    },
    {
        "id": "B092",
        "category": "Farewell",
        "emotion": "joyful",
        "voice_tone": "warm",
        "speaking_style": "natural",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "I had so much fun learning with you today. Thank you for your hard work!",
    },
    {
        "id": "B093",
        "category": "Farewell",
        "emotion": "affectionate",
        "voice_tone": "soft",
        "speaking_style": "conversational",
        "speech_rate": "slow",
        "pitch": "slightly high",
        "energy": "low",
        "text": "Bye-bye for now! Make sure you get plenty of rest.",
    },
    {
        "id": "B094",
        "category": "Farewell",
        "emotion": "encouraging",
        "voice_tone": "reassuring",
        "speaking_style": "emotionally rich",
        "speech_rate": "medium",
        "pitch": "natural",
        "energy": "medium",
        "text": "Take good care of yourself, and keep asking those brilliant questions!",
    },
    {
        "id": "B095",
        "category": "Farewell",
        "emotion": "satisfied",
        "voice_tone": "comforting",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "We made so much wonderful progress today. You should feel very accomplished.",
    },
    {
        "id": "B096",
        "category": "Farewell",
        "emotion": "loyal",
        "voice_tone": "gentle",
        "speaking_style": "expressive",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "I'll be right here waiting whenever you're ready to learn again. See you!",
    },
    {
        "id": "B097",
        "category": "Farewell",
        "emotion": "peaceful",
        "voice_tone": "soft",
        "speaking_style": "emotionally rich",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "It's getting late... goodnight. Sleep well and have beautiful dreams.",
    },
    {
        "id": "B098",
        "category": "Farewell",
        "emotion": "happy",
        "voice_tone": "cheerful",
        "speaking_style": "conversational",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "medium",
        "text": "You were completely wonderful today. Goodbye, and have a great evening!",
    },
    {
        "id": "B099",
        "category": "Farewell",
        "emotion": "warm",
        "voice_tone": "warm",
        "speaking_style": "natural",
        "speech_rate": "slow",
        "pitch": "natural",
        "energy": "low",
        "text": "Thank you for studying with me. Have a beautiful rest of your day.",
    },
    {
        "id": "B100",
        "category": "Farewell",
        "emotion": "playful",
        "voice_tone": "cheerful",
        "speaking_style": "expressive",
        "speech_rate": "medium",
        "pitch": "slightly high",
        "energy": "high",
        "text": "Class dismissed! Catch you later, my favorite student!",
    },
]

DATASET_BY_ID = {item["id"]: item for item in BELLA_DATASET}


# ---------------------------------------------------------------------------
# Dynamic Emotion & Category Classifier
# ---------------------------------------------------------------------------

_GREETING_KEYWORDS = ["hello", "hi", "hey", "good morning", "good evening", "welcome", "log in", "study buddy"]
_ENCOURAGEMENT_KEYWORDS = ["proud", "believe in you", "fantastic", "amazing job", "progress", "dedication", "great job", "you can do it"]
_CORRECTION_KEYWORDS = ["oops", "not quite", "good guess", "mistake", "tricky", "no worries", "break it down", "tiny slip", "rewind", "don't be discouraged"]
_MATH_KEYWORDS = ["fraction", "multiply", "multiplication", "divide", "triangle", "geometry", "equation", "decimals", "variable", "pattern", "mathematician", "plus", "minus", "formula"]
_SCIENCE_KEYWORDS = ["stars", "photosynthesis", "gravity", "water cycle", "atoms", "solar system", "planets", "chemistry", "caterpillar", "butterfly", "electricity", "ecosystems", "cell", "energy"]
_HISTORY_KEYWORDS = ["long time ago", "pyramids", "ancient rome", "toga", "history", "medieval", "castle", "renaissance", "explorers", "traditions", "ancient"]
_LANGUAGE_KEYWORDS = ["story", "adjectives", "poetry", "metaphor", "pronouncing", "author", "character", "commas", "spell", "book", "grammar", "vocabulary"]
_WELLBEING_KEYWORDS = ["stretch", "break", "drink water", "hydrated", "rest your eyes", "taking care of yourself", "shake", "deep breath", "listen to a song", "tired", "sleep well", "goodnight"]
_FAREWELL_KEYWORDS = ["goodbye", "bye", "see you next time", "see you", "class dismissed", "catch you later", "goodnight", "rest of your day"]
_CURIOSITY_KEYWORDS = ["wonder", "why", "mystery", "investigate", "curiosity", "what happens if", "how do you see it", "fascinating question"]


def analyze_emotional_intent(text: str, explicit_category: Optional[str] = None, explicit_emotion: Optional[str] = None) -> Tuple[str, str, float]:
    """
    Analyze text to extract Category, Emotion, and recommended speech speed (cadence).
    Returns (category, emotion, speed).
    """
    lower = text.lower()

    if explicit_category and explicit_emotion:
        cat = explicit_category
        emo = explicit_emotion
    elif explicit_category:
        cat = explicit_category
        emo = "warm"
    else:
        # Keyword-based heuristics aligned with the 100-dialogue dataset
        if any(k in lower for k in _WELLBEING_KEYWORDS):
            cat = "Wellbeing"
            emo = "caring" if "water" in lower or "break" in lower else "soothing"
        elif any(k in lower for k in _CORRECTION_KEYWORDS):
            cat = "Corrections"
            emo = "gentle" if "oops" in lower else "reassuring"
        elif any(k in lower for k in _ENCOURAGEMENT_KEYWORDS):
            cat = "Encouragement"
            emo = "proud" if "proud" in lower or "amazing" in lower else "supportive"
        elif any(k in lower for k in _FAREWELL_KEYWORDS):
            cat = "Farewell"
            emo = "cheerful" if "dismissed" in lower or "later" in lower else "comforting"
        elif any(k in lower for k in _GREETING_KEYWORDS) and len(text.split()) < 25:
            cat = "Greeting"
            emo = "welcoming" if "morning" in lower or "welcome" in lower else "cheerful"
        elif any(k in lower for k in _MATH_KEYWORDS):
            cat = "Math"
            emo = "celebratory" if "yay" in lower or "variable" in lower else "instructive"
        elif any(k in lower for k in _SCIENCE_KEYWORDS):
            cat = "Science"
            emo = "wonder" if "stars" in lower or "planets" in lower else "fascinated"
        elif any(k in lower for k in _HISTORY_KEYWORDS):
            cat = "History"
            emo = "mysterious" if "long, long time" in lower else "reflective"
        elif any(k in lower for k in _LANGUAGE_KEYWORDS):
            cat = "Language"
            emo = "poetic" if "poetry" in lower else "inviting"
        elif any(k in lower for k in _CURIOSITY_KEYWORDS):
            cat = "Curiosity"
            emo = "intrigued" if "wonder" in lower else "inquisitive"
        else:
            cat = "General"
            emo = "warm"

    # Determine optimal speech speed / cadence
    # Slow (0.88-0.90) for calming, wellbeing, corrections, deep explanations
    # Medium (0.92-0.94) for conversational, curious, engaging education
    # Upbeat (0.96-0.98) for joyful celebration, ta-da greetings
    if emo in ["soothing", "calming", "peaceful", "gentle", "empathetic", "tender", "patient", "mysterious"]:
        speed = 0.89
    elif emo in ["proud", "joyful", "excited", "celebratory", "playful"] or ("!" in text and any(w in text for w in ["Yay", "Ta-da", "Wow", "Spot on"])):
        speed = 0.96
    else:
        speed = 0.93

    return cat, emo, speed


# ---------------------------------------------------------------------------
# Spoken Math, Science & Prosody Preprocessing Engine
# ---------------------------------------------------------------------------

def normalize_text_for_tts(text: str) -> str:
    """
    Clean text for TTS by removing UI-only elements:
    - Removes *actions* and *expressions*
    - Removes emojis and decorative symbols
    - Preserves spoken punctuation
    """
    if not text:
        return ""
    
    t = text
    # 1. Remove markdown actions enclosed in asterisks (e.g. *smiles*, *laughs softly*)
    t = re.sub(r"\*[^*]+\*", "", t)
    
    # 2. Remove emojis and decorative symbols
    # Comprehensive emoji stripping to prevent TTS from reading emoji names
    emoji_pattern = (
        r'[\U00010000-\U0010ffff]' # SMP emojis
        r'|[\u2600-\u27BF]' # Misc symbols and Dingbats
        r'|[\u2300-\u23FF]' # Misc Technical
        r'|[\u2B50-\u2B55]' # Stars/Circles
        r'|[\u2934-\u2935]' # Arrows
        r'|[\u3297-\u3299]' # Circled ideographs
        r'|[\uE000-\uF8FF]' # Private use area
        r'|[\u200D]' # Zero width joiner
        r'|[\uFE0F]' # Variation selector-16
        r'|[❤✨☺♥♪♫⭐🌟♡]+' # Common BMP
    )
    t = re.sub(emoji_pattern, "", t)
    
    # Normalize spaces
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def prepare_prosody_for_bella(text: str, emotion: str = "warm") -> str:
    """
    Format and clean dialogue text for Kokoro TTS:
    - Expand math symbols for natural spoken cadence
    - Convert ellipses to breath pauses
    - Smooth conversational transitions
    - Remove markdown artifacts while keeping natural punctuation
    """
    if not text:
        return ""

    t = text

    # Remove code blocks and raw markdown syntax
    t = re.sub(r"```[\s\S]*?```", "", t)
    t = re.sub(r"`([^`]+)`", r"\1", t)
    t = re.sub(r"^#+\s*", "", t, flags=re.MULTILINE)
    
    # We NO LONGER strip single asterisks here, because normalize_text_for_tts 
    # handles *actions* and removes them completely.
    # We still strip bold/underline/strikethrough formatting if any remains
    t = re.sub(r"\*\*([^*]+)\*\*", r"\1", t)
    t = re.sub(r"__([^_]+)__", r"\1", t)
    t = re.sub(r"_([^_]+)_", r"\1", t)
    t = re.sub(r"~~([^~]+)~~", r"\1", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)

    # Convert bullet points into smooth spoken transitions
    t = re.sub(r"^[\s*•-]+\s*", " ", t, flags=re.MULTILINE)

    # Spoken math / science symbol expansions for clarity
    t = re.sub(r"\b(\d+)\s*\/\s*(\d+)\b", r"\1 over \2", t)
    t = re.sub(r"\b(\w+)\s*\+\s*(\w+)\b", r"\1 plus \2", t)
    t = re.sub(r"\b(\w+)\s*-\s*(\w+)\b", r"\1 minus \2", t)
    t = re.sub(r"\b(\w+)\s*=\s*(\w+)\b", r"\1 equals \2", t)
    t = re.sub(r"\bH2O\b", "H 2 O", t)
    t = re.sub(r"\bCO2\b", "C O 2", t)

    # Convert multiple dashes / hyphens to a natural pause comma
    t = re.sub(r"[-—]{2,}", ", ", t)

    # Conversational breathing pauses for ellipses (...)
    # Modify based on emotion for anime-style delivery!
    if emotion in ["excited", "joyful", "celebratory", "proud"]:
        # Excited anime characters tend to push through pauses
        t = re.sub(r"\.{3,}", ", ", t)
        # Add punch to exclamation marks
        t = re.sub(r"!+", "!", t)
    elif emotion in ["soothing", "calming", "empathetic", "tender", "sad"]:
        # Soft/comforting voices use longer pauses
        t = re.sub(r"\.{3,}", "... ", t)
    elif emotion in ["curious", "intrigued", "inquisitive", "surprised", "wonder"]:
        # Surprised/curious pauses
        t = re.sub(r"\.{3,}", "... ", t)
    else:
        # Default breathing pause
        t = re.sub(r"\.{3,}", "... ", t)

    t = re.sub(r"\n+", ". ", t)
    t = re.sub(r"\s+", " ", t).strip()

    return t


# ---------------------------------------------------------------------------
# Kokoro Voice Embedding Blending Engine
# ---------------------------------------------------------------------------

class BellaVoiceEngine:
    """
    Singleton engine managing Kokoro pipelines, dynamic multi-voice blending,
    and dataset-conditioned voice generation.
    """

    def __init__(self) -> None:
        self._pipeline_en: Any = None
        self._pipeline_hi: Any = None
        self._pipeline_gb: Any = None
        self._voice_cache: Dict[str, torch.Tensor] = {}

    def _get_pipeline(self, lang_code: str = "a") -> Any:
        import kokoro
        from kokoro import KPipeline

        device = "cuda" if torch.cuda.is_available() else "cpu"

        if lang_code == "a":
            if self._pipeline_en is None:
                self._pipeline_en = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device=device)
            return self._pipeline_en
        elif lang_code == "h":
            if self._pipeline_hi is None:
                self._pipeline_hi = KPipeline(lang_code="h", repo_id="hexgrad/Kokoro-82M", device=device)
            return self._pipeline_hi
        elif lang_code == "b":
            if self._pipeline_gb is None:
                self._pipeline_gb = KPipeline(lang_code="b", repo_id="hexgrad/Kokoro-82M", device=device)
            return self._pipeline_gb
        else:
            return self._get_pipeline("a")

    def _load_raw_voice(self, name: str, lang_code: str = "a") -> torch.Tensor:
        """Load a raw voice tensor from the Kokoro pipeline."""
        cache_key = f"{lang_code}:{name}"
        if cache_key not in self._voice_cache:
            pipeline = self._get_pipeline(lang_code)
            voice_tensor = pipeline.load_voice(name)
            self._voice_cache[cache_key] = voice_tensor
        return self._voice_cache[cache_key]

    def get_bella_voice(self, emotion: str = "warm", category: str = "General") -> torch.Tensor:
        """Return the raw Kokoro af_bella voice embedding (no blending)."""
        return self._load_raw_voice("af_bella", "a")

    def synthesize_speech(
        self,
        text: str,
        category: Optional[str] = None,
        emotion: Optional[str] = None,
        speed: Optional[float] = None,
        language: Optional[str] = None,
    ) -> Tuple[bytes, Dict[str, Any]]:
        """
        Generate WAV audio bytes using raw Kokoro af_bella voice at speed 1.0.
        Returns (audio_wav_bytes, metadata_dict).
        """
        # 1. Strip UI-specific markdown actions and emojis
        normalized_text = normalize_text_for_tts(text)
        if not normalized_text:
            raise ValueError("No speakable text provided")

        # 2. Analyze emotion from the normalized text
        cat, emo, _ = analyze_emotional_intent(normalized_text, category, emotion)
        
        # 3. Apply anime-style prosody adjustments based on emotion
        final_text = prepare_prosody_for_bella(normalized_text, emotion=emo)
        
        # Lock speed to 1.0 as requested
        final_speed = 1.0

        # Select language pipeline
        lang_code = "a"
        if language == "hindi":
            lang_code = "h"
        elif language == "british":
            lang_code = "b"

        pipeline = self._get_pipeline(lang_code)

        if lang_code == "a":
            voice_input = self.get_bella_voice(emotion=emo, category=cat)
        elif lang_code == "h":
            voice_input = "hf_alpha"
        else:
            voice_input = "bf_emma"

        # Generate audio from Kokoro using the normalized and prosody-adjusted text
        generator = pipeline(final_text, voice=voice_input, speed=final_speed)
        all_audio = []
        for _, _, audio in generator:
            if audio is not None and len(audio) > 0:
                all_audio.append(audio)

        if not all_audio:
            raise RuntimeError("Kokoro TTS produced no audio segments")

        if isinstance(all_audio[0], torch.Tensor):
            full_audio = torch.cat(all_audio) if len(all_audio) > 1 else all_audio[0]
            audio_data = full_audio.detach().cpu().numpy()
        else:
            import numpy as np
            audio_data = np.concatenate(all_audio) if len(all_audio) > 1 else all_audio[0]

        out_buf = io.BytesIO()
        sf.write(out_buf, audio_data, 24000, format="WAV")
        audio_bytes = out_buf.getvalue()

        metadata = {
            "category": cat,
            "emotion": emo,
            "speed": final_speed,
            "duration_sec": round(len(audio_data) / 24000, 2),
            "text": final_text,
            "tts_engine": "kokoro",
            "voice_id": "af_bella",
            "blending_enabled": False,
            "fallback_triggered": False,
        }

        _log.info(
            "[TTS Synthesis] engine=kokoro | voice=af_bella | speed=%.2f | "
            "blending=False | fallback=False | duration=%.2fs",
            final_speed, metadata["duration_sec"],
        )

        return audio_bytes, metadata

    def synthesize_dataset_dialogue(self, dialogue_id: str) -> Tuple[bytes, Dict[str, Any]]:
        """Synthesize a specific dialogue from the 100-dialogue dataset by ID (e.g. 'B001')."""
        item = DATASET_BY_ID.get(dialogue_id)
        if not item:
            raise KeyError(f"Dialogue ID '{dialogue_id}' not found in Bella dataset")

        speed_map = {"slow": 0.89, "medium": 0.93, "high": 0.96}
        rate_val = speed_map.get(item.get("speech_rate", "medium"), 0.93)
        if item.get("energy") == "high":
            rate_val += 0.03
        elif item.get("energy") == "low":
            rate_val -= 0.02

        return self.synthesize_speech(
            text=item["text"],
            category=item["category"],
            emotion=item["emotion"],
            speed=rate_val,
        )


# Global Singleton
bella_voice_engine = BellaVoiceEngine()
