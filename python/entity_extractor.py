#!/usr/bin/env python3
"""Lightweight entity extraction for GoodevaDesk support tickets.

The script intentionally uses only Python's standard library so it can run in
CI or a local environment without downloading a model. It can read a ticket
JSON document, raw text from stdin, or fetch one ticket from the GoodevaDesk
API.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

EMAIL_RE = re.compile(
    r"(?<![\w.+-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?"
    r"(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+(?![\w-])",
    re.IGNORECASE,
)
PHONE_RE = re.compile(r"(?<![\w])\+?\d[\d\s().-]{6,}\d(?![\w])")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>\"']+", re.IGNORECASE)
REFERENCE_DELIMITED_RE = re.compile(
    r"\b(?:order|invoice|inv|ticket|case|ref|reference|trx)\s*"
    r"(?:number|no\.?|id)?\s*[:#-]\s*"
    r"([A-Z0-9][A-Z0-9_-]{2,})\b",
    re.IGNORECASE,
)
REFERENCE_SPACED_RE = re.compile(
    r"\b(?:order|invoice|inv|ticket|case|ref|reference|trx)\s+"
    r"([A-Z0-9][A-Z0-9_-]{4,})\b",
    re.IGNORECASE,
)
AMOUNT_RE = re.compile(
    r"(?<![\w])(?:[$€£]\s?\d[\d,]*(?:\.\d{1,2})?|"
    r"\b(?:rp|idr|usd|eur|gbp)\s*[\d,.]+|"
    r"\d[\d,]*(?:\.\d{1,2})?\s*(?:rp|idr|usd|eur|gbp))(?![\w])",
    re.IGNORECASE,
)
DATE_RE = re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}$")
REFERENCE_STOP_WORDS = {
    "access",
    "account",
    "email",
    "error",
    "help",
    "issue",
    "login",
    "number",
    "payment",
    "problem",
    "question",
    "support",
    "the",
    "this",
    "ticket",
    "with",
}


def _unique(values: list[str]) -> list[str]:
    """Return non-empty values once while preserving their first spelling."""
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = value.strip().strip(".,;!?)]}")
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def _extract_phones(text: str) -> list[str]:
    phones: list[str] = []
    for match in PHONE_RE.finditer(text):
        candidate = match.group(0).strip()
        if DATE_RE.fullmatch(candidate):
            continue
        digits = re.sub(r"\D", "", candidate)
        if not 8 <= len(digits) <= 15:
            continue
        # A bare short number is more likely to be an order/reference ID.
        if not candidate.startswith("+") and len(digits) < 9:
            continue
        phones.append(candidate)
    return _unique(phones)


def _extract_references(text: str) -> list[str]:
    references = [
        match.group(1)
        for match in REFERENCE_DELIMITED_RE.finditer(text)
    ]
    references.extend(match.group(1) for match in REFERENCE_SPACED_RE.finditer(text))
    candidates = _unique(
        reference
        for reference in references
        if reference.casefold() not in REFERENCE_STOP_WORDS
    )
    # Prefer the more descriptive value when patterns find both `INV-2048`
    # and its numeric suffix `2048` from the same phrase.
    return [
        reference
        for reference in candidates
        if not any(
            other != reference and reference.casefold() in other.casefold()
            for other in candidates
        )
    ]


def extract_entities(text: str) -> dict[str, list[str]]:
    """Extract common support entities from a ticket message."""
    if not isinstance(text, str):
        raise TypeError("text must be a string")

    return {
        "emails": _unique(EMAIL_RE.findall(text)),
        "phones": _extract_phones(text),
        "urls": _unique(URL_RE.findall(text)),
        "references": _extract_references(text),
        "amounts": _unique(AMOUNT_RE.findall(text)),
    }


def ticket_text(ticket: dict[str, Any]) -> str:
    """Build searchable text from common API and export field names."""
    fields = [
        ticket.get("subject"),
        ticket.get("message"),
        ticket.get("body"),
        ticket.get("description"),
        ticket.get("content"),
    ]
    return "\n".join(str(value) for value in fields if value is not None)


def process_ticket(ticket: dict[str, Any]) -> dict[str, Any]:
    """Return privacy-conscious extraction output for one ticket object."""
    if not isinstance(ticket, dict):
        raise TypeError("ticket must be a JSON object")

    text = ticket_text(ticket)
    entities = extract_entities(text)

    for field in ("customerEmail", "customer_email", "email"):
        value = ticket.get(field)
        if isinstance(value, str) and value.strip():
            entities["emails"] = _unique([*entities["emails"], value])

    result: dict[str, Any] = {
        "ticket_id": ticket.get("id"),
        "subject": ticket.get("subject"),
        "category": ticket.get("category"),
        "text_length": len(text),
        "entities": entities,
    }
    return result


def process_document(document: Any) -> dict[str, Any] | list[dict[str, Any]]:
    """Process one ticket object or a list of ticket objects."""
    if isinstance(document, list):
        return [process_ticket(item) for item in document]
    return process_ticket(document)


def _load_json_or_text(raw: str, source: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        if source != "-":
            raise ValueError(f"{source} must contain valid JSON")
        return {"message": raw}


def read_input(path: str) -> Any:
    if path == "-":
        return _load_json_or_text(sys.stdin.read(), "-")
    return _load_json_or_text(Path(path).read_text(encoding="utf-8"), path)


def fetch_ticket(base_url: str, ticket_id: str, api_key: str, timeout: float) -> dict[str, Any]:
    """Fetch one ticket from the GoodevaDesk API."""
    if not api_key:
        raise ValueError(
            "API key is required for --ticket-id; set GOODEVA_API_KEY or use --api-key"
        )
    endpoint = f"{base_url.rstrip('/')}/tickets/{quote(ticket_id, safe='')}"
    request = Request(
        endpoint,
        headers={"x-api-key": api_key, "accept": "application/json"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload: Any = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"API request failed with HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError(f"Could not reach API: {error.reason}") from error
    if not isinstance(payload, dict):
        raise ValueError("API response must be a ticket JSON object")
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract emails, phone numbers, URLs, references, and amounts from tickets."
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--text", help="Raw ticket text to analyze")
    source.add_argument(
        "--ticket-id",
        help="Fetch and analyze one ticket from the GoodevaDesk API",
    )
    parser.add_argument(
        "--input",
        default="-",
        help="JSON file containing a ticket/list, or '-' for stdin (default: stdin)",
    )
    parser.add_argument("--output", help="Write JSON result to this file instead of stdout")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    parser.add_argument(
        "--api-base-url",
        default=os.getenv("GOODEVA_API_URL", "http://localhost:3000"),
        help="GoodevaDesk API base URL when using --ticket-id",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("GOODEVA_API_KEY", ""),
        help="GoodevaDesk API key; prefer GOODEVA_API_KEY instead of putting it in shell history",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="API request timeout in seconds (default: 10)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.text is not None:
            document: Any = {"message": args.text}
        elif args.ticket_id is not None:
            if args.input != "-":
                parser.error("--ticket-id cannot be combined with --input")
            document = fetch_ticket(
                args.api_base_url,
                args.ticket_id,
                args.api_key,
                args.timeout,
            )
        else:
            document = read_input(args.input)

        result = process_document(document)
        rendered = json.dumps(
            result,
            ensure_ascii=False,
            indent=2 if args.pretty else None,
        )
        if args.output:
            Path(args.output).write_text(rendered + "\n", encoding="utf-8")
        else:
            print(rendered)
        return 0
    except (OSError, TypeError, ValueError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
