import base64
import hmac
import hashlib
import json
import time
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')

def mint_token(sub: str = "11111111-1111-4111-8111-111111111111", ttl_seconds: int = 86400 * 30):
    secret = os.environ.get("JWT_SECRET", "").encode('utf-8')
    if len(secret) < 32:
        raise ValueError("JWT_SECRET must be at least 32 characters in .env")

    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": sub.lower(),
        "exp": now + ttl_seconds,
        "nbf": now - 30
    }

    hdr_b64 = b64url(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    pay_b64 = b64url(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    signing_input = f"{hdr_b64}.{pay_b64}".encode('utf-8')

    sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
    sig_b64 = b64url(sig)

    return f"{hdr_b64}.{pay_b64}.{sig_b64}"

if __name__ == "__main__":
    import sys
    sub = sys.argv[1] if len(sys.argv) > 1 else "11111111-1111-4111-8111-111111111111"
    token = mint_token(sub)
    print("\n--- DEVELOPMENT JWT TOKEN (Paste this into the login page) ---")
    print(token)
    print("----------------------------------------------------------------\n")
