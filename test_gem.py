import os, json
from google import genai
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv('.env')

class ExpenseExtraction(BaseModel):
    is_expense: bool = Field(description="True if the message implies an expense. Even short phrases like '140 ming go\\'stga' or '10 ming for taxi' should be considered True.")
    amount: float = Field(description="The numeric amount paid. 0 if not an expense.", default=0)
    currency: str = Field(description="The 3-letter currency code (e.g. UZS, USD, EUR). Empty string if none.", default="")
    description: str = Field(description="Short description of what was paid for. Empty string if none.", default="")

client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))
prompt = """Extract expense information from this chat message: '8 ming nonga'
CRITICAL NUMBER INSTRUCTION: The group uses 'ming' (thousands) as their base unit. You MUST extract the numeric amount strictly in 'ming' units without any trailing zeros. For example:
- '10 ming' -> amount: 10
- '10000' or '10000 ming' -> amount: 10
- '88 ming' or '88000' -> amount: 88
- '14 ming' -> amount: 14
YOU ARE STRICTLY FORBIDDEN FROM OUTPUTTING TRAILING ZEROS LIKE 10000 or 140000. Always output the base number (e.g. 10 or 140)."""

try:
    interaction = client.interactions.create(
        model='gemini-3.7-flash',
        input=prompt,
        response_format={
            'type': 'text',
            'mime_type': 'application/json',
            'schema': ExpenseExtraction.model_json_schema()
        },
    )
    print('OUTPUT:', interaction.output_text)
except Exception as e:
    print('ERROR:', e)
