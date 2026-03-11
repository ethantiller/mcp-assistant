from google import genai
from dotenv import load_dotenv
import os

load_dotenv()

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

client = genai.Client()

def _get_client():
    return client

def _ask_question(question: str) -> str:
    client = _get_client()
    response = client.models.generate_content(
        model="gemini-2.5-flash", contents=f"User asks: {question}"
    )

    return response.text

if __name__ == "__main__":
    question = "What is the capital of France?"
    answer = _ask_question(question)
    print(f"Answer: {answer}")
